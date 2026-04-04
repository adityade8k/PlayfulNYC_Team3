import './style.css'
import * as THREE from 'three'
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js'
import { createFloatingCube } from './components/cube/index.js'
import { createControllerSystem } from './components/controller/index.js'
import { createHandTrackingSystem } from './components/handtracking/index.js'
import { createPlayerSystem } from './components/players/index.js'
import { createSmartWatchComponent } from './components/smart-watch/index.js'
import {
  connectMultiplayer,
  broadcastGlobal,
  getSnapshot,
  setGlobal,
  synchronize,
  updateLocalPlayer,
} from './network/multiplayer.js'
import {
  FLOOR_Y,
  PLAYER_SPAWN_POINTS,
  createDefaultSharedState,
} from '../shared/default-state.js'

const sharedState = createDefaultSharedState()

setGlobal('sharedState', sharedState)
connectMultiplayer()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.01,
  100
)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.xr.enabled = true
renderer.setClearColor(0x000000, 0)
document.body.appendChild(renderer.domElement)

const arButton = ARButton.createButton(renderer, {
  requiredFeatures: [],
  optionalFeatures: ['dom-overlay', 'hand-tracking'],
  domOverlay: { root: document.body },
})
arButton.classList.add('ar-button')
document.body.appendChild(arButton)

scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.85))
const directional = new THREE.DirectionalLight(0xffffff, 0.5)
directional.position.set(1, 2, 1)
scene.add(directional)

const floor = new THREE.Mesh(
  // Shared ground plane visible to all players.
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshStandardMaterial({
    color: '#222831',
    roughness: 0.95,
    metalness: 0.02,
    side: THREE.DoubleSide,
  })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = FLOOR_Y
scene.add(floor)

const spawnMarkerColors = ['#44ff88', '#4488ff']
for (let index = 0; index < PLAYER_SPAWN_POINTS.length; index += 1) {
  const [x, , z] = PLAYER_SPAWN_POINTS[index]
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({
      color: spawnMarkerColors[index] || '#dddddd',
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    })
  )
  marker.rotation.x = -Math.PI / 2
  marker.position.set(x, FLOOR_Y + 0.003, z)
  scene.add(marker)
}

const floatingCubes = sharedState.cubes.map((cubeState, index) => {
  const floatingCube = createFloatingCube({
    position: cubeState.position,
    size: 0.16,
  })
  floatingCube.mesh.userData.cubeIndex = index
  scene.add(floatingCube.mesh)
  return floatingCube
})

const interactiveObjects = floatingCubes.map((cube) => cube.mesh)
const controllerSystem = createControllerSystem(renderer, scene, interactiveObjects)
const handTrackingSystem = createHandTrackingSystem(
  renderer,
  scene,
  interactiveObjects
)
const playerSystem = createPlayerSystem(scene)
const smartWatch = createSmartWatchComponent({ scene, camera, renderer })

window.render_game_to_text = smartWatch.renderGameToText
arButton.addEventListener('click', () => {
  smartWatch.maybeAutoStart()
})

const activeSources = new Set()
const lastHoveredCubeBySource = new Map()
const randomHexColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
let isInAr = false
const localHeadPosition = new THREE.Vector3()
const localBodyPosition = new THREE.Vector3()
const localHeadQuaternion = new THREE.Quaternion()
const localHeadEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const LOCAL_BODY_HEIGHT_FROM_HEAD = 0.75
const MIN_BODY_CENTER_Y = FLOOR_Y + 0.35
let localBodyRotationY = 0
let elapsedSeconds = 0
let lastPoseUpdateAt = 0
let hasLoggedLocalSpawnInfo = false
let hasAppliedSpawnReferenceSpace = false

const pushSharedState = () => {
  setGlobal('sharedState', sharedState)
  broadcastGlobal('sharedState', sharedState)
}

