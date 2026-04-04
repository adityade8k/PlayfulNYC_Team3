import * as THREE from 'three'

export const CalibrationState = Object.freeze({
  idle: 'idle',
  calibratingFloor: 'calibratingFloor',
  calibratingHead: 'calibratingHead',
  calibrated: 'calibrated',
  inSharedScene: 'inSharedScene',
})

const tempControllerPosition = new THREE.Vector3()
const tempHeadPosition = new THREE.Vector3()
const tempHeadQuaternion = new THREE.Quaternion()
const tempHeadForward = new THREE.Vector3()
const tempFlattenedForward = new THREE.Vector3()
const WORLD_FORWARD_NEG_Z = new THREE.Vector3(0, 0, -1)
const FLOOR_STEP_GRID_COLOR = 0x8ce8ff
const HEAD_STEP_GRID_COLOR = 0xff0000

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

export function createCalibrationSystem({ renderer, scene, controllers = [] }) {
  let state = CalibrationState.idle
  let result = null

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

  const updateInstructionText = () => {
    if (state === CalibrationState.calibratingFloor) {
      instructionOverlay.textContent =
        'Step 1/2: place RIGHT controller on real floor, then press trigger.'
      return
    }
    if (state === CalibrationState.calibratingHead) {
      instructionOverlay.textContent =
        'Step 2/2: stand upright naturally, then press trigger.'
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
    setGridColor(FLOOR_STEP_GRID_COLOR)
    updateInstructionText()
    setVisualsVisible(true)
  }

  const endSession = () => {
    state = CalibrationState.idle
    result = null
    updateInstructionText()
    setVisualsVisible(false)
  }

  const onTriggerPress = (controllerIndex) => {
    if (
      state !== CalibrationState.calibratingFloor &&
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
      state = CalibrationState.calibratingHead
      setGridColor(HEAD_STEP_GRID_COLOR)
      updateInstructionText()
      return true
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
    }
    state = CalibrationState.calibrated
    updateInstructionText()
    return true
  }

  const enterSharedScene = () => {
    if (state !== CalibrationState.calibrated) return
    state = CalibrationState.inSharedScene
    setVisualsVisible(false)
    updateInstructionText()
  }

  const update = () => {
    if (
      state !== CalibrationState.calibratingFloor &&
      state !== CalibrationState.calibratingHead
    ) {
      floorGrid.visible = false
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
      return
    }

    if (state === CalibrationState.calibratingHead && Array.isArray(result?.floorPoint)) {
      const [x, y, z] = result.floorPoint
      floorGrid.position.set(x, y + 0.01, z)
      floorGrid.visible = true
    }
  }

  return {
    beginSession,
    endSession,
    onTriggerPress,
    enterSharedScene,
    update,
    getState: () => state,
    getResult: () => (result ? { ...result } : null),
    destroy: () => {
      scene.remove(floorGrid)
      instructionOverlay.remove()
    },
  }
}
