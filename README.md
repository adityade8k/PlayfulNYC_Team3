# Playful NYC XR Starter

Vite + vanilla JavaScript + Three.js starter for an AR passthrough scene.

## Run

```bash
npm install
npm run dev
```

## Run Multiplayer (client + Socket.IO server)

```bash
npm run dev:all
```

Server runs on `http://localhost:3001` and Vite on `http://localhost:5173`.

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

```bash
npm run deploy
```

This publishes the `dist` directory with `gh-pages`.

## Modular XR Components

- `src/components/cube/index.js`: floating and spinning cube example component.
- `src/components/controller/index.js`: XR controllers + raycasting + `select` events.
- `src/components/handtracking/index.js`: XR hands + raycasting + pinch click events.
- `src/components/gltf-loader/index.js`: reusable GLTF loader that exposes:
  - loaded root object
  - animation names/actions
  - animation state transitions via methods and `statechange` event
- `src/network/multiplayer.js`: shared-global-state multiplayer helper (`connectMultiplayer`, `broadcastGlobal`, `synchronize`, `subscribeState`, `getSnapshot`).
- `server/index.js`: Node.js + Socket.IO in-memory state server.
- `shared/default-state.js`: single source of truth for initial shared color/position.

`main.js` intentionally does not load a GLTF yet in this step.

## Git LFS model tracking

Git LFS is configured for:

- `*.gltf`
- `*.glb`
- `*.bin`
- `*.fbx`

When adding new model file types, run `git lfs track "<pattern>"`.
