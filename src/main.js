import './style.css'
import * as THREE from 'three'
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createFloatingCube } from './components/cube/index.js'
import { createControllerSystem } from './components/controller/index.js'
import { createHandTrackingSystem } from './components/handtracking/index.js'
import { createPlayerSystem } from './components/players/index.js'
import { createSmartWatchComponent } from './components/smart-watch/index.js'
import environmentModelUrl from './assets/model.glb?url'
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
  normalizeEnvironmentStates,
} from '../shared/default-state.js'
import {
  NEEDS_CONFIG,
  PlayerNeedsSession,
  getSessionCompletionPercent,
  getWatchClockFromElapsed,
} from './components/needs/index.js'
import {
  ENVIRONMENT_ANIMATION_STATE_CONFIG,
  createEnvironmentAnimationStateController,
} from './animation/environment-state-controller.js'
import { ZoneSystem } from './components/needs/zones.js'
import { InteractionSystem } from './components/needs/interactions.js'
import { CalibrationState, createCalibrationSystem } from './xr/calibration.js'
import {
  createDefaultRoundState,
  GAME_CONFIG,
  ROUND_PHASES,
  SWITCH_STATE_NAMES,
  ZONE_IDS,
} from './config/game-config.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const SPAWN_SIDE_TO_SLOT_INDEX = Object.freeze({
  left: 0,
  right: 1,
})

const getNeedsPlayerIdFromSlot = (slotIndex) => {
  if (slotIndex === 0) return 'player_1'
  if (slotIndex === 1) return 'player_2'
  return null
}

const getNeedsPlayerIdForSnapshot = (snapshot) => {
  const selfPlayer = snapshot.players?.[snapshot.selfId]
  if (!selfPlayer) return null
  return getNeedsPlayerIdFromSlot(selfPlayer.slotIndex)
}

const getCubeColorForStateValue = (isOn) => (isOn ? 'green' : 'red')
const INTERACTIVE_CUBE_STATE_NAMES = new Set(['kitchen', 'bed1', 'bed2'])

const normalizeRoundState = (incoming = null) => {
  const fallback = createDefaultRoundState()
  const incomingSpawnSelection =
    incoming && typeof incoming === 'object' && incoming.spawnSelection
      ? incoming.spawnSelection
      : null
  const rawPlayerSides =
    incomingSpawnSelection && typeof incomingSpawnSelection.playerSides === 'object'
      ? incomingSpawnSelection.playerSides
      : {}
  const normalizedPlayerSides = {}
  for (const [playerId, side] of Object.entries(rawPlayerSides)) {
    if (side === 'left' || side === 'right') {
      normalizedPlayerSides[playerId] = side
    }
  }
  const takenSides = new Set(Object.values(normalizedPlayerSides))
  if (!incoming || typeof incoming !== 'object') return fallback
  return {
    phase:
      Object.values(ROUND_PHASES).includes(incoming.phase)
        ? incoming.phase
        : fallback.phase,
    zoneOccupancy: Object.fromEntries(
      ZONE_IDS.map((zoneId) => [zoneId, incoming.zoneOccupancy?.[zoneId] || null])
    ),
    spawnSelection: {
      leftTaken: takenSides.has('left'),
      rightTaken: takenSides.has('right'),
      playerSides: normalizedPlayerSides,
    },
    needsSummary: incoming.needsSummary || null,
    version:
      Number.isFinite(Number(incoming.version)) && Number(incoming.version) >= 0
        ? Number(incoming.version)
        : 0,
  }
}

const normalizeSharedState = (incoming) => {
  const base = createDefaultSharedState()
  if (!incoming || typeof incoming !== 'object') return base
  const next = clone(base)

  if (Array.isArray(incoming.cubes)) {
    next.cubes = incoming.cubes.map((cube, index) => {
      const fallback = base.cubes[index] || base.cubes[0]
      return {
        color: typeof cube?.color === 'string' ? cube.color : fallback.color,
        position: Array.isArray(cube?.position) ? [...cube.position] : [...fallback.position],
        rotation: Array.isArray(cube?.rotation) ? [...cube.rotation] : [...fallback.rotation],
        scale: Array.isArray(cube?.scale) ? [...cube.scale] : [...fallback.scale],
        stateName: typeof cube?.stateName === 'string' ? cube.stateName : fallback.stateName,
      }
    })
  }

  next.environmentAnimationStates = normalizeEnvironmentStates(
    incoming.environmentAnimationStates
  )
  next.round = normalizeRoundState(incoming.round)
  return next
}

const computeSummaryPayload = (summaries) => {
  const teamScore = Math.round(
    (summaries[0].overallScore + summaries[1].overallScore) / 2
  )
  const teamStars = teamScore >= 80 ? 3 : teamScore >= 50 ? 2 : teamScore >= 25 ? 1 : 0
  const allShameEvents = summaries.flatMap((summary) =>
    Object.entries(summary.shameSummary || {}).map(([need, data]) => ({
      playerId: summary.playerId,
      need,
      count: data.count,
      message: data.messages?.[0] || '',
    }))
  )
  return { summaries, teamScore, teamStars, allShameEvents }
}

setGlobal('sharedState', normalizeSharedState(synchronize('sharedState')))
connectMultiplayer()