// Spawn assignment and recenter are driven by server-authoritative player data.
// This helper is safe to call every frame and only applies once per XR session.
const tryApplyLocalSpawnReferenceSpace = (snapshot) => {
  if (!isInAr || hasAppliedSpawnReferenceSpace) return
  const selfPlayer = snapshot.players?.[snapshot.selfId]
  if (!Array.isArray(selfPlayer?.spawnPosition) || selfPlayer.spawnPosition.length !== 3) {
    return
  }

  renderer.xr.getCamera().getWorldPosition(localHeadPosition)
  const [spawnX, spawnY, spawnZ] = selfPlayer.spawnPosition
  const targetHeadY = spawnY + LOCAL_BODY_HEIGHT_FROM_HEAD
  const referenceSpace = renderer.xr.getReferenceSpace()
  if (referenceSpace && typeof XRRigidTransform !== 'undefined') {
    const offset = new XRRigidTransform({
      x: spawnX - localHeadPosition.x,
      y: targetHeadY - localHeadPosition.y,
      z: spawnZ - localHeadPosition.z,
    })
    const offsetReferenceSpace = referenceSpace.getOffsetReferenceSpace(offset)
    renderer.xr.setReferenceSpace(offsetReferenceSpace)
    hasAppliedSpawnReferenceSpace = true
  }
}

const getHitCubeIndex = (intersections = []) => {
  for (const hit of intersections) {
    let current = hit.object
    while (current) {
      const cubeIndex = current.userData?.cubeIndex
      if (typeof cubeIndex === 'number') return cubeIndex
      current = current.parent
    }
  }
  return null
}

const onPress = (sourceId, detail = {}) => {
  activeSources.add(sourceId)
  const hitCubeIndex = getHitCubeIndex(detail.intersections)
  if (typeof hitCubeIndex === 'number') {
    lastHoveredCubeBySource.set(sourceId, hitCubeIndex)
  } else {
    lastHoveredCubeBySource.delete(sourceId)
  }
}

const onMove = (sourceId, detail = {}) => {
  if (!activeSources.has(sourceId)) return
  const hitCubeIndex = getHitCubeIndex(detail.intersections)
  if (typeof hitCubeIndex === 'number') {
    lastHoveredCubeBySource.set(sourceId, hitCubeIndex)
  }
}

const onRelease = (sourceId, detail = {}) => {
  if (!activeSources.has(sourceId)) return
  activeSources.delete(sourceId)

  // Recolor on trigger/pinch release if the ray is on a cube now,
  // or if it was hovering that cube just before release.
  const currentHitCubeIndex = getHitCubeIndex(detail.intersections)
  const hitCubeIndex =
    typeof currentHitCubeIndex === 'number'
      ? currentHitCubeIndex
      : lastHoveredCubeBySource.get(sourceId)

  lastHoveredCubeBySource.delete(sourceId)
  if (hitCubeIndex === null) return
  if (!sharedState.cubes[hitCubeIndex]) return

  // Only recolor when release happens while the ray/pinch is pointing at a cube.
  sharedState.cubes[hitCubeIndex].color = randomHexColor()
  pushSharedState()
}

controllerSystem.events.addEventListener('selectstart', (event) =>
  onPress(`controller-${event.detail.controllerIndex}`, event.detail)
)
controllerSystem.events.addEventListener('selectmove', (event) =>
  onMove(`controller-${event.detail.controllerIndex}`, event.detail)
)
controllerSystem.events.addEventListener('selectend', (event) =>
  onRelease(`controller-${event.detail.controllerIndex}`, event.detail)
)

handTrackingSystem.events.addEventListener('pinchstart', (event) =>
  onPress(`hand-${event.detail.handIndex}`, event.detail)
)
handTrackingSystem.events.addEventListener('pinchmove', (event) =>
  onMove(`hand-${event.detail.handIndex}`, event.detail)
)
handTrackingSystem.events.addEventListener('pinchend', (event) =>
  onRelease(`hand-${event.detail.handIndex}`, event.detail)
)

