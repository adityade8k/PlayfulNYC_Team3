import * as THREE from 'three'

const REMOTE_COLOR = '#71d8ff'
const BODY_RADIUS = 0.14
const BODY_LENGTH = 0.65
const HEAD_RADIUS = 0.11
const HEAD_OFFSET_Y = BODY_LENGTH / 2 + BODY_RADIUS + HEAD_RADIUS * 0.8

export function createPlayerSystem(scene) {
  const playersGroup = new THREE.Group()
  playersGroup.name = 'players'
  scene.add(playersGroup)

  const playerVisuals = new Map()
  const remoteTargets = new Map()
  const bodyGeometry = new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 6, 12)
  const headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 16, 12)

  const removePlayerVisual = (playerId) => {
    const visual = playerVisuals.get(playerId)
    if (!visual) return
    playersGroup.remove(visual.group)
    visual.body.material.dispose()
    visual.head.material.dispose()
    remoteTargets.delete(playerId)
    playerVisuals.delete(playerId)
  }

  const getOrCreatePlayerVisual = (playerId) => {
    const existing = playerVisuals.get(playerId)
    if (existing) return existing

    const material = new THREE.MeshStandardMaterial({
      color: REMOTE_COLOR,
      roughness: 0.5,
      metalness: 0.05,
    })
    const group = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, material)
    const head = new THREE.Mesh(headGeometry, material.clone())
    head.position.y = HEAD_OFFSET_Y
    body.castShadow = false
    body.receiveShadow = false
    head.castShadow = false
    head.receiveShadow = false
    group.add(body)
    group.add(head)
    playersGroup.add(group)
    const visual = { group, body, head }
    playerVisuals.set(playerId, visual)
    return visual
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
        if (!player.isInAr || playerId === selfId) {
          removePlayerVisual(playerId)
          continue
        }
        seen.add(playerId)
        const visual = getOrCreatePlayerVisual(playerId)
        if (Array.isArray(player.position) && player.position.length === 3) {
          const hasRemoteTarget = remoteTargets.has(playerId)
          const target = remoteTargets.get(playerId) || new THREE.Vector3()
          target.fromArray(player.position)
          remoteTargets.set(playerId, target)
          if (!hasRemoteTarget) {
            visual.group.position.copy(target)
          } else {
            // Smooth remote capsule updates from networked body positions.
            visual.group.position.lerp(target, lerpAlpha)
          }
          if (typeof player.rotationY === 'number') {
            visual.group.rotation.y = player.rotationY
          }
        }
        visual.body.material.color.set(REMOTE_COLOR)
        visual.head.material.color.set(REMOTE_COLOR)
      }

      for (const [playerId] of playerVisuals.entries()) {
        if (!seen.has(playerId)) {
          removePlayerVisual(playerId)
        }
      }
    },
  }
}
