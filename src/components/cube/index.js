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
  const radius = Math.max(0.02, size * 0.5)
  const geometry = new THREE.SphereGeometry(radius, 28, 18)
  const material = new THREE.MeshStandardMaterial({
    color: COLOR_MAP.red,
    emissive: COLOR_MAP.red,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.05,
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
      material.emissive.set(color)
    },
  }
}