const scene = new THREE.Scene()
const sharedSceneGroup = new THREE.Group()
sharedSceneGroup.name = 'shared-scene'
sharedSceneGroup.visible = false
scene.add(sharedSceneGroup)

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100)
const sleepEffectMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.48, 28, 20),
  new THREE.MeshBasicMaterial({
    color: '#1d2f4f',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
)
sleepEffectMesh.visible = false
sleepEffectMesh.renderOrder = 50
camera.add(sleepEffectMesh)
const debugCameraEnabled = Boolean(GAME_CONFIG.debug?.camera?.enabled)
let debugOrbitControls = null
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
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
scene.add(new THREE.AmbientLight(0xffffff, 0.25))
const directional = new THREE.DirectionalLight(0xffffff, 0.5)
directional.position.set(1, 2, 1)
scene.add(directional)

const sharedState = normalizeSharedState(synchronize('sharedState'))
const pushSharedState = () => {
  setGlobal('sharedState', sharedState)
  broadcastGlobal('sharedState', sharedState)
}

const activeSources = new Set()
const lastHoveredCubeBySource = new Map()
const localHeadPosition = new THREE.Vector3()
const localBodyPosition = new THREE.Vector3()
const localHeadQuaternion = new THREE.Quaternion()
const localHeadEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const referenceSpaceRotation = new THREE.Quaternion()
const rotatedHeadPosition = new THREE.Vector3()
const worldUpAxis = new THREE.Vector3(0, 1, 0)

let environmentAnimationMixer = null
const environmentAnimationActions = []
let environmentAnimationStateController = null
let isReconcilingEnvironmentAnimationState = false
let pendingEnvironmentAnimationStateSnapshot = null
let hasAppliedSpawnReferenceSpace = false
let calibrationResult = null
let isInAr = false
let isSharedSceneActive = false
let localBodyHeightFromHead = 0.75
let minBodyCenterY = FLOOR_Y + 0.35
let localBodyRotationY = 0
let elapsedSeconds = 0
let lastPoseUpdateAt = 0
let lastKnownRoundPhase = ROUND_PHASES.boot
let localIntroCallStarted = false
let localOutcomeCallStarted = false
let localIntroFinished = false
let localOutcomeFinished = false
let localRightGripDown = false
let hasUnlockedWatchAudio = false
let isUnlockingWatchAudio = false
let hasPlayedNightSound = false
let hasPlayedNextMorningSound = false
let previousNeedsCompletionPercent = 0
let baseReferenceSpace = null
let lastBroadcastZoneOccupancy = normalizeRoundState().zoneOccupancy
let outcomeFallbackStartedAt = null
let sleepEffectTargetOpacity = 0
const localInteractionDrivenStates = {
  toilet: false,
  shower: false,
}
const localInteractionDesiredStates = {
  toilet: false,
  shower: false,
}
const localInteractionStateInFlight = {
  toilet: false,
  shower: false,
}

const NIGHT_COMPLETION_PERCENT =
  Number(NEEDS_CONFIG.sessionMilestones?.nightCompletionPercent) || 50
const NEXT_MORNING_COMPLETION_PERCENT =
  Number(NEEDS_CONFIG.sessionMilestones?.nextMorningCompletionPercent) || 90
const SKIP_INTRO_CALL_AND_SHOW_STATS = Boolean(GAME_CONFIG.round?.skipIntroCallAndShowStats)
const nightAudio = new Audio('/sounds/cricket.mp3')
nightAudio.preload = 'auto'
const nextMorningAudio = new Audio('/sounds/bird.mp3')
nextMorningAudio.preload = 'auto'
const interactionSoundPathByType = {
  hunger: '/sounds/kitchen.mp3',
  poop: '/sounds/poop.mp3',
  shower: '/sounds/shower.mp3',
  sleep: '/sounds/snore.mp3',
  fun: '/sounds/game.mp3',
}
const interactionLoopAudioByType = Object.fromEntries(
  Object.entries(interactionSoundPathByType).map(([type, path]) => [type, new Audio(path)])
)
const interactionOneShotAudio = {}
const interactionSequenceByType = {
  hunger: [],
  poop: [],
  shower: [],
  sleep: [],
  fun: [],
}
for (const audio of Object.values(interactionLoopAudioByType)) {
  audio.preload = 'auto'
  audio.loop = true
}
for (const audio of Object.values(interactionOneShotAudio)) {
  audio.preload = 'auto'
  audio.loop = false
}
let currentInteractionType = null
let interactionAudioSequenceToken = 0
const lastZoneUsageByPlayer = {
  player_1: null,
  player_2: null,
}

const applySharedStateSnapshotLocally = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return
  const normalized = normalizeSharedState(snapshot)
  sharedState.cubes = normalized.cubes
  sharedState.environmentAnimationStates = normalized.environmentAnimationStates
  sharedState.round = normalized.round
}

const normalizeEnvironmentAnimationStateSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null
  const normalized = {}
  let hasKnown = false
  for (const stateName of SWITCH_STATE_NAMES) {
    if (stateName in snapshot) hasKnown = true
    normalized[stateName] = Boolean(snapshot[stateName])
  }
  return hasKnown ? normalized : null
}

const syncCubeColorsFromEnvironmentState = (stateSnapshot, { shouldBroadcast = true } = {}) => {
  sharedState.environmentAnimationStates = normalizeEnvironmentStates(stateSnapshot)
  for (let index = 0; index < GAME_CONFIG.switches.length; index += 1) {
    const stateName = GAME_CONFIG.switches[index].stateName
    if (!sharedState.cubes[index]) continue
    sharedState.cubes[index].color = getCubeColorForStateValue(Boolean(stateSnapshot[stateName]))
  }
  if (shouldBroadcast) pushSharedState()
}

const setEnvironmentAnimationState = async (stateName, nextValue, source) => {
  if (!environmentAnimationStateController) return false
  const didApply = await environmentAnimationStateController.setState(stateName, nextValue, {
    source,
  })
  if (!didApply) return false
  syncCubeColorsFromEnvironmentState(environmentAnimationStateController.getSnapshot(), {
    shouldBroadcast: true,
  })
  return true
}

const flushLocalInteractionDrivenState = (stateName) => {
  if (!(stateName in localInteractionDrivenStates)) return
  if (localInteractionStateInFlight[stateName]) return
  const shouldBeOn = Boolean(localInteractionDesiredStates[stateName])
  if (localInteractionDrivenStates[stateName] === shouldBeOn) return
  localInteractionStateInFlight[stateName] = true
  void setEnvironmentAnimationState(
    stateName,
    shouldBeOn,
    `zone-grip:${stateName}`
  ).then((didApply) => {
    if (didApply) {
      localInteractionDrivenStates[stateName] = shouldBeOn
    }
  }).finally(() => {
    localInteractionStateInFlight[stateName] = false
    if (localInteractionDrivenStates[stateName] !== localInteractionDesiredStates[stateName]) {
      flushLocalInteractionDrivenState(stateName)
    }
  })
}

const syncLocalInteractionDrivenState = (stateName, shouldBeOn) => {
  if (!(stateName in localInteractionDrivenStates)) return
  localInteractionDesiredStates[stateName] = Boolean(shouldBeOn)
  flushLocalInteractionDrivenState(stateName)
}

const releaseLocalInteractionDrivenStates = () => {
  syncLocalInteractionDrivenState('toilet', false)
  syncLocalInteractionDrivenState('shower', false)
}

const scheduleEnvironmentAnimationStateReconciliation = (incomingSnapshot, source = 'network') => {
  const targetSnapshot = normalizeEnvironmentAnimationStateSnapshot(incomingSnapshot)
  if (!targetSnapshot || !environmentAnimationStateController) return
  pendingEnvironmentAnimationStateSnapshot = targetSnapshot
  if (isReconcilingEnvironmentAnimationState) return

  isReconcilingEnvironmentAnimationState = true
  void (async () => {
    try {
      while (pendingEnvironmentAnimationStateSnapshot) {
        const target = pendingEnvironmentAnimationStateSnapshot
        pendingEnvironmentAnimationStateSnapshot = null

        let loops = SWITCH_STATE_NAMES.length * 2
        while (loops > 0) {
          loops -= 1
          const current = environmentAnimationStateController.getSnapshot()
          let hasDiff = false
          let applied = false
          for (const stateName of SWITCH_STATE_NAMES) {
            const desired = Boolean(target[stateName])
            if (Boolean(current[stateName]) === desired) continue
            hasDiff = true
            const didApply = await environmentAnimationStateController.setState(
              stateName,
              desired,
              { source }
            )
            if (didApply) applied = true
          }
          if (!hasDiff || !applied) break
        }

        syncCubeColorsFromEnvironmentState(environmentAnimationStateController.getSnapshot(), {
          shouldBroadcast: false,
        })
      }
    } finally {
      isReconcilingEnvironmentAnimationState = false
    }
  })()
}

