# Property Tycoon Advanced — Phase 3

Monopoly-inspired browser game (original board and branding). Phase 3 adds internet multiplayer, official-style rules, animated movement, inline property purchases, financial reports, themes, avatars, soundtrack/SFX, and optional cloud saves via the companion server.

## Phase 3 highlights

- **Multiplayer:** Host/join rooms over WebSocket (`server/`). Non-active seats are locked while others roll or buy.
- **Purchase UI:** No purchase popup — decisions appear in the **Purchase** panel; controls blocked for other players during decisions.
- **Board centre:** Roll and End turn live inside the board so movement is visible beside the dice.
- **Official-style rules:** Doubles (three doubles → Jail), Jail bail/cards/three turns, 32 houses / 12 hotels, even building, mortgaged sets block building, income tax $200 or 10%, Chance & Community decks, railroad/utility rents.
- **Polish:** Step-by-step token animation, 3D-styled dice, build pulse, ambient soundtrack + SFX, themes (classic/midnight/neon), avatars.
- **Security:** CSP on the client, sanitized multiplayer names, size limits and save tokens on the server, no `eval` or remote scripts.

## Play locally (vs AI)

**Do not double-click `index.html`** — ES modules require HTTP. From the project folder:

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

## Online multiplayer

```bash
cd server && npm install && npm start
```

Default WebSocket URL: `ws://localhost:8787`. In the game, click **Multiplayer** → **Host room** or **Join room**. Share the 6-character room code. The host’s game state is synced to other clients. Use **Cloud sync** (with a valid room token) to store/load a snapshot on the server.

For production, terminate TLS and use `wss://` on your domain; set the server URL in the multiplayer dialog.

## Saves

- **Local:** Autosave / Save / Resume (`localStorage`).
- **Portable:** Export / Import JSON.
- **Cloud:** Requires an active multiplayer room (per-room save token).

## Deploy static client (e.g. GitHub Pages)

Upload the repo root (`index.html`, `css/`, `js/`, `README.md`). Pages serves static files only — run the WebSocket server elsewhere and point clients at your `wss://` URL.

## Note

This is not an official Hasbro Monopoly product. Rules follow widely used Monopoly mechanics on an original city-themed board.
