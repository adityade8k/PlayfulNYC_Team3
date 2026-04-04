import * as THREE from 'three'
import { attachSmartWatchGlobals, createSmartWatchStore } from './state.js'
import {
  createLandlordCallController,
  createWatchScreenCanvas,
  describeWatchStatus,
} from './watch-ui.js'

export const createSmartWatchXRSystem = ({
  scene,
  camera,
  renderer,
  endpoint = '/api/landlord-call',
  autoStart = false,
  secureContextMessage = true,
  onStatus = () => {},
} = {}) => {
  if (!scene || !camera || !renderer) {
    throw new Error('createSmartWatchXRSystem requires scene, camera, and renderer.')
  }

  const store = createSmartWatchStore()
  attachSmartWatchGlobals(store)

  const watchScreen = createWatchScreenCanvas()
  const screenTexture = new THREE.CanvasTexture(watchScreen.canvas)
  screenTexture.colorSpace = THREE.SRGBColorSpace

  const materials = {
    strap: new THREE.MeshStandardMaterial({
      color: 0x2a2f35,
      roughness: 0.9,
      metalness: 0.05,
    }),
    case: new THREE.MeshStandardMaterial({
      color: 0x43474f,
      roughness: 0.38,
      metalness: 0.85,
    }),
    skin: new THREE.MeshStandardMaterial({
      color: 0xaf7d56,
      roughness: 0.95,
      metalness: 0,
    }),
  }

  const watchModel = new THREE.Group()
  const strapTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.64, 0.05),
    materials.strap
  )
  strapTop.position.set(0.22, 0, -0.01)
  watchModel.add(strapTop)

  const strapBottom = strapTop.clone()
  strapBottom.position.set(-0.22, 0, -0.01)
  watchModel.add(strapBottom)

  const wristBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.68, 32, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x181b1f,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.DoubleSide,
    })
  )
  wristBand.rotation.z = Math.PI / 2
  wristBand.position.set(0, 0, -0.3)
  watchModel.add(wristBand)

  const watchBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.92, 0.12),
    materials.case
  )
  watchModel.add(watchBody)

  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.09, 24),
    materials.case
  )
  crown.rotation.z = Math.PI / 2
  crown.position.set(0.42, 0.06, 0)
  watchModel.add(crown)

  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.8),
    new THREE.MeshStandardMaterial({
      map: screenTexture,
      emissive: 0xffffff,
      emissiveMap: screenTexture,
      emissiveIntensity: 0.48,
      roughness: 0.1,
      metalness: 0.05,
    })
  )
  screenMesh.position.z = 0.065
  watchModel.add(screenMesh)

  const innerShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.82),
    new THREE.MeshBasicMaterial({
      color: 0x091b23,
      transparent: true,
      opacity: 0.18,
    })
  )
  innerShadow.position.z = 0.062
  watchModel.add(innerShadow)

  const watchAnchor = new THREE.Group()
  watchAnchor.add(watchModel)
  scene.add(watchAnchor)

  const previewForearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 1.3, 8, 16),
    materials.skin
  )
  previewForearm.rotation.z = Math.PI / 2
  watchAnchor.add(previewForearm)

  const desktopPreviewAnchor = new THREE.Group()
  desktopPreviewAnchor.position.set(-0.12, -0.03, -0.38)
  desktopPreviewAnchor.rotation.set(0.06, -0.04, -0.46)
  camera.add(desktopPreviewAnchor)
  scene.add(camera)

  const tempPosition = new THREE.Vector3()
  const tempQuaternion = new THREE.Quaternion()
  let elapsedMs = 0
  let lastState = store.getState()
  let lastTracking = 'desktop-preview'

  const landlordCall = createLandlordCallController(store, {
    endpoint,
    autoAdvanceOnError: true,
    onStatus,
  })
  landlordCall.primeAudio()

  const isLocalhost =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  const secureContextReady = window.isSecureContext || isLocalhost

  store.subscribe((state) => {
    lastState = state
    watchScreen.render(state, elapsedMs)
    screenTexture.needsUpdate = true
    onStatus(describeWatchStatus(state))
  })

  const applyWatchMode = (mode) => {
    if (mode === 'xr-hand' || mode === 'xr-controller') {
      watchModel.scale.setScalar(0.095)
      watchModel.position.set(0.016, 0.03, -0.004)
      watchModel.rotation.set(Math.PI / 2, Math.PI, -1.18)
      previewForearm.visible = false
      return
    }

    watchModel.scale.setScalar(0.22)
    watchModel.position.set(0, 0, 0)
    watchModel.rotation.set(0.25, 0.12, -0.28)
    previewForearm.visible = true
    previewForearm.scale.setScalar(0.3)
    previewForearm.position.set(-0.18, -0.03, -0.03)
  }

  const updateAnchor = (frame) => {
    const session = renderer.xr.getSession()
    const refSpace = renderer.xr.getReferenceSpace()

    if (session && frame && refSpace) {
      for (const inputSource of session.inputSources) {
        if (inputSource.handedness !== 'left') continue

        if (inputSource.hand) {
          const wrist = inputSource.hand.get('wrist')
          if (wrist) {
            const pose = frame.getJointPose(wrist, refSpace)
            if (pose) {
              watchAnchor.position.set(
                pose.transform.position.x,
                pose.transform.position.y,
                pose.transform.position.z
              )
              watchAnchor.quaternion.set(
                pose.transform.orientation.x,
                pose.transform.orientation.y,
                pose.transform.orientation.z,
                pose.transform.orientation.w
              )
              applyWatchMode('xr-hand')
              lastTracking = 'left-hand-wrist'
              return lastTracking
            }
          }
        }

        if (inputSource.gripSpace) {
          const pose = frame.getPose(inputSource.gripSpace, refSpace)
          if (pose) {
            watchAnchor.position.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z
            )
            watchAnchor.quaternion.set(
              pose.transform.orientation.x,
              pose.transform.orientation.y,
              pose.transform.orientation.z,
              pose.transform.orientation.w
            )
            applyWatchMode('xr-controller')
            lastTracking = 'left-controller'
            return lastTracking
          }
        }
      }
    }

    desktopPreviewAnchor.updateWorldMatrix(true, false)
    desktopPreviewAnchor.getWorldPosition(tempPosition)
    desktopPreviewAnchor.getWorldQuaternion(tempQuaternion)
    watchAnchor.position.copy(tempPosition)
    watchAnchor.quaternion.copy(tempQuaternion)
    applyWatchMode(renderer.xr.isPresenting ? 'xr-preview' : 'desktop-preview')
    lastTracking = renderer.xr.isPresenting ? 'xr-preview-fallback' : 'desktop-preview'
    return lastTracking
  }

  const renderGameToText = () =>
    JSON.stringify({
      coordinateSystem:
        'Watch follows the left wrist in XR space when available, otherwise a desktop preview anchor beside the camera.',
      watchTracking: lastTracking,
      watchState: store.getState(),
      secureContextReady,
    })

  if (secureContextMessage && !secureContextReady) {
    onStatus(
      `This page is running on ${location.protocol}//${location.host}. WebXR usually requires HTTPS or localhost for immersive mode.`
    )
  }

  if (autoStart) void landlordCall.startCall()

  return {
    store,
    startIntro() {
      return landlordCall.startCall()
    },
    maybeAutoStart() {
      void landlordCall.startCall()
    },
    update(time, frame) {
      elapsedMs = time
      watchScreen.render(lastState, elapsedMs)
      screenTexture.needsUpdate = true
      screenMesh.material.emissiveIntensity =
        lastState.screen === 'incoming-call' ? 0.62 : 0.48
      return updateAnchor(frame)
    },
    renderGameToText,
    dispose() {
      landlordCall.dispose()
      scene.remove(watchAnchor)
      camera.remove(desktopPreviewAnchor)
    },
  }
}