renderer.xr.addEventListener('sessionstart', () => {
  isInAr = true
  hasAppliedSpawnReferenceSpace = false
  smartWatch.maybeAutoStart()
  const snapshot = getSnapshot()
  const selfPlayer = snapshot.players?.[snapshot.selfId]
  tryApplyLocalSpawnReferenceSpace(snapshot)
  if (Array.isArray(selfPlayer?.spawnPosition) && selfPlayer.spawnPosition.length === 3) {
    const spawnSide = selfPlayer.slotIndex === 0 ? 'left' : 'right'
    console.log(
      `[client] local spawn assigned: ${spawnSide} (slot=${selfPlayer.slotIndex}, position=${selfPlayer.spawnPosition.join(',')})`
    )
    hasLoggedLocalSpawnInfo = true
  }

  renderer.xr.getCamera().getWorldPosition(localBodyPosition)
  localBodyPosition.y = Math.max(
    MIN_BODY_CENTER_Y,
    localBodyPosition.y - LOCAL_BODY_HEIGHT_FROM_HEAD
  )
  renderer.xr.getCamera().getWorldQuaternion(localHeadQuaternion)
  localHeadEuler.setFromQuaternion(localHeadQuaternion)
  localBodyRotationY = localHeadEuler.y
  updateLocalPlayer({
    isInAr: true,
    position: [localBodyPosition.x, localBodyPosition.y, localBodyPosition.z],
    rotationY: localBodyRotationY,
  })
})

renderer.xr.addEventListener('sessionend', () => {
  isInAr = false
  hasAppliedSpawnReferenceSpace = false
  updateLocalPlayer({ isInAr: false })
})

const timer = new THREE.Timer()
renderer.setAnimationLoop(() => {
  timer.update()
  const deltaSeconds = timer.getDelta()
  elapsedSeconds += deltaSeconds
  const elapsedMilliseconds = elapsedSeconds * 1000
  const networkState = synchronize('sharedState') || sharedState
  const snapshot = getSnapshot()
  tryApplyLocalSpawnReferenceSpace(snapshot)

  if (isInAr) {
    renderer.xr.getCamera().getWorldPosition(localHeadPosition)
    // Local capsule body is anchored in world space from headset pose
    // so the user can look down and still see their own body mesh.
    localBodyPosition.copy(localHeadPosition)
    localBodyPosition.y = Math.max(
      MIN_BODY_CENTER_Y,
      localBodyPosition.y - LOCAL_BODY_HEIGHT_FROM_HEAD
    )
    renderer.xr.getCamera().getWorldQuaternion(localHeadQuaternion)
    localHeadEuler.setFromQuaternion(localHeadQuaternion)
    localBodyRotationY = localHeadEuler.y
  }

  if (!hasLoggedLocalSpawnInfo && snapshot.selfId && snapshot.players?.[snapshot.selfId]) {
    const selfPlayer = snapshot.players[snapshot.selfId]
    const spawnSide = selfPlayer.slotIndex === 0 ? 'left' : 'right'
    console.log(
      `[client] local player connected as ${spawnSide} spawn (slot=${selfPlayer.slotIndex})`
    )
    hasLoggedLocalSpawnInfo = true
  }

  if (isInAr && elapsedSeconds - lastPoseUpdateAt > 1 / 20) {
    updateLocalPlayer({
      isInAr: true,
      position: [localBodyPosition.x, localBodyPosition.y, localBodyPosition.z],
      rotationY: localBodyRotationY,
    })
    lastPoseUpdateAt = elapsedSeconds
  }

  for (let index = 0; index < floatingCubes.length; index += 1) {
    const cube = floatingCubes[index]
    const cubeState = networkState?.cubes?.[index]
    if (cubeState) {
      cube.applySharedState(cubeState)
    }
    cube.update(deltaSeconds)
  }
  playerSystem.update(
    snapshot.players,
    snapshot.selfId,
    isInAr ? localBodyPosition : null,
    isInAr ? localBodyRotationY : null,
    deltaSeconds
  )
  controllerSystem.update()
  handTrackingSystem.update()
  smartWatch.update(elapsedMilliseconds, renderer.xr.getFrame?.() || null)
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
