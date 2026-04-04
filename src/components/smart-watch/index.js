import { createSmartWatchXRSystem } from './watch-system.js'

export const createSmartWatchComponent = ({ scene, camera, renderer }) =>
  createSmartWatchXRSystem({
    scene,
    camera,
    renderer,
    endpoint: '/api/landlord-call',
    onStatus: (message) => {
      console.log(`[smart-watch] ${message}`)
    },
  })