const gltfLoader = new GLTFLoader()
void gltfLoader.loadAsync(environmentModelUrl).then((gltf) => {
  const environmentModel = gltf.scene
  environmentModel.position.fromArray(GAME_CONFIG.environmentModel.position)
  environmentModel.rotation.fromArray(GAME_CONFIG.environmentModel.rotation)
  environmentModel.scale.fromArray(GAME_CONFIG.environmentModel.scale)
  sharedSceneGroup.add(environmentModel)

  if (!Array.isArray(gltf.animations) || gltf.animations.length === 0) return
  environmentAnimationMixer = new THREE.AnimationMixer(environmentModel)
  for (let clipIndex = 0; clipIndex < gltf.animations.length; clipIndex += 1) {
    const action = environmentAnimationMixer.clipAction(gltf.animations[clipIndex])
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.enabled = false
    action.stop()
    environmentAnimationActions.push(action)
  }
  environmentAnimationStateController = createEnvironmentAnimationStateController({
    config: ENVIRONMENT_ANIMATION_STATE_CONFIG,
    mixer: environmentAnimationMixer,
    actions: environmentAnimationActions,
  })
  scheduleEnvironmentAnimationStateReconciliation(sharedState.environmentAnimationStates, 'init')
}).catch((error) => {
  console.error('[environment] failed to load model', error)
})

const playerNeedsSession = new PlayerNeedsSession({
  gameDuration: GAME_CONFIG.round.durationSeconds,
})
playerNeedsSession.addPlayer('player_1')
playerNeedsSession.addPlayer('player_2')

const floatingCubes = GAME_CONFIG.switches.map((switchConfig, index) => {
  if (!INTERACTIVE_CUBE_STATE_NAMES.has(switchConfig.stateName)) {
    return null
  }
  const cubeState = sharedState.cubes[index]
  const baseScale = Array.isArray(cubeState?.scale) ? cubeState.scale[0] : 0.16
  const cube = createFloatingCube({
    position: cubeState?.position || switchConfig.position,
    size: baseScale,
  })
  cube.mesh.rotation.fromArray(cubeState?.rotation || switchConfig.rotation || [0, 0, 0])
  cube.mesh.userData.cubeIndex = index
  cube.mesh.userData.stateName = switchConfig.stateName
  sharedSceneGroup.add(cube.mesh)
  return cube
})

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
  sharedSceneGroup.add(marker)
}

const interactiveObjects = floatingCubes
  .filter(Boolean)
  .map((cube) => cube.mesh)
const controllerSystem = createControllerSystem(renderer, scene, interactiveObjects)
const handTrackingSystem = createHandTrackingSystem(renderer, scene, interactiveObjects)
const playerSystem = createPlayerSystem(sharedSceneGroup)
const calibrationSystem = createCalibrationSystem({
  renderer,
  scene,
  controllers: controllerSystem.controllers,
})
interactiveObjects.push(...calibrationSystem.getSpawnSelectionInteractiveObjects())
const zoneSystem = new ZoneSystem(sharedSceneGroup, {
  debug: GAME_CONFIG.debug.zonesVisible,
})
const interactionSystem = new InteractionSystem(playerNeedsSession)

const smartWatch = createSmartWatchComponent({
  scene,
  camera,
  renderer,
  playerNeedsSession,
  onLandlordFinished: () => {
    localIntroFinished = true
  },
  onOutcomeFinished: () => {
    localOutcomeFinished = true
  },
})
smartWatch.setVisible(false)
window.render_game_to_text = smartWatch.renderGameToText

const unlockWatchAudioFromGesture = () => {
  if (hasUnlockedWatchAudio || isUnlockingWatchAudio) return
  isUnlockingWatchAudio = true
  void smartWatch
    .unlockAudio()
    .then((unlocked) => {
      hasUnlockedWatchAudio = Boolean(unlocked)
    })
    .finally(() => {
      isUnlockingWatchAudio = false
    })
}

if (debugCameraEnabled) {
  const debugCameraConfig = GAME_CONFIG.debug.camera
  camera.position.fromArray(debugCameraConfig.position || [0, 2, 3])
  camera.lookAt(...(debugCameraConfig.lookAt || [0, 1, 0]))
  debugOrbitControls = new OrbitControls(camera, renderer.domElement)
  debugOrbitControls.target.fromArray(debugCameraConfig.lookAt || [0, 1, 0])
  debugOrbitControls.enableDamping = true
  debugOrbitControls.dampingFactor = 0.08
  debugOrbitControls.minDistance = Number(debugCameraConfig.minDistance) || 0.4
  debugOrbitControls.maxDistance = Number(debugCameraConfig.maxDistance) || 8
  debugOrbitControls.update()
  sharedSceneGroup.visible = true
  zoneSystem.setDebugVisible(true)

  window.debugZones = {
    get: () => zoneSystem.getZoneTransforms(),
    set: (zoneId, transform) => zoneSystem.setZoneTransform(zoneId, transform),
    printConfig: () => {
      const data = zoneSystem.getZoneTransforms()
      const configSnippet = JSON.stringify(data, null, 2)
      console.log('[debugZones] copy into GAME_CONFIG.zones:', configSnippet)
      return configSnippet
    },
  }

  const resolveCubeIndex = (cubeRef) => {
    if (typeof cubeRef === 'number' && cubeRef >= 0 && cubeRef < sharedState.cubes.length) {
      return cubeRef
    }
    if (typeof cubeRef === 'string') {
      const byId = GAME_CONFIG.switches.findIndex((entry) => entry.id === cubeRef)
      if (byId !== -1) return byId
      const byState = GAME_CONFIG.switches.findIndex((entry) => entry.stateName === cubeRef)
      if (byState !== -1) return byState
    }
    return -1
  }

  const applyCubeTransformByIndex = (cubeIndex, transform = {}) => {
    const cubeState = sharedState.cubes[cubeIndex]
    const cube = floatingCubes[cubeIndex]
    if (!cubeState || !cube) return false

    if (Array.isArray(transform.position) && transform.position.length === 3) {
      cubeState.position = [...transform.position]
      cube.mesh.position.fromArray(cubeState.position)
    }
    if (Array.isArray(transform.rotation) && transform.rotation.length === 3) {
      cubeState.rotation = [...transform.rotation]
      cube.mesh.rotation.fromArray(cubeState.rotation)
    }
    if (Array.isArray(transform.scale) && transform.scale.length === 3) {
      cubeState.scale = [...transform.scale]
      cube.mesh.scale.fromArray(cubeState.scale)
    }
    pushSharedState()
    return true
  }

  window.debugCubes = {
    get: () =>
      sharedState.cubes.map((cubeState, index) => ({
        index,
        id: GAME_CONFIG.switches[index]?.id || null,
        stateName: GAME_CONFIG.switches[index]?.stateName || cubeState.stateName || null,
        position: [...cubeState.position],
        rotation: [...cubeState.rotation],
        scale: [...cubeState.scale],
      })),
    set: (cubeRef, transform) => {
      const cubeIndex = resolveCubeIndex(cubeRef)
      if (cubeIndex === -1) return false
      return applyCubeTransformByIndex(cubeIndex, transform)
    },
    printConfig: () => {
      const data = sharedState.cubes.map((cubeState, index) => ({
        id: GAME_CONFIG.switches[index]?.id || `switch-${index + 1}`,
        stateName: GAME_CONFIG.switches[index]?.stateName || cubeState.stateName,
        position: [...cubeState.position],
        rotation: [...cubeState.rotation],
        scale: [...cubeState.scale],
      }))
      const configSnippet = JSON.stringify(data, null, 2)
      console.log('[debugCubes] copy into GAME_CONFIG.switches:', configSnippet)
      return configSnippet
    },
  }
}

