import * as THREE from 'three'
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js'

const tempMatrix = new THREE.Matrix4()

const createRay = (color = 0x99ff66) => {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ])
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  const ray = new THREE.Line(geometry, material)
  ray.name = 'ray'
  ray.scale.z = 3.5
  return ray
}

const intersectFromInput = (raycaster, inputSourceRoot, objects) => {
  tempMatrix.identity().extractRotation(inputSourceRoot.matrixWorld)
  raycaster.ray.origin.setFromMatrixPosition(inputSourceRoot.matrixWorld)
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)
  return raycaster.intersectObjects(objects, true)
}

const getRayFromInput = (inputSourceRoot) => {
  tempMatrix.identity().extractRotation(inputSourceRoot.matrixWorld)
  const origin = new THREE.Vector3().setFromMatrixPosition(inputSourceRoot.matrixWorld)
  const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).normalize()
  return { origin, direction }
}

const getPinchDistance = (hand) => {
  const thumbTip = hand.joints?.['thumb-tip']
  const indexTip = hand.joints?.['index-finger-tip']

  if (!thumbTip || !indexTip || !thumbTip.visible || !indexTip.visible) {
    return Number.POSITIVE_INFINITY
  }

  return thumbTip.position.distanceTo(indexTip.position)
}

export function createHandTrackingSystem(renderer, scene, interactiveObjects = []) {
  const events = new EventTarget()
  const raycaster = new THREE.Raycaster()
  const handFactory = new XRHandModelFactory()
  const hands = []
  const pinchState = [false, false]

  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index)
    hand.add(handFactory.createHandModel(hand, 'mesh'))
    hand.add(createRay(0x99ff66))
    hand.userData.handIndex = index
    scene.add(hand)
    hands.push(hand)
  }

  return {
    hands,
    events,
    update() {
      for (const hand of hands) {
        const handIndex = hand.userData.handIndex
        const intersections = intersectFromInput(raycaster, hand, interactiveObjects)
        const ray = hand.getObjectByName('ray')
        if (ray) {
          ray.material.color.set(intersections.length > 0 ? 0xffcc33 : 0x99ff66)
        }

        const pinchDistance = getPinchDistance(hand)
        const isPinching = pinchDistance < 0.02
        const wasPinching = pinchState[handIndex]

        if (isPinching && !wasPinching) {
          const { origin, direction } = getRayFromInput(hand)
          events.dispatchEvent(
            new CustomEvent('click', {
              detail: { handIndex, intersections, origin, direction },
            })
          )
          events.dispatchEvent(
            new CustomEvent('pinchstart', {
              detail: { handIndex, intersections, origin, direction },
            })
          )
        } else if (isPinching && wasPinching) {
          const { origin, direction } = getRayFromInput(hand)
          events.dispatchEvent(
            new CustomEvent('pinchmove', {
              detail: { handIndex, intersections, origin, direction },
            })
          )
        } else if (!isPinching && wasPinching) {
          const { origin, direction } = getRayFromInput(hand)
          events.dispatchEvent(
            new CustomEvent('pinchend', {
              detail: { handIndex, intersections, origin, direction },
            })
          )
        }

        pinchState[handIndex] = isPinching
      }
    },
  }
}
