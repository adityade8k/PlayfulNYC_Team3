import * as THREE from 'three'

const tempMatrix = new THREE.Matrix4()

const createRay = (color = 0xffffff) => {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ])
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
  const ray = new THREE.Line(geometry, material)
  ray.name = 'ray'
  ray.scale.z = 5
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

export function createControllerSystem(renderer, scene, interactiveObjects = []) {
  const events = new EventTarget()
  const raycaster = new THREE.Raycaster()
  const controllers = []
  const controllerGrips = []
  const selecting = [false, false]

  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index)
    controller.add(createRay(0x66ccff))
    controller.userData.controllerIndex = index
    scene.add(controller)
    controllers.push(controller)

    controller.addEventListener('select', () => {
      const intersections = intersectFromInput(raycaster, controller, interactiveObjects)
      const { origin, direction } = getRayFromInput(controller)
      events.dispatchEvent(
        new CustomEvent('select', {
          detail: { controllerIndex: index, intersections, origin, direction },
        })
      )
    })
    controller.addEventListener('selectstart', () => {
      selecting[index] = true
      const intersections = intersectFromInput(raycaster, controller, interactiveObjects)
      const { origin, direction } = getRayFromInput(controller)
      events.dispatchEvent(
        new CustomEvent('selectstart', {
          detail: { controllerIndex: index, intersections, origin, direction },
        })
      )
    })
    controller.addEventListener('selectend', () => {
      selecting[index] = false
      const intersections = intersectFromInput(raycaster, controller, interactiveObjects)
      const { origin, direction } = getRayFromInput(controller)
      events.dispatchEvent(
        new CustomEvent('selectend', {
          detail: { controllerIndex: index, intersections, origin, direction },
        })
      )
    })

    const grip = renderer.xr.getControllerGrip(index)
    scene.add(grip)
    controllerGrips.push(grip)
  }

  return {
    controllers,
    controllerGrips,
    events,
    update() {
      for (const controller of controllers) {
        const index = controller.userData.controllerIndex
        const intersections = intersectFromInput(raycaster, controller, interactiveObjects)
        const ray = controller.getObjectByName('ray')
        if (ray) {
          ray.material.color.set(intersections.length > 0 ? 0xff44cc : 0x66ccff)
        }
        if (selecting[index]) {
          const { origin, direction } = getRayFromInput(controller)
          events.dispatchEvent(
            new CustomEvent('selectmove', {
              detail: { controllerIndex: index, intersections, origin, direction },
            })
          )
        }
      }
    },
  }
}
