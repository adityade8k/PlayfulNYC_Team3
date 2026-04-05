import {
  SWITCH_STATE_NAMES,
  GAME_CONFIG,
  createDefaultRoundState,
} from '../src/config/game-config.js'

export const DEFAULT_SHARED_STATE = {
  cubes: GAME_CONFIG.switches.map((entry) => ({
    color: 'red',
    position: [...entry.position],
    rotation: [...entry.rotation],
    scale: [...entry.scale],
    stateName: entry.stateName,
  })),
  environmentAnimationStates: {
    bed1: false,
    bed2: false,
    shower: false,
    kitchen: false,
    toilet: false,
  },
  round: createDefaultRoundState(),
}

// Canonical shared floor plane. Calibration maps real floor to this Y.
export const FLOOR_Y = 0

export const PLAYER_SPAWN_POINTS = [
  // Deterministic two-player spawn mapping:
  // index 0 = left, index 1 = right (relative to shared world center).
  [-0.5, FLOOR_Y + 0.009, 0],
  [0.5, FLOOR_Y + 0.009, 0],
]

export const createDefaultSharedState = () => ({
  cubes: DEFAULT_SHARED_STATE.cubes.map((cube) => ({
    color: cube.color,
    position: [...cube.position],
    rotation: [...cube.rotation],
    scale: [...cube.scale],
    stateName: cube.stateName,
  })),
  environmentAnimationStates: {
    ...DEFAULT_SHARED_STATE.environmentAnimationStates,
  },
  round: createDefaultRoundState(),
})

export const normalizeEnvironmentStates = (incoming = {}) => {
  const normalized = {}
  for (let index = 0; index < SWITCH_STATE_NAMES.length; index += 1) {
    const stateName = SWITCH_STATE_NAMES[index]
    normalized[stateName] = Boolean(incoming?.[stateName])
  }
  return normalized
}