const isHost = (snapshot) => {
  const selfPlayer = snapshot.players?.[snapshot.selfId]
  return Boolean(selfPlayer && selfPlayer.slotIndex === 0)
}

const isPlayerReadyForIntro = (player) => {
  if (!player?.isInAr) return false
  // Backward-compatible fallback: if readiness flag has not propagated yet,
  // treat "in AR" as ready so intro does not stall.
  if (typeof player.readyInSharedScene !== 'boolean') return true
  return player.readyInSharedScene
}

const getRequiredRoundPlayerCount = (players) => {
  const participantCount = Object.values(players || {}).filter(
    (player) => player && (player.slotIndex === 0 || player.slotIndex === 1)
  ).length
  return Math.max(1, Math.min(2, participantCount || 1))
}

const initializeLocalBodyFromHead = () => {
  renderer.xr.getCamera().getWorldPosition(localHeadPosition)
  localBodyPosition.copy(localHeadPosition)
  localBodyPosition.y = Math.max(minBodyCenterY, localBodyPosition.y - localBodyHeightFromHead)
  renderer.xr.getCamera().getWorldQuaternion(localHeadQuaternion)
  localHeadEuler.setFromQuaternion(localHeadQuaternion)
  localBodyRotationY = localHeadEuler.y
}

const playMilestoneSound = async (audio) => {
  try {
    audio.currentTime = 0
    await audio.play()
  } catch {
    // Ignore blocked autoplay in headset browser.
  }
}

const stopInteractionAudio = () => {
  interactionAudioSequenceToken += 1
  for (const audio of Object.values(interactionLoopAudioByType)) {
    audio.pause()
    audio.currentTime = 0
  }
  for (const audio of Object.values(interactionOneShotAudio)) {
    audio.pause()
    audio.currentTime = 0
  }
  currentInteractionType = null
}

const playAudioWithRetry = async (audio) => {
  if (!audio) return
  try {
    await audio.play()
  } catch {
    // Ignore blocked autoplay in headset browser.
  }
}

const playOneShotAudio = async (audio) => {
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
  await playAudioWithRetry(audio)
  if (audio.paused) return
  await new Promise((resolve) => {
    const finish = () => {
      audio.removeEventListener('ended', finish)
      audio.removeEventListener('error', finish)
      resolve()
    }
    audio.addEventListener('ended', finish, { once: true })
    audio.addEventListener('error', finish, { once: true })
  })
}

const setCurrentInteractionType = (nextType) => {
  const normalizedType =
    nextType && Object.prototype.hasOwnProperty.call(interactionLoopAudioByType, nextType)
      ? nextType
      : null
  if (currentInteractionType === normalizedType) return
  interactionAudioSequenceToken += 1
  const sequenceToken = interactionAudioSequenceToken
  for (const audio of Object.values(interactionLoopAudioByType)) {
    audio.pause()
    audio.currentTime = 0
  }
  for (const audio of Object.values(interactionOneShotAudio)) {
    audio.pause()
    audio.currentTime = 0
  }
  currentInteractionType = normalizedType
  if (!normalizedType) return

  void (async () => {
    const preSounds = interactionSequenceByType[normalizedType] || []
    for (const soundName of preSounds) {
      if (interactionAudioSequenceToken !== sequenceToken) return
      await playOneShotAudio(interactionOneShotAudio[soundName])
    }
    if (interactionAudioSequenceToken !== sequenceToken) return
    if (currentInteractionType !== normalizedType) return
    const loopAudio = interactionLoopAudioByType[normalizedType]
    if (!loopAudio) return
    loopAudio.currentTime = 0
    await playAudioWithRetry(loopAudio)
  })()
}

const stopInteractionAudioForInactiveState = (activeTypeOrNull) => {
  if (activeTypeOrNull) {
    setCurrentInteractionType(activeTypeOrNull)
    return
  }
  stopInteractionAudio()
}

const mapNeedToInteractionType = (needId) => {
  if (!needId) return null
  return interactionSoundPathByType[needId] ? needId : null
}

const setRoundPhase = (nextPhase, snapshot, { needsSummary = undefined } = {}) => {
  if (!isHost(snapshot)) return
  if (sharedState.round.phase === nextPhase && typeof needsSummary === 'undefined') return
  sharedState.round.phase = nextPhase
  if (typeof needsSummary !== 'undefined') {
    sharedState.round.needsSummary = needsSummary
  }
  sharedState.round.version += 1
  pushSharedState()
}

const clearRoundOccupancy = () => {
  sharedState.round.zoneOccupancy = Object.fromEntries(ZONE_IDS.map((zoneId) => [zoneId, null]))
  lastBroadcastZoneOccupancy = clone(sharedState.round.zoneOccupancy)
}

const resolveSpawnSelectionForRound = (roundState) => {
  const fallback = createDefaultRoundState().spawnSelection
  const source =
    roundState && typeof roundState === 'object' && roundState.spawnSelection
      ? roundState.spawnSelection
      : fallback
  const playerSides =
    source.playerSides && typeof source.playerSides === 'object'
      ? source.playerSides
      : {}
  const normalizedPlayerSides = {}
  for (const [playerId, side] of Object.entries(playerSides)) {
    if (side === 'left' || side === 'right') normalizedPlayerSides[playerId] = side
  }
  const takenSides = new Set(Object.values(normalizedPlayerSides))
  return {
    leftTaken: takenSides.has('left'),
    rightTaken: takenSides.has('right'),
    playerSides: normalizedPlayerSides,
  }
}

const getClaimedSpawnSideForPlayer = (snapshot, playerId = snapshot.selfId) => {
  const spawnSelection = resolveSpawnSelectionForRound(sharedState.round)
  const claimedSide = spawnSelection.playerSides[playerId]
  return claimedSide === 'left' || claimedSide === 'right' ? claimedSide : null
}

const getSpawnPositionForPlayer = (snapshot, playerId = snapshot.selfId) => {
  const side = getClaimedSpawnSideForPlayer(snapshot, playerId)
  const slotIndex =
    side && Object.prototype.hasOwnProperty.call(SPAWN_SIDE_TO_SLOT_INDEX, side)
      ? SPAWN_SIDE_TO_SLOT_INDEX[side]
      : -1
  if (slotIndex >= 0 && slotIndex < PLAYER_SPAWN_POINTS.length) {
    return PLAYER_SPAWN_POINTS[slotIndex]
  }
  return null
}

