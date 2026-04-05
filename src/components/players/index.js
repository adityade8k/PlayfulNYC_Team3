import * as THREE from 'three'
import { GAME_CONFIG } from '../../config/game-config.js'

const {
  bodyRadius: BODY_RADIUS,
  bodyLength: BODY_LENGTH,
  headRadius: HEAD_RADIUS,
} = GAME_CONFIG.playerVisual.capsule
const HEAD_OFFSET_Y = BODY_LENGTH / 2 + BODY_RADIUS + HEAD_RADIUS * 0.8
const BODY_TO_HEAD_ESTIMATE = 0.75 // approximate offset from body center to glasses
const LOW_HEIGHT_THRESHOLD = 1.2   // glasses height below this → rotate capsule horizontal

// Passthrough mask material: writes alpha=0 to punch a hole through
// the virtual scene, letting the real-world camera feed show through.
const passthroughMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    void main() {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
  `,
  blending: THREE.NoBlending,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
})

export function createPlayerSystem(scene) {
  const playersGroup = new THREE.Group()
  playersGroup.name = 'players'
  // Render after the rest of the scene so the mask overwrites virtual content
  playersGroup.renderOrder = 999
  scene.add(playersGroup)

  const playerVisuals = new Map()
  const remoteTargets = new Map()
  const bodyGeometry = new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 6, 12)
  const headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 16, 12)

  const removePlayerVisual = (playerId) => {
    const visual = playerVisuals.get(playerId)
    if (!visual) return
    playersGroup.remove(visual.group)
    remoteTargets.delete(playerId)
    playerVisuals.delete(playerId)
  }

  const getOrCreatePlayerVisual = (playerId) => {
    const existing = playerVisuals.get(playerId)
    if (existing) return existing

    const group = new THREE.Group()
    const body = new THREE.Mesh(bodyGeometry, passthroughMaterial)
    const head = new THREE.Mesh(headGeometry, passthroughMaterial)
    head.position.y = HEAD_OFFSET_Y
    body.castShadow = true
    body.receiveShadow = false
    head.castShadow = true
    head.receiveShadow = false
    body.renderOrder = 999
    head.renderOrder = 999
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
      _localBodyPosition = null,
      _localBodyRotationY = null,
      deltaSeconds = 1 / 60,
      remoteCapsulesVisible = true
    ) {
      const seen = new Set()
      const lerpAlpha = 1 - Math.exp(-12 * deltaSeconds)

      for (const [playerId, player] of Object.entries(players)) {
        if (!remoteCapsulesVisible || !player.isInAr || playerId === selfId) {
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
          // If glasses are below 1.2m, rotate capsule 90° around Z (lying down)
          const estimatedHeadY = player.position[1] + BODY_TO_HEAD_ESTIMATE
          visual.group.rotation.z = estimatedHeadY < LOW_HEIGHT_THRESHOLD ? Math.PI / 2 : 0
        }
      }

      for (const [playerId] of playerVisuals.entries()) {
        if (!seen.has(playerId)) {
          removePlayerVisual(playerId)
        }
      }
    },
  }
}
