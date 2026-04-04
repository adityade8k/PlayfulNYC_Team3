# Playful NYC XR Starter

Vite + vanilla JavaScript + Three.js XR scene with LAN multiplayer over WebSocket.
The app is intended to run from your computer and be opened from both desktop and headset on the same network.

## Current multiplayer behavior

- One shared ground plane anchors both players in the same world space.
- Deterministic spawn points:
  - first connected player -> left spawn
  - second connected player -> right spawn
- Each player is represented by a world-space capsule body.
- Local player capsule remains visible when looking down in XR.
- Remote player capsule updates continuously from networked position/rotation.
- Cubes change color when a player's ray intersects a cube and trigger/pinch is released.

## Setup

Install all dependencies:

```bash
npm install
```

## Development (editor workflow)

Run only Vite:

```bash
npm run dev
```

Run Vite and the LAN server command together:

```bash
npm run dev:all
```

Notes:

- `npm run dev` is best for quick client iteration.
- `npm run server` serves the built `dist` folder, so rebuild after client edits for LAN testing.
- `npm run dev:all` runs:
  - Vite on `:5173`
  - multiplayer LAN server on `:2026`

## Dev WebSocket behavior

Socket URL is resolved as:

- `VITE_WS_URL` (if set)
- otherwise `ws://<same-host>:2026` when app is served from Vite (`:5173`)
- otherwise same-origin WebSocket (`ws://<host>` or `wss://<host>`)

## Build + LAN server

Build the client first (required for LAN server):

```bash
npm run build
```

Run the LAN server (serves `dist` and hosts WebSocket on the same port):

```bash
npm run server
```

Server defaults to port `2026` and binds to `0.0.0.0`.

Default URLs:

- Desktop URL: `http://localhost:2026`
- Headset URL: `http://<computer-ip>:2026`

## Find your LAN IP

- macOS: run `ipconfig getifaddr en0` (or check System Settings -> Wi-Fi details).
- Windows: run `ipconfig` and use the IPv4 address from your active adapter.
- Linux: run `hostname -I` (or `ip addr`) and use your active interface IPv4 address.

## Chrome/WebXR local HTTP flag

When using local HTTP in headset browsers, enable insecure-origin treatment:

1. open `chrome://flags/`
2. enable **Insecure origins treated as secure**
3. add `http://<computer-ip>:2026`
4. relaunch browser

## How to test on headset

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the client:
   ```bash
   npm run build
   ```
3. Start the LAN server:
   ```bash
   npm run server
   ```
4. Open desktop browser at `http://localhost:2026`.
5. Open headset browser at `http://<computer-ip>:2026`.
6. Enter XR mode on headset and keep desktop open at the same time.

Expected behavior:

- both desktop and headset load the same scene
- WebSocket connects automatically on both clients
- shared state updates (cube colors) propagate in realtime
- first connected player spawns left, second connected player spawns right
- each player sees their own capsule when looking down and sees the other player capsule in world space

## Multiplayer + sync architecture

- `server/main.js` uses `express` + `ws` on one HTTP(S) server instance.
- `src/network/clientSync.js` provides shared-key sync helpers:
  - `connectSocket()`
  - `broadcastGlobal(name, value)`
  - `setSynchronized(name, value)`
  - `subscribeGlobal(name, handler)`
  - `synchronize(name, initialValue)`
- `src/network/multiplayer.js` keeps player snapshot/spawn sync for capsules.
- `src/main.js` handles scene setup, spawn recentering, local/remote capsule updates, and interaction-based cube recolor sync.

Player spawn behavior:

- first player to connect -> left spawn (`[-2, 0, 0]` reference side)
- second player to connect -> right spawn (`[2, 0, 0]` reference side)
- capsules update in realtime from shared player state
- cube colors update in realtime from trigger/pinch release events

## Optional HTTPS mode

`server/main.js` automatically switches to HTTPS if cert paths are provided:

- `HTTPS_KEY_PATH=/path/to/key.pem`
- `HTTPS_CERT_PATH=/path/to/cert.pem`

If those env vars are not set, it cleanly falls back to HTTP.

## Troubleshooting

- Ensure desktop and headset are on the same Wi-Fi/LAN.
- Check firewall settings and verify port `2026` is allowed inbound.
- If HTTPS is enabled with invalid certs, mixed-content/cert warnings can block XR or sockets.
- Accept permission prompts (camera/motion/XR) on both devices.
- If desktop WebSocket works but headset does not:
  - verify headset URL is exactly `http://<computer-ip>:2026`
  - verify the browser flag entry matches the exact origin
  - confirm no VPN or network isolation is blocking LAN peer traffic
  - check browser console on headset for blocked mixed-content or cert errors
