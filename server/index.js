/**
 * Minimal WebSocket relay for Property Tycoon multiplayer + cloud saves.
 * Host-synced state; server validates room membership and message shape only.
 */
import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 8787;
const MAX_CLIENTS = 500;
const MAX_STATE_BYTES = 512_000;
const saves = new Map();

const rooms = new Map();

function code() {
  return randomBytes(3).toString("hex").toUpperCase();
}

function token() {
  return createHash("sha256").update(randomBytes(32)).digest("hex").slice(0, 48);
}

function sanitizeName(name) {
  return String(name || "Player")
    .replace(/[<>"'&]/g, "")
    .slice(0, 24);
}

function parseMessage(raw) {
  if (typeof raw !== "string" || raw.length > MAX_STATE_BYTES) return null;
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.type !== "string" || typeof msg.payload !== "object") return null;
    return msg;
  } catch {
    return null;
  }
}

function roomPayload(room) {
  return {
    code: room.code,
    seats: room.seats.map((s) => (s ? { name: s.name, taken: true } : null)),
  };
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_STATE_BYTES });

wss.on("connection", (ws, req) => {
  if (wss.clients.size > MAX_CLIENTS) {
    ws.close(1013, "Server full");
    return;
  }
  let membership = null;

  const send = (type, payload) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload, v: 1 }));
  };

  ws.on("message", (data) => {
    const msg = parseMessage(data.toString());
    if (!msg) return;

    if (msg.type === "create_room") {
      if (membership) return;
      const id = code();
      const saveTok = token();
      const room = {
        code: id,
        host: null,
        seats: [null, null, null, null],
        state: null,
        saveToken: saveTok,
      };
      rooms.set(id, room);
      membership = { code: id, seat: 0 };
      room.seats[0] = { ws, name: sanitizeName(msg.payload.name), isHost: true };
      room.host = ws;
      send("room_created", {
        code: id,
        seat: 0,
        isHost: true,
        name: room.seats[0].name,
        saveToken: saveTok,
        room: roomPayload(room),
      });
      return;
    }

    if (msg.type === "join_room") {
      if (membership) return;
      const id = String(msg.payload.code || "").toUpperCase();
      const room = rooms.get(id);
      if (!room) {
        send("error", { message: "Room not found" });
        return;
      }
      const seat = room.seats.findIndex((s) => s === null);
      if (seat < 0) {
        send("error", { message: "Room is full" });
        return;
      }
      room.seats[seat] = { ws, name: sanitizeName(msg.payload.name), isHost: false };
      membership = { code: id, seat };
      send("room_joined", {
        code: id,
        seat,
        isHost: false,
        name: room.seats[seat].name,
        saveToken: room.saveToken,
        room: roomPayload(room),
      });
      broadcastRoom(room, "player_joined", { seat, name: room.seats[seat].name });
      if (room.state) send("game_state", { state: room.state, action: "sync" });
      return;
    }

    if (!membership) {
      send("error", { message: "Join a room first" });
      return;
    }
    const room = rooms.get(membership.code);
    if (!room) return;

    if (msg.type === "game_state") {
      const seat = membership.seat;
      if (!room.seats[seat]?.isHost) {
        send("error", { message: "Only host can publish state" });
        return;
      }
      const state = msg.payload.state;
      if (!state || state.version !== 3) return;
      const serialized = JSON.stringify(state);
      if (serialized.length > MAX_STATE_BYTES) return;
      room.state = state;
      broadcastRoom(room, "game_state", { state, action: msg.payload.action }, ws);
      return;
    }

    if (msg.type === "cloud_save") {
      const tok = String(msg.payload.token || "");
      if (tok !== room.saveToken) {
        send("error", { message: "Invalid save token" });
        return;
      }
      const slot = String(msg.payload.slot || "main").slice(0, 32);
      const key = `${room.code}:${slot}`;
      const serialized = JSON.stringify(msg.payload.state);
      if (serialized.length > MAX_STATE_BYTES) return;
      saves.set(key, { state: msg.payload.state, at: Date.now(), token: tok });
      send("cloud_saved", { slot, at: Date.now() });
      return;
    }

    if (msg.type === "cloud_load") {
      const tok = String(msg.payload.token || "");
      if (tok !== room.saveToken) {
        send("error", { message: "Invalid save token" });
        return;
      }
      const slot = String(msg.payload.slot || "main").slice(0, 32);
      const key = `${room.code}:${slot}`;
      const entry = saves.get(key);
      if (!entry) {
        send("error", { message: "No cloud save for this room" });
        return;
      }
      send("cloud_loaded", {
        state: entry.state,
        meta: {
          roomCode: room.code,
          seat: membership.seat,
          isHost: !!room.seats[membership.seat]?.isHost,
          saveToken: room.saveToken,
        },
      });
    }
  });

  ws.on("close", () => {
    if (!membership) return;
    const room = rooms.get(membership.code);
    if (!room) return;
    room.seats[membership.seat] = null;
    if (room.seats.every((s) => s === null)) {
      rooms.delete(membership.code);
    } else {
      broadcastRoom(room, "player_left", { seat: membership.seat });
    }
  });
});

function broadcastRoom(room, type, payload, except) {
  room.seats.forEach((s) => {
    if (s?.ws && s.ws !== except && s.ws.readyState === s.ws.OPEN) {
      s.ws.send(JSON.stringify({ type, payload, v: 1 }));
    }
  });
}

server.listen(PORT, () => {
  console.log(`Property Tycoon server listening on :${PORT}`);
});
