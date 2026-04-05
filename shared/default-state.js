export const DEFAULT_SHARED_STATE = {
  cubes: [
    { color: 'red', position: [-0.72, 0.9, -0.5] },
    { color: 'red', position: [-0.36, 0.9, -0.5] },
    { color: 'red', position: [0.0, 0.9, -0.5] },
    { color: 'red', position: [0.36, 0.9, -0.5] },
    { color: 'red', position: [0.72, 0.9, -0.5] },
  ],
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
  })),
})
