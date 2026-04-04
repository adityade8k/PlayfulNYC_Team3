# Playful NYC XR Starter

Vite + vanilla JavaScript + Three.js XR scene with LAN multiplayer over WebSocket.

## Setup

Install all dependencies:

```bash
npm install
```

## Development

Run only Vite:

```bash
npm run dev
```

Run Vite and the LAN multiplayer server together:

```bash
npm run dev:all
```

## Build + LAN server

Build the client first:

```bash
npm run build
```

Run the LAN server (serves `dist` and hosts WebSocket on the same port):

```bash
npm run server
```

Default LAN server URL:

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

## Multiplayer + sync notes

- `server/main.js` uses `express` + `ws` on one HTTP(S) server instance.
- `src/network/clientSync.js` provides shared-key sync helpers:
  - `connectSocket()`
  - `broadcastGlobal(name, value)`
  - `subscribeGlobal(name, handler)`
  - `synchronize(name, initialValue)`
- `src/network/multiplayer.js` keeps player snapshot/spawn sync for capsules.
- `main.js` includes synced `ballInfo` example state:
  - `ballInfo = { rgb: "red", xyz: [0, 1.5, 0] }`

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
  - confirm no VPN or network isolation is blocking LAN peer traffic.
