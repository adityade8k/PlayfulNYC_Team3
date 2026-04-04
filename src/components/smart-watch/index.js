import { createSmartWatchXRSystem } from './watch-system.js'

export const createSmartWatchComponent = ({
  scene,
  camera,
  renderer,
  playerNeedsSession,
  playerId = null,
}) =>
  createSmartWatchXRSystem({
    scene,
    camera,
    renderer,
    playerNeedsSession,
    playerId,
    endpoint: '/api/landlord-call',
    onStatus: (message) => {
      console.log(`[smart-watch] ${message}`)
    },
  })
