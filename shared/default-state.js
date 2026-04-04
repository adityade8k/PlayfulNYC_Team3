export const FLOOR_Y = -1

export const DEFAULT_SHARED_STATE = {
  color: 'red',
  position: [0, 0, -1],
  cubes: [
    { color: '#ff4b4b', position: [-0.7, FLOOR_Y + 1.1, -1] },
    { color: '#4b8bff', position: [0.7, FLOOR_Y + 1.1, -1] },
  ],
}

export const PLAYER_SPAWN_POINTS = [
  // Deterministic two-player spawn mapping:
  // index 0 = left, index 1 = right (relative to shared world center).
  [-2, FLOOR_Y + 0.9, 0],
  [2, FLOOR_Y + 0.9, 0],
]

export const createDefaultSharedState = () => ({
  color: DEFAULT_SHARED_STATE.color,
  position: [...DEFAULT_SHARED_STATE.position],
  cubes: DEFAULT_SHARED_STATE.cubes.map((cube) => ({
    color: cube.color,
    position: [...cube.position],
  })),
})
