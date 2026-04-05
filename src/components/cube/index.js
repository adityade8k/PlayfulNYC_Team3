import * as THREE from 'three'

const COLOR_MAP = {
  red: '#ff4b4b',
  green: '#4bff6a',
  blue: '#4b8bff',
}

export function createFloatingCube({
  position = [0, 1.5, 0],
  size = 0.15,
  spinSpeed = 1.2,
} = {}) {
  const geometry = new THREE.BoxGeometry(size, size, size)
  const material = new THREE.MeshStandardMaterial({
    color: COLOR_MAP.red,
    roughness: 0.35,
    metalness: 0.15,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.interactive = true

  return {
    mesh,
    update(deltaSeconds) {
      mesh.rotation.y += deltaSeconds * spinSpeed
      mesh.rotation.x += deltaSeconds * spinSpeed * 0.6
    },
    applySharedState(sharedState) {
      if (!sharedState) return
      if (Array.isArray(sharedState.position) && sharedState.position.length === 3) {
        mesh.position.fromArray(sharedState.position)
      }
      if (Array.isArray(sharedState.rotation) && sharedState.rotation.length === 3) {
        mesh.rotation.fromArray(sharedState.rotation)
      }
      if (Array.isArray(sharedState.scale) && sharedState.scale.length === 3) {
        mesh.scale.fromArray(sharedState.scale)
      }
      const color =
        COLOR_MAP[sharedState.color] ??
        sharedState.color ??
        COLOR_MAP.red
      material.color.set(color)
    },
  }
}
