import * as THREE from 'three'

export const CalibrationState = Object.freeze({
  idle: 'idle',
  calibratingFloor: 'calibratingFloor',
  selectingSpawn: 'selectingSpawn',
  calibratingHead: 'calibratingHead',
  calibrated: 'calibrated',
  inSharedScene: 'inSharedScene',
})

const tempControllerPosition = new THREE.Vector3()
const tempHeadPosition = new THREE.Vector3()
const tempHeadQuaternion = new THREE.Quaternion()
const tempHeadForward = new THREE.Vector3()
const tempFlattenedForward = new THREE.Vector3()
const tempCameraPosition = new THREE.Vector3()
const tempCameraQuaternion = new THREE.Quaternion()
const tempForwardVector = new THREE.Vector3()
const WORLD_FORWARD_NEG_Z = new THREE.Vector3(0, 0, -1)
const FLOOR_STEP_GRID_COLOR = 0x8ce8ff
const HEAD_STEP_GRID_COLOR = 0xff0000
const SPAWN_TILE_COLORS = Object.freeze({
  available: '#284160',
  hovered: '#5ca5ff',
  selected: '#44d17c',
  unavailable: '#5c5c5c',
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const computeYawToWorldNegZ = (headQuaternion) => {
  tempHeadForward.set(0, 0, -1).applyQuaternion(headQuaternion)
  tempFlattenedForward.set(tempHeadForward.x, 0, tempHeadForward.z)
  if (tempFlattenedForward.lengthSq() <= 1e-8) return 0
  tempFlattenedForward.normalize()

  const dot = clamp(tempFlattenedForward.dot(WORLD_FORWARD_NEG_Z), -1, 1)
  const crossY =
    tempFlattenedForward.x * WORLD_FORWARD_NEG_Z.z -
    tempFlattenedForward.z * WORLD_FORWARD_NEG_Z.x
  return Math.atan2(crossY, dot)
}

const createInstructionOverlay = () => {
  const element = document.createElement('div')
  element.className = 'calibration-overlay'
  element.style.display = 'none'
  document.body.appendChild(element)
  return element
}

const createSpawnLabelSprite = (text) => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(8, 12, 20, 0.85)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = '700 92px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#ffffff'
    context.fillText(text, canvas.width / 2, canvas.height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  )
  sprite.scale.set(0.38, 0.19, 1)
  // Spawn labels are visual-only; keep controller/hand raycasts on tile meshes.
  sprite.raycast = () => {}
  return sprite
}

export function createCalibrationSystem({ renderer, scene, controllers = [] }) {
  let state = CalibrationState.idle
  let result = null
  let pendingSpawnSideRequest = null
  let hoveredSpawnSide = null
  const spawnSelectionState = {
    leftTaken: false,
    rightTaken: false,
    selectedSide: null,
  }

  const floorGrid = new THREE.GridHelper(1.8, 18, 0x8ce8ff, 0x1e7f95)
  floorGrid.position.set(0, 0.01, 0)
  floorGrid.visible = false
  floorGrid.material.transparent = true
  floorGrid.material.opacity = 0.95
  scene.add(floorGrid)

  const setGridColor = (hexColor) => {
    if (Array.isArray(floorGrid.material)) {
      for (const material of floorGrid.material) {
        material.color.setHex(hexColor)
      }
      return
    }
    floorGrid.material.color.setHex(hexColor)
  }

  const instructionOverlay = createInstructionOverlay()
  const spawnSelectionRoot = new THREE.Group()
  spawnSelectionRoot.visible = false
  spawnSelectionRoot.name = 'spawn-selection-root'
  scene.add(spawnSelectionRoot)

  const createSpawnTile = (side, label, xOffset) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.26),
      new THREE.MeshBasicMaterial({
        color: SPAWN_TILE_COLORS.available,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
      })
    )
    mesh.userData.spawnSide = side
    mesh.position.set(xOffset, 0, 0)
    const labelSprite = createSpawnLabelSprite(label)
    labelSprite.position.set(0, 0, 0.01)
    mesh.add(labelSprite)
    spawnSelectionRoot.add(mesh)
    return mesh
  }

  const spawnTileMeshes = {
    left: createSpawnTile('left', 'RIGHT', -0.34),
    right: createSpawnTile('right', 'LEFT', 0.34),
  }

  const getSpawnSideFromObject = (object) => {
    let current = object
    while (current) {
      const side = current.userData?.spawnSide
      if (side === 'left' || side === 'right') return side
      current = current.parent
    }
    return null
  }

  const getSpawnSideFromIntersections = (intersections = []) => {
    for (const hit of intersections) {
      const side = getSpawnSideFromObject(hit.object)
      if (side) return side
    }
    return null
  }

  const isSpawnSideAvailable = (side) => {
    if (side === 'left') return !spawnSelectionState.leftTaken
    if (side === 'right') return !spawnSelectionState.rightTaken
    return false
  }

  const updateSpawnTileVisuals = () => {
    const leftMaterial = spawnTileMeshes.left.material
    const rightMaterial = spawnTileMeshes.right.material
    const leftSelected = spawnSelectionState.selectedSide === 'left'
    const rightSelected = spawnSelectionState.selectedSide === 'right'
    const leftHovered = hoveredSpawnSide === 'left' && !leftSelected
    const rightHovered = hoveredSpawnSide === 'right' && !rightSelected
    const leftAvailable = isSpawnSideAvailable('left') || leftSelected
    const rightAvailable = isSpawnSideAvailable('right') || rightSelected

    leftMaterial.color.set(leftSelected
      ? SPAWN_TILE_COLORS.selected
      : leftAvailable
        ? leftHovered
          ? SPAWN_TILE_COLORS.hovered
          : SPAWN_TILE_COLORS.available
        : SPAWN_TILE_COLORS.unavailable)
    leftMaterial.opacity = leftAvailable ? 0.95 : 0.55

    rightMaterial.color.set(rightSelected
      ? SPAWN_TILE_COLORS.selected
      : rightAvailable
        ? rightHovered
          ? SPAWN_TILE_COLORS.hovered
          : SPAWN_TILE_COLORS.available
        : SPAWN_TILE_COLORS.unavailable)
    rightMaterial.opacity = rightAvailable ? 0.95 : 0.55
  }

  const updateSpawnSelectionPose = () => {
    const xrCamera = renderer.xr.getCamera()
    xrCamera.getWorldPosition(tempCameraPosition)
    xrCamera.getWorldQuaternion(tempCameraQuaternion)
    tempForwardVector.set(0, 0, -1).applyQuaternion(tempCameraQuaternion).normalize()
    spawnSelectionRoot.position
      .copy(tempCameraPosition)
      .addScaledVector(tempForwardVector, 1.1)
    spawnSelectionRoot.position.y -= 0.12
    spawnSelectionRoot.quaternion.copy(tempCameraQuaternion)
  }

  const updateInstructionText = () => {
    if (state === CalibrationState.calibratingFloor) {
      instructionOverlay.textContent =
        'Step 1/3: place RIGHT controller on real floor, then press trigger.'
      return
    }
    if (state === CalibrationState.selectingSpawn) {
      if (spawnSelectionState.leftTaken && spawnSelectionState.rightTaken) {
        instructionOverlay.textContent = 'Step 2/3: both spawn sides are currently taken.'
        return
      }
      instructionOverlay.textContent = 'Step 2/3: point at LEFT or RIGHT tile, then press trigger.'
      return
    }
    if (state === CalibrationState.calibratingHead) {
      instructionOverlay.textContent =
        'Step 3/3: stand upright naturally, then press trigger.'
      return
    }
    if (state === CalibrationState.calibrated) {
      instructionOverlay.textContent = 'Calibration complete. Entering shared scene...'
      return
    }
    instructionOverlay.textContent = ''
  }

  const setVisualsVisible = (isVisible) => {
    floorGrid.visible = isVisible
    instructionOverlay.style.display = isVisible ? 'block' : 'none'
  }

  const getRightController = () => {
    const explicitRight = controllers.find((controller) => controller.userData?.handedness === 'right')
    if (explicitRight) return explicitRight

    const connected = controllers.find((controller) => controller.userData?.connected)
    if (connected) return connected

    return controllers[0] || null
  }

  const isRightControllerIndex = (controllerIndex) => {
    const controller = controllers[controllerIndex]
    if (!controller) return false
    if (controller.userData?.handedness === 'right') return true
    const rightController = getRightController()
    return rightController === controller
  }

  const beginSession = () => {
    state = CalibrationState.calibratingFloor
    result = null
    pendingSpawnSideRequest = null
    hoveredSpawnSide = null
    spawnSelectionState.leftTaken = false
    spawnSelectionState.rightTaken = false
    spawnSelectionState.selectedSide = null
    setGridColor(FLOOR_STEP_GRID_COLOR)
    updateSpawnTileVisuals()
    updateInstructionText()
    setVisualsVisible(true)
    spawnSelectionRoot.visible = false
  }

  const endSession = () => {
    state = CalibrationState.idle
    result = null
    pendingSpawnSideRequest = null
    hoveredSpawnSide = null
    spawnSelectionRoot.visible = false
    updateInstructionText()
    setVisualsVisible(false)
  }

  const syncSpawnHoverFromIntersections = (intersections = []) => {
    const hovered = getSpawnSideFromIntersections(intersections)
    hoveredSpawnSide = hovered && isSpawnSideAvailable(hovered) ? hovered : null
    if (state === CalibrationState.selectingSpawn) {
      updateSpawnTileVisuals()
    }
  }

  const onSpawnSelectionPress = (intersections = []) => {
    if (state !== CalibrationState.selectingSpawn) return false
    const selectedSide = getSpawnSideFromIntersections(intersections)
    if (!selectedSide) return false
    if (!isSpawnSideAvailable(selectedSide)) {
      updateInstructionText()
      return true
    }
    // Local selection succeeded: immediately advance this client to head calibration.
    // Network sync can still confirm ownership while this user proceeds.
    spawnSelectionState.selectedSide = selectedSide
    pendingSpawnSideRequest = selectedSide
    state = CalibrationState.calibratingHead
    setGridColor(HEAD_STEP_GRID_COLOR)
    hoveredSpawnSide = null
    spawnSelectionRoot.visible = false
    updateSpawnTileVisuals()
    updateInstructionText()
    return true
  }

  const onTriggerPress = (controllerIndex, intersections = []) => {
    if (
      state !== CalibrationState.calibratingFloor &&
      state !== CalibrationState.selectingSpawn &&
      state !== CalibrationState.calibratingHead
    ) {
      return false
    }
    if (!isRightControllerIndex(controllerIndex)) return false

    const rightController = getRightController()
    if (!rightController) return false

    if (state === CalibrationState.calibratingFloor) {
      rightController.getWorldPosition(tempControllerPosition)
      result = {
        floorY: tempControllerPosition.y,
        floorPoint: [
          tempControllerPosition.x,
          tempControllerPosition.y,
          tempControllerPosition.z,
        ],
      }
      state = CalibrationState.selectingSpawn
      updateInstructionText()
      return true
    }

    if (state === CalibrationState.selectingSpawn) {
      return onSpawnSelectionPress(intersections)
    }

    renderer.xr.getCamera().getWorldPosition(tempHeadPosition)
    renderer.xr.getCamera().getWorldQuaternion(tempHeadQuaternion)
    const floorY = result?.floorY ?? 0
    const rawHeadHeight = tempHeadPosition.y - floorY
    const headHeight = clamp(rawHeadHeight, 0.9, 2.2)
    const bodyCenterFromFloor = clamp(headHeight * 0.5, 0.45, 1.1)
    const headToBodyOffset = headHeight - bodyCenterFromFloor
    const yawToWorldNegZ = computeYawToWorldNegZ(tempHeadQuaternion)

    result = {
      floorY,
      floorPoint: result?.floorPoint ? [...result.floorPoint] : null,
      headHeight,
      bodyCenterFromFloor,
      headToBodyOffset,
      yawToWorldNegZ,
      selectedSpawnSide: spawnSelectionState.selectedSide || null,
    }
    state = CalibrationState.calibrated
    updateInstructionText()
    return true
  }

  const enterSharedScene = () => {
    if (state !== CalibrationState.calibrated) return
    state = CalibrationState.inSharedScene
    spawnSelectionRoot.visible = false
    setVisualsVisible(false)
    updateInstructionText()
  }

  const setSpawnSelectionState = ({
    leftTaken = false,
    rightTaken = false,
    selectedSide = null,
  } = {}) => {
    spawnSelectionState.leftTaken = Boolean(leftTaken)
    spawnSelectionState.rightTaken = Boolean(rightTaken)
    spawnSelectionState.selectedSide =
      selectedSide === 'left' || selectedSide === 'right' ? selectedSide : null
    if (
      state === CalibrationState.selectingSpawn &&
      (spawnSelectionState.selectedSide === 'left' || spawnSelectionState.selectedSide === 'right')
    ) {
      state = CalibrationState.calibratingHead
      setGridColor(HEAD_STEP_GRID_COLOR)
      spawnSelectionRoot.visible = false
    }
    updateSpawnTileVisuals()
    updateInstructionText()
  }

  const consumeSpawnSelectionRequest = () => {
    const side = pendingSpawnSideRequest
    pendingSpawnSideRequest = null
    return side
  }

  const update = () => {
    if (
      state !== CalibrationState.calibratingFloor &&
      state !== CalibrationState.selectingSpawn &&
      state !== CalibrationState.calibratingHead
    ) {
      floorGrid.visible = false
      spawnSelectionRoot.visible = false
      return
    }

    if (state === CalibrationState.calibratingFloor) {
      const rightController = getRightController()
      if (!rightController) {
        floorGrid.visible = false
        return
      }

      rightController.getWorldPosition(tempControllerPosition)
      floorGrid.position.copy(tempControllerPosition)
      floorGrid.position.y += 0.01
      floorGrid.visible = true
      spawnSelectionRoot.visible = false
      return
    }

    if (state === CalibrationState.selectingSpawn) {
      floorGrid.visible = false
      spawnSelectionRoot.visible = true
      updateSpawnSelectionPose()
      updateSpawnTileVisuals()
      return
    }

    if (state === CalibrationState.calibratingHead && Array.isArray(result?.floorPoint)) {
      const [x, y, z] = result.floorPoint
      floorGrid.position.set(x, y + 0.01, z)
      floorGrid.visible = true
      spawnSelectionRoot.visible = false
    }
  }

  return {
    beginSession,
    endSession,
    onTriggerPress,
    onSpawnSelectionPress,
    syncSpawnHoverFromIntersections,
    setSpawnSelectionState,
    consumeSpawnSelectionRequest,
    getSpawnSelectionInteractiveObjects: () => [spawnTileMeshes.left, spawnTileMeshes.right],
    enterSharedScene,
    update,
    getState: () => state,
    getResult: () => (result ? { ...result } : null),
    destroy: () => {
      scene.remove(floorGrid)
      scene.remove(spawnSelectionRoot)
      instructionOverlay.remove()
    },
  }
}
