import { createSmartWatchXRSystem } from './watch-system.js'

const resolveLandlordCallEndpoint = () => {
  const envUrl = import.meta.env.VITE_LANDLORD_CALL_URL
  if (typeof envUrl === 'string' && envUrl.length > 0) return envUrl
  return '/api/landlord-call'
}

export const createSmartWatchComponent = ({
  scene,
  camera,
  renderer,
  playerNeedsSession,
  playerId = null,
  onLandlordFinished = () => {},
  onOutcomeFinished = () => {},
}) =>
  createSmartWatchXRSystem({
    scene,
    camera,
    renderer,
    playerNeedsSession,
    playerId,
    onLandlordFinished,
    onOutcomeFinished,
    endpoint: resolveLandlordCallEndpoint(),
    onStatus: (message) => {
      console.log(`[smart-watch] ${message}`)
    },
  })
