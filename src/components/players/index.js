import * as THREE from 'three'

const LOCAL_COLOR = '#f8f871'
const REMOTE_COLOR = '#71d8ff'

export function createPlayerSystem(scene) {
  const playersGroup = new THREE.Group()
  playersGroup.name = 'players'
  scene.add(playersGroup)

  const playerMeshes = new Map()
  const remoteTargets = new Map()
  const geometry = new THREE.CapsuleGeometry(0.14, 0.45, 4, 8)

  const getOrCreatePlayerMesh = (playerId) => {
    const existing = playerMeshes.get(playerId)
    if (existing) return existing

    const material = new THREE.MeshStandardMaterial({
      color: REMOTE_COLOR,
      roughness: 0.5,
      metalness: 0.05,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    playersGroup.add(mesh)
    playerMeshes.set(playerId, mesh)
    return mesh
  }

  return {
    update(
      players = {},
      selfId = null,
      localBodyPosition = null,
      localBodyRotationY = null,
      deltaSeconds = 1 / 60
    ) {
      const seen = new Set()
      const lerpAlpha = 1 - Math.exp(-12 * deltaSeconds)

      for (const [playerId, player] of Object.entries(players)) {
        if (!player.isInAr) continue
        seen.add(playerId)
        const mesh = getOrCreatePlayerMesh(playerId)
        if (playerId === selfId && localBodyPosition) {
          mesh.position.copy(localBodyPosition)
          if (typeof localBodyRotationY === 'number') {
            mesh.rotation.y = localBodyRotationY
          }
        } else if (Array.isArray(player.position) && player.position.length === 3) {
          const target = remoteTargets.get(playerId) || new THREE.Vector3()
          target.fromArray(player.position)
          remoteTargets.set(playerId, target)
          if (mesh.position.lengthSq() === 0) {
            mesh.position.copy(target)
          } else {
            // Smooth remote capsule updates from networked body positions.
            mesh.position.lerp(target, lerpAlpha)
          }
          if (typeof player.rotationY === 'number') {
            mesh.rotation.y = player.rotationY
          }
        }
        const color = playerId === selfId ? LOCAL_COLOR : REMOTE_COLOR
        mesh.material.color.set(color)
      }

      for (const [playerId, mesh] of playerMeshes.entries()) {
        if (!seen.has(playerId)) {
          playersGroup.remove(mesh)
          mesh.material.dispose()
          remoteTargets.delete(playerId)
          playerMeshes.delete(playerId)
        }
      }
    },
  }
}