const resolveSpawnSelectionFromPlayers = (snapshot) => {
  const players = snapshot.players || {}
  const current = resolveSpawnSelectionForRound(sharedState.round)
  const nextSelection = {
    leftTaken: false,
    rightTaken: false,
    playerSides: {},
  }

  // Lock claims only for players who have already entered the shared scene.
  // This keeps spawn selection stable after entry while still allowing
  // pre-entry side changes during calibration.
  for (const [playerId, side] of Object.entries(current.playerSides)) {
    const player = players[playerId]
    if (!player?.readyInSharedScene) continue
    if (side !== 'left' && side !== 'right') continue
    if (side === 'left' && nextSelection.leftTaken) continue
    if (side === 'right' && nextSelection.rightTaken) continue
    nextSelection.playerSides[playerId] = side
    if (side === 'left') nextSelection.leftTaken = true
    if (side === 'right') nextSelection.rightTaken = true
  }

  for (const [playerId, player] of Object.entries(players)) {
    if (player?.readyInSharedScene) continue
    if (nextSelection.playerSides[playerId]) continue
    const intent = player?.spawnSideIntent
    if (intent !== 'left' && intent !== 'right') continue
    if (intent === 'left' && nextSelection.leftTaken) continue
    if (intent === 'right' && nextSelection.rightTaken) continue
    nextSelection.playerSides[playerId] = intent
    if (intent === 'left') nextSelection.leftTaken = true
    if (intent === 'right') nextSelection.rightTaken = true
  }

  const takenSides = new Set(Object.values(nextSelection.playerSides))
  nextSelection.leftTaken = takenSides.has('left')
  nextSelection.rightTaken = takenSides.has('right')
  return nextSelection
}

const resetSharedRoundState = (snapshot) => {
  if (!isHost(snapshot)) return
  sharedState.round = createDefaultRoundState()
  sharedState.round.phase = ROUND_PHASES.calibrating
  sharedState.round.version += 1
  sharedState.environmentAnimationStates = normalizeEnvironmentStates({})
  for (let index = 0; index < sharedState.cubes.length; index += 1) {
    sharedState.cubes[index].color = 'red'
    sharedState.cubes[index].position = [...GAME_CONFIG.switches[index].position]
    sharedState.cubes[index].rotation = [...GAME_CONFIG.switches[index].rotation]
    sharedState.cubes[index].scale = [...GAME_CONFIG.switches[index].scale]
  }
  pushSharedState()
}

