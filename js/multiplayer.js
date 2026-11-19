/** WebSocket multiplayer client — validates messages, no inline script injection */

const MAX_MSG = 65536;

function safeParse(raw) {
  if (typeof raw !== "string" || raw.length > MAX_MSG) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.type !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export class MultiplayerClient {
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
    this.connected = false;
    this.roomCode = null;
    this.seat = null;
    this.isHost = false;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      if (!url || !/^wss?:\/\//i.test(url)) {
        reject(new Error("Invalid server URL"));
        return;
      }
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        resolve();
      };
      ws.onerror = () => reject(new Error("Connection failed"));
      ws.onclose = () => {
        this.connected = false;
        this.handlers.onDisconnect?.();
      };
      ws.onmessage = (ev) => {
        const msg = safeParse(ev.data);
        if (!msg) return;
        this.handlers.onMessage?.(msg);
      };
    });
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload, v: 1 }));
  }

  createRoom(name, theme) {
    const display = String(name).slice(0, 24).replace(/[<>"']/g, "");
    this.send("create_room", { name: display, theme });
  }

  joinRoom(code, name) {
    const display = String(name).slice(0, 24).replace(/[<>"']/g, "");
    this.send("join_room", { code: String(code).toUpperCase().slice(0, 6), name: display });
  }

  syncState(game, action) {
    this.send("game_state", { state: game, action });
  }

  saveCloud(slot, game, token) {
    this.send("cloud_save", { slot, state: game, token });
  }

  loadCloud(slot, token) {
    this.send("cloud_load", { slot, token });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}

export function attachMultiplayerMeta(game, meta) {
  game.multiplayer = {
    connected: true,
    roomCode: meta.roomCode,
    localSeat: meta.seat,
    isHost: meta.isHost,
    serverUrl: meta.serverUrl,
    saveToken: meta.saveToken || null,
  };
}

export function clearMultiplayer(game) {
  game.multiplayer = null;
}
