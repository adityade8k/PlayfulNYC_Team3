export const DEFAULT_SHARED_STATE = {
  cubes: [
    { color: 'red', position: [-0.45, 0.1, -1.1] },
    { color: 'blue', position: [0.45, 0.1, -1.1] },
  ],
}

export const FLOOR_Y = -1

export const PLAYER_SPAWN_POINTS = [
  // Deterministic two-player spawn mapping:
  // index 0 = left, index 1 = right (relative to shared world center).
  [-2, FLOOR_Y + 0.9, 0],
  [2, FLOOR_Y + 0.9, 0],
]

export const createDefaultSharedState = () => ({
  cubes: DEFAULT_SHARED_STATE.cubes.map((cube) => ({
    color: cube.color,
    position: [...cube.position],
  })),
})