const tryApplyLocalSpawnReferenceSpace = (snapshot) => {
  if (!isInAr || hasAppliedSpawnReferenceSpace || !calibrationResult) return
  const spawnPosition = getSpawnPositionForPlayer(snapshot)
  if (!Array.isArray(spawnPosition) || spawnPosition.length !== 3) return
  renderer.xr.getCamera().getWorldPosition(localHeadPosition)
  const [spawnX, spawnY, spawnZ] = spawnPosition
  const targetHeadY = spawnY + calibrationResult.headToBodyOffset
  const calibratedFloorY =
    typeof calibrationResult.floorY === 'number' ? calibrationResult.floorY : null
  const yOffsetFromFloorCalibration =
    calibratedFloorY === null ? null : calibratedFloorY - FLOOR_Y
  const referenceSpace = renderer.xr.getReferenceSpace()
  if (!referenceSpace || typeof XRRigidTransform === 'undefined') return

  const yawCorrection = Number(calibrationResult.yawToWorldNegZ) || 0
  referenceSpaceRotation.setFromAxisAngle(worldUpAxis, yawCorrection)
  rotatedHeadPosition.copy(localHeadPosition).applyQuaternion(referenceSpaceRotation)
  const yTranslation =
    yOffsetFromFloorCalibration === null
      ? targetHeadY - localHeadPosition.y
      : yOffsetFromFloorCalibration
  const offset = new XRRigidTransform(
    {
      x: spawnX - rotatedHeadPosition.x,
      y: yTranslation,
      z: spawnZ - rotatedHeadPosition.z,
    },
    {
      x: referenceSpaceRotation.x,
      y: referenceSpaceRotation.y,
      z: referenceSpaceRotation.z,
      w: referenceSpaceRotation.w,
    }
  )
  renderer.xr.setReferenceSpace(referenceSpace.getOffsetReferenceSpace(offset))
  minBodyCenterY = FLOOR_Y + calibrationResult.bodyCenterFromFloor
  hasAppliedSpawnReferenceSpace = true
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

const isZoneOccupiedByAnyPlayer = (zoneId) =>
  Boolean(sharedState.round?.zoneOccupancy?.[zoneId])

const toggleCubeState = async (cubeIndex) => {
  const stateName = GAME_CONFIG.switches[cubeIndex]?.stateName
  if (!INTERACTIVE_CUBE_STATE_NAMES.has(stateName)) return
  if (!stateName || !environmentAnimationStateController) return
  if (stateName === 'kitchen' && isZoneOccupiedByAnyPlayer('zone_1')) {
    return
  }
  const currentSnapshot = environmentAnimationStateController.getSnapshot()
  const nextValue = !Boolean(currentSnapshot[stateName])
  const didApply = await environmentAnimationStateController.setState(stateName, nextValue, {
    source: `cube-toggle:${stateName}`,
  })
  if (!didApply) return
  syncCubeColorsFromEnvironmentState(environmentAnimationStateController.getSnapshot(), {
    shouldBroadcast: true,
  })
}

const onPress = (sourceId, detail = {}) => {
  if (!isSharedSceneActive) return
  activeSources.add(sourceId)
  const hitCubeIndex = getHitCubeIndex(detail.intersections)
  if (typeof hitCubeIndex === 'number') lastHoveredCubeBySource.set(sourceId, hitCubeIndex)
}

const onMove = (sourceId, detail = {}) => {
  if (!isSharedSceneActive || !activeSources.has(sourceId)) return
  const hitCubeIndex = getHitCubeIndex(detail.intersections)
  if (typeof hitCubeIndex === 'number') lastHoveredCubeBySource.set(sourceId, hitCubeIndex)
}

const onRelease = (sourceId, detail = {}) => {
  if (!isSharedSceneActive || !activeSources.has(sourceId)) return
  activeSources.delete(sourceId)
  const currentHitCubeIndex = getHitCubeIndex(detail.intersections)
  const hitCubeIndex =
    typeof currentHitCubeIndex === 'number'
      ? currentHitCubeIndex
      : lastHoveredCubeBySource.get(sourceId)
  lastHoveredCubeBySource.delete(sourceId)
  if (typeof hitCubeIndex !== 'number') return
  void toggleCubeState(hitCubeIndex)
}

const consumeSpawnSelectionRequest = () => {
  const requestedSide = calibrationSystem.consumeSpawnSelectionRequest()
  if (!requestedSide) return
  updateLocalPlayer({ spawnSideIntent: requestedSide })
}

controllerSystem.events.addEventListener('selectstart', (event) => {
  unlockWatchAudioFromGesture()
  const wasCalibrationTrigger = calibrationSystem.onTriggerPress(
    event.detail.controllerIndex,
    event.detail.intersections
  )
  consumeSpawnSelectionRequest()
  if (wasCalibrationTrigger) return
  onPress(`controller-${event.detail.controllerIndex}`, event.detail)
})
controllerSystem.events.addEventListener('selectmove', (event) => {
  calibrationSystem.syncSpawnHoverFromIntersections(event.detail.intersections)
  onMove(`controller-${event.detail.controllerIndex}`, event.detail)
})
controllerSystem.events.addEventListener('selectend', (event) =>
  onRelease(`controller-${event.detail.controllerIndex}`, event.detail)
)
handTrackingSystem.events.addEventListener('pinchstart', (event) => {
  unlockWatchAudioFromGesture()
  const wasCalibrationSelection = calibrationSystem.onSpawnSelectionPress(event.detail.intersections)
  consumeSpawnSelectionRequest()
  if (wasCalibrationSelection) return
  onPress(`hand-${event.detail.handIndex}`, event.detail)
})
handTrackingSystem.events.addEventListener('pinchmove', (event) => {
  calibrationSystem.syncSpawnHoverFromIntersections(event.detail.intersections)
  onMove(`hand-${event.detail.handIndex}`, event.detail)
})
handTrackingSystem.events.addEventListener('pinchend', (event) =>
  onRelease(`hand-${event.detail.handIndex}`, event.detail)
)

const getRightGripPressed = () => {
  const session = renderer.xr.getSession()
  if (!session) return false
  for (const source of session.inputSources) {
    if (source.handedness !== 'right') continue
    const gamepad = source.gamepad
    if (!gamepad || !Array.isArray(gamepad.buttons)) continue
    const gripButton = gamepad.buttons[1] || gamepad.buttons[0]
    if (!gripButton) continue
    if (gripButton.pressed || Number(gripButton.value) > 0.55) return true
  }
  return false
}

const beginCalibrationFlow = (snapshot) => {
  isSharedSceneActive = false
  sharedSceneGroup.visible = false
  smartWatch.setVisible(false)
  smartWatch.resetRoundState()
  calibrationResult = null
  hasAppliedSpawnReferenceSpace = false
  localBodyHeightFromHead = 0.75
  minBodyCenterY = FLOOR_Y + 0.35
  playerNeedsSession.reset()
  interactionSystem.clearActiveNeeds()
  clearRoundOccupancy()
  localIntroCallStarted = false
  localOutcomeCallStarted = false
  localIntroFinished = false
  localOutcomeFinished = false
  localRightGripDown = false
  hasPlayedNightSound = false
  hasPlayedNextMorningSound = false
  previousNeedsCompletionPercent = 0
  outcomeFallbackStartedAt = null
  sleepEffectTargetOpacity = 0
  stopInteractionAudio()
  releaseLocalInteractionDrivenStates()
  zoneSystem.resetDebugVisuals()

  if (baseReferenceSpace) {
    renderer.xr.setReferenceSpace(baseReferenceSpace)
  }

  calibrationSystem.beginSession()
  updateLocalPlayer({
    isInAr: false,
    readyInSharedScene: false,
    isRightGripDown: false,
    spawnSideIntent: null,
    introFinished: false,
    outcomeFinished: false,
  })

  if (environmentAnimationStateController) {
    scheduleEnvironmentAnimationStateReconciliation(normalizeEnvironmentStates({}), 'reset')
  }
  if (isHost(snapshot)) {
    resetSharedRoundState(snapshot)
  }
}

const tryEnterSharedScene = (snapshot) => {
  if (!isInAr || isSharedSceneActive) return
  if (calibrationSystem.getState() !== CalibrationState.calibrated) return
  const spawnPosition = getSpawnPositionForPlayer(snapshot)
  if (!Array.isArray(spawnPosition) || spawnPosition.length !== 3) return
  calibrationResult = calibrationSystem.getResult()
  if (!calibrationResult) return
  localBodyHeightFromHead = calibrationResult.headToBodyOffset
  tryApplyLocalSpawnReferenceSpace(snapshot)
  if (!hasAppliedSpawnReferenceSpace) return
  initializeLocalBodyFromHead()
  calibrationSystem.enterSharedScene()
  isSharedSceneActive = true
  sharedSceneGroup.visible = true
  smartWatch.setVisible(true)
  smartWatch.setPlayerId(getNeedsPlayerIdForSnapshot(snapshot))
  updateLocalPlayer({
    isInAr: true,
    readyInSharedScene: true,
    introFinished: false,
    outcomeFinished: false,
    isRightGripDown: false,
    spawnSideIntent: null,
    position: [localBodyPosition.x, localBodyPosition.y, localBodyPosition.z],
    rotationY: localBodyRotationY,
  })
  if (
    isHost(snapshot) &&
    (sharedState.round.phase === ROUND_PHASES.boot ||
      sharedState.round.phase === ROUND_PHASES.calibrating)
  ) {
    setRoundPhase(ROUND_PHASES.waitingForBothPlayers, snapshot)
  }
}

const handleRoundPhaseChange = (phase, snapshot) => {
  if (phase === ROUND_PHASES.calibrating) {
    beginCalibrationFlow(snapshot)
    return
  }

  if (phase === ROUND_PHASES.waitingForBothPlayers) {
    localIntroCallStarted = false
    localOutcomeCallStarted = false
    return
  }

  if (phase === ROUND_PHASES.introCall) {
    localIntroCallStarted = false
    localIntroFinished = false
    localOutcomeCallStarted = false
    localOutcomeFinished = false
    if (SKIP_INTRO_CALL_AND_SHOW_STATS && isSharedSceneActive) {
      smartWatch.showStats(sharedState.round.needsSummary || null)
      localIntroFinished = true
      localIntroCallStarted = true
      updateLocalPlayer({ introFinished: true, outcomeFinished: false })
      return
    }
    updateLocalPlayer({ introFinished: false, outcomeFinished: false })
    return
  }

  if (phase === ROUND_PHASES.playing) {
    playerNeedsSession.start()
    interactionSystem.clearActiveNeeds()
    clearRoundOccupancy()
    hasPlayedNightSound = false
    hasPlayedNextMorningSound = false
    previousNeedsCompletionPercent = 0
    sleepEffectTargetOpacity = 0
    stopInteractionAudio()
    if (SKIP_INTRO_CALL_AND_SHOW_STATS && isSharedSceneActive) {
      smartWatch.showStats(sharedState.round.needsSummary || null)
      localIntroCallStarted = true
      localIntroFinished = true
      updateLocalPlayer({ introFinished: true })
    }
    return
  }

  if (phase === ROUND_PHASES.outcomeCall) {
    playerNeedsSession.stop()
    interactionSystem.clearActiveNeeds()
    clearRoundOccupancy()
    localOutcomeCallStarted = false
    localOutcomeFinished = false
    outcomeFallbackStartedAt = elapsedSeconds + 20
    sleepEffectTargetOpacity = 0
    stopInteractionAudio()
    releaseLocalInteractionDrivenStates()
    zoneSystem.resetDebugVisuals()
    updateLocalPlayer({ outcomeFinished: false })
    return
  }

  if (phase === ROUND_PHASES.resetting) {
    beginCalibrationFlow(snapshot)
    if (isHost(snapshot)) {
      setRoundPhase(ROUND_PHASES.calibrating, snapshot)
    }
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  isInAr = true
  baseReferenceSpace = renderer.xr.getReferenceSpace() || null
  const snapshot = getSnapshot()
  if (isHost(snapshot) && sharedState.round.phase === ROUND_PHASES.boot) {
    setRoundPhase(ROUND_PHASES.calibrating, snapshot)
  }
  beginCalibrationFlow(snapshot)
})

renderer.xr.addEventListener('sessionend', () => {
  isInAr = false
  isSharedSceneActive = false
  sharedSceneGroup.visible = false
  smartWatch.setVisible(false)
  calibrationSystem.endSession()
  interactionSystem.clearActiveNeeds()
  sleepEffectTargetOpacity = 0
  stopInteractionAudio()
  releaseLocalInteractionDrivenStates()
  zoneSystem.resetDebugVisuals()
  lastZoneUsageByPlayer.player_1 = null
  lastZoneUsageByPlayer.player_2 = null
  updateLocalPlayer({
    isInAr: false,
    readyInSharedScene: false,
    isRightGripDown: false,
    spawnSideIntent: null,
    introFinished: false,
    outcomeFinished: false,
  })
})

const timer = new THREE.Timer()
renderer.setAnimationLoop(() => {
  timer.update()
  const deltaSeconds = timer.getDelta()
  elapsedSeconds += deltaSeconds
  const elapsedMilliseconds = elapsedSeconds * 1000

  if (debugCameraEnabled && !renderer.xr.isPresenting) {
    sharedSceneGroup.visible = true
    zoneSystem.setDebugVisible(true)
    debugOrbitControls?.update()
  }

  const networkSharedState = synchronize('sharedState') || sharedState
  applySharedStateSnapshotLocally(networkSharedState)
  scheduleEnvironmentAnimationStateReconciliation(sharedState.environmentAnimationStates, 'network-frame')

  if (environmentAnimationMixer) {
    environmentAnimationMixer.update(deltaSeconds)
  }

  const snapshot = getSnapshot()
  const phase = sharedState.round.phase
  const host = isHost(snapshot)

  if (lastKnownRoundPhase !== phase) {
    handleRoundPhaseChange(phase, snapshot)
    lastKnownRoundPhase = phase
  }

  if (
    host &&
    (phase === ROUND_PHASES.calibrating || phase === ROUND_PHASES.waitingForBothPlayers)
  ) {
    const nextSpawnSelection = resolveSpawnSelectionFromPlayers(snapshot)
    const currentSpawnSelection = resolveSpawnSelectionForRound(sharedState.round)
    const changed =
      nextSpawnSelection.leftTaken !== currentSpawnSelection.leftTaken ||
      nextSpawnSelection.rightTaken !== currentSpawnSelection.rightTaken ||
      JSON.stringify(nextSpawnSelection.playerSides) !==
        JSON.stringify(currentSpawnSelection.playerSides)
    if (changed) {
      sharedState.round.spawnSelection = nextSpawnSelection
      sharedState.round.version += 1
      pushSharedState()
    }
  }

  const roundSpawnSelection = resolveSpawnSelectionForRound(sharedState.round)
  calibrationSystem.setSpawnSelectionState({
    leftTaken: roundSpawnSelection.leftTaken,
    rightTaken: roundSpawnSelection.rightTaken,
    selectedSide: getClaimedSpawnSideForPlayer(snapshot),
  })

  if (phase === ROUND_PHASES.calibrating || phase === ROUND_PHASES.waitingForBothPlayers) {
    tryEnterSharedScene(snapshot)
  }

  calibrationSystem.update()

  if (isInAr && isSharedSceneActive) {
    initializeLocalBodyFromHead()
    smartWatch.setPlayerId(getNeedsPlayerIdForSnapshot(snapshot))
    smartWatch.update(elapsedMilliseconds, renderer.xr.getFrame?.() || null)
  }

  localRightGripDown = isInAr && isSharedSceneActive ? getRightGripPressed() : false

  if (isInAr && elapsedSeconds - lastPoseUpdateAt > 1 / GAME_CONFIG.round.poseBroadcastHz) {
    updateLocalPlayer({
      isInAr: isSharedSceneActive,
      readyInSharedScene: isSharedSceneActive,
      isRightGripDown: localRightGripDown,
      introFinished: localIntroFinished,
      outcomeFinished: localOutcomeFinished,
      position: [localBodyPosition.x, localBodyPosition.y, localBodyPosition.z],
      rotationY: localBodyRotationY,
    })
    lastPoseUpdateAt = elapsedSeconds
  }

  for (let index = 0; index < floatingCubes.length; index += 1) {
    const cube = floatingCubes[index]
    if (!cube) continue
    const cubeState = sharedState.cubes[index]
    cube.applySharedState(cubeState)
    cube.update(deltaSeconds)
  }

  const remoteCapsulesVisible = Boolean(isSharedSceneActive)
  playerSystem.update(
    snapshot.players,
    snapshot.selfId,
    isInAr && isSharedSceneActive ? localBodyPosition : null,
    isInAr && isSharedSceneActive ? localBodyRotationY : null,
    deltaSeconds,
    remoteCapsulesVisible
  )

  controllerSystem.update()
  handTrackingSystem.update()
  if (calibrationSystem.getState() === CalibrationState.selectingSpawn) {
    const calibrationHoverIntersections = [
      ...controllerSystem.getLatestIntersections(0),
      ...controllerSystem.getLatestIntersections(1),
      ...handTrackingSystem.getLatestIntersections(0),
      ...handTrackingSystem.getLatestIntersections(1),
    ]
    calibrationSystem.syncSpawnHoverFromIntersections(calibrationHoverIntersections)
  }

  const players = snapshot.players || {}
  const readyPlayers = Object.values(players).filter(isPlayerReadyForIntro)
  const requiredPlayerCount = getRequiredRoundPlayerCount(players)

  if (
    host &&
    phase === ROUND_PHASES.waitingForBothPlayers &&
    readyPlayers.length >= requiredPlayerCount
  ) {
    setRoundPhase(
      SKIP_INTRO_CALL_AND_SHOW_STATS ? ROUND_PHASES.playing : ROUND_PHASES.introCall,
      snapshot
    )
  }

  // Fallback: if host phase transition is delayed but both players are loaded,
  // still start the intro call locally so gameplay is not blocked.
  if (
    phase === ROUND_PHASES.waitingForBothPlayers &&
    readyPlayers.length >= requiredPlayerCount &&
    isSharedSceneActive &&
    !localIntroCallStarted &&
    !SKIP_INTRO_CALL_AND_SHOW_STATS
  ) {
    localIntroCallStarted = true
    void smartWatch.startIntro()
  }

  if (phase === ROUND_PHASES.introCall) {
    if (isSharedSceneActive && !localIntroCallStarted) {
      localIntroCallStarted = true
      void smartWatch.startIntro()
    }
    if (host) {
      const introDoneCount = Object.values(players).filter((player) => player?.introFinished).length
      if (introDoneCount >= requiredPlayerCount) {
        setRoundPhase(ROUND_PHASES.playing, snapshot)
      }
    }
  }

  if (phase === ROUND_PHASES.playing) {
    const zoneState = zoneSystem.update(players, snapshot.selfId, localBodyPosition)
    const localNeedsPlayerId = getNeedsPlayerIdForSnapshot(snapshot)
    const remotePlayer = Object.values(players).find(
      (player) => getNeedsPlayerIdFromSlot(player?.slotIndex) !== localNeedsPlayerId
    )
    const playerGripState = {
      player_1:
        localNeedsPlayerId === 'player_1'
          ? localRightGripDown
          : Boolean(remotePlayer?.slotIndex === 0 && remotePlayer?.isRightGripDown),
      player_2:
        localNeedsPlayerId === 'player_2'
          ? localRightGripDown
          : Boolean(remotePlayer?.slotIndex === 1 && remotePlayer?.isRightGripDown),
    }
    const resolved = interactionSystem.update({
      playerZones: zoneState.playerZones,
      playerGripState,
      environmentStates: sharedState.environmentAnimationStates,
      sharedOccupancy: sharedState.round.zoneOccupancy,
      hostCanWriteOccupancy: host,
    })
    for (const needsPlayerId of ['player_1', 'player_2']) {
      const candidate = resolved.candidates?.[needsPlayerId]
      const inUse =
        candidate && resolved.occupancy?.[candidate.zoneId] === needsPlayerId
          ? { zoneId: candidate.zoneId, needId: candidate.needId }
          : null
      const previous = lastZoneUsageByPlayer[needsPlayerId]
      const changed =
        previous?.zoneId !== inUse?.zoneId || previous?.needId !== inUse?.needId
      if (!changed) continue
      if (inUse) {
        console.log(
          `[interaction] ${needsPlayerId} using ${inUse.zoneId} -> ${inUse.needId}`
        )
      } else if (previous) {
        console.log(
          `[interaction] ${needsPlayerId} stopped using ${previous.zoneId} -> ${previous.needId}`
        )
      }
      lastZoneUsageByPlayer[needsPlayerId] = inUse
    }
    zoneSystem.updateDebugVisuals({
      localNeedsPlayerId,
      occupancy: resolved.occupancy,
      candidates: resolved.candidates,
    })

    const localCandidate = localNeedsPlayerId ? resolved.candidates?.[localNeedsPlayerId] : null
    const localCanUseZone =
      Boolean(localCandidate?.zoneId) &&
      resolved.occupancy?.[localCandidate.zoneId] === localNeedsPlayerId
    const localActiveNeed = localCanUseZone ? localCandidate.needId : null
    const localActiveZoneId = localCanUseZone ? localCandidate.zoneId : null

    syncLocalInteractionDrivenState(
      'toilet',
      localActiveNeed === 'poop' && localActiveZoneId === 'zone_1'
    )
    syncLocalInteractionDrivenState(
      'shower',
      localActiveNeed === 'shower' && localActiveZoneId === 'zone_3'
    )
    sleepEffectTargetOpacity =
      localActiveNeed === 'sleep' && localActiveZoneId === 'zone_2' ? 0.78 : 0
    stopInteractionAudioForInactiveState(mapNeedToInteractionType(localActiveNeed))

    if (host) {
      const nextOccupancy = resolved.occupancy
      const changed = ZONE_IDS.some(
        (zoneId) => nextOccupancy[zoneId] !== lastBroadcastZoneOccupancy[zoneId]
      )
      if (changed) {
        sharedState.round.zoneOccupancy = clone(nextOccupancy)
        sharedState.round.version += 1
        lastBroadcastZoneOccupancy = clone(nextOccupancy)
        pushSharedState()
      }
    }

    playerNeedsSession.update(deltaSeconds)
    const sessionState = playerNeedsSession.getState()
    const completionPercent = getSessionCompletionPercent(sessionState.elapsed, sessionState.duration)
    if (
      !hasPlayedNightSound &&
      previousNeedsCompletionPercent < NIGHT_COMPLETION_PERCENT &&
      completionPercent >= NIGHT_COMPLETION_PERCENT
    ) {
      hasPlayedNightSound = true
      void playMilestoneSound(nightAudio)
      getWatchClockFromElapsed(sessionState.elapsed, sessionState.duration, NEEDS_CONFIG)
    }
    if (
      !hasPlayedNextMorningSound &&
      previousNeedsCompletionPercent < NEXT_MORNING_COMPLETION_PERCENT &&
      completionPercent >= NEXT_MORNING_COMPLETION_PERCENT
    ) {
      hasPlayedNextMorningSound = true
      void playMilestoneSound(nextMorningAudio)
      getWatchClockFromElapsed(sessionState.elapsed, sessionState.duration, NEEDS_CONFIG)
    }
    previousNeedsCompletionPercent = completionPercent

    if (host && sessionState.elapsed >= sessionState.duration) {
      const summaries = playerNeedsSession.end()
      const endData = computeSummaryPayload(summaries)
      sharedState.round.needsSummary = endData
      setRoundPhase(ROUND_PHASES.outcomeCall, snapshot, { needsSummary: endData })
    }
  } else {
    interactionSystem.clearActiveNeeds()
    sleepEffectTargetOpacity = 0
    stopInteractionAudio()
    releaseLocalInteractionDrivenStates()
    zoneSystem.resetDebugVisuals()
    lastZoneUsageByPlayer.player_1 = null
    lastZoneUsageByPlayer.player_2 = null
  }

  if (phase === ROUND_PHASES.outcomeCall) {
    const summary = sharedState.round.needsSummary
    if (summary) {
      smartWatch.showStats(summary)
    }
    if (isSharedSceneActive && !localOutcomeCallStarted) {
      localOutcomeCallStarted = true
      void smartWatch.startOutcomeCall(summary?.summaries || [])
    }
    if (host) {
      const doneCount = Object.values(players).filter((player) => player?.outcomeFinished).length
      const timedOut = outcomeFallbackStartedAt !== null && elapsedSeconds >= outcomeFallbackStartedAt
      if (doneCount >= requiredPlayerCount || timedOut) {
        setRoundPhase(ROUND_PHASES.resetting, snapshot)
      }
    }
  }

  const sleepOpacityLerp = 1 - Math.exp(-7.5 * deltaSeconds)
  sleepEffectMesh.material.opacity +=
    (sleepEffectTargetOpacity - sleepEffectMesh.material.opacity) * sleepOpacityLerp
  sleepEffectMesh.visible = sleepEffectMesh.material.opacity > 0.02
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})