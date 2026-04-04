import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export function createGltfLoader(scene) {
  const loader = new GLTFLoader()
  const events = new EventTarget()
  let root = null
  let mixer = null
  const actions = new Map()
  let state = 'idle'

  const setState = (nextState) => {
    state = nextState
    events.dispatchEvent(new CustomEvent('statechange', { detail: { state } }))
  }

  const stopAll = () => {
    for (const action of actions.values()) {
      action.stop()
    }
  }

  return {
    events,
    async load(url, transform = {}) {
      const gltf = await loader.loadAsync(url)

      if (root) {
        scene.remove(root)
      }

      root = gltf.scene
      root.position.fromArray(transform.position ?? [0, 0, 0])
      root.rotation.fromArray(transform.rotation ?? [0, 0, 0])
      root.scale.fromArray(transform.scale ?? [1, 1, 1])
      scene.add(root)

      actions.clear()
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(root)
        for (const clip of gltf.animations) {
          actions.set(clip.name, mixer.clipAction(clip))
        }
      } else {
        mixer = null
      }

      setState('loaded')
      events.dispatchEvent(
        new CustomEvent('loaded', {
          detail: {
            root,
            animations: gltf.animations,
            actionNames: [...actions.keys()],
          },
        })
      )

      return {
        root,
        animations: gltf.animations,
        actionNames: [...actions.keys()],
      }
    },
    play(animationName) {
      const action = actions.get(animationName)
      if (!action) return false
      action.reset().play()
      setState(`playing:${animationName}`)
      return true
    },
    stop(animationName) {
      if (!animationName) {
        stopAll()
        setState('stopped')
        return true
      }

      const action = actions.get(animationName)
      if (!action) return false
      action.stop()
      setState(`stopped:${animationName}`)
      return true
    },
    getState() {
      return state
    },
    getAnimations() {
      return [...actions.keys()]
    },
    getRoot() {
      return root
    },
    update(deltaSeconds) {
      if (mixer) mixer.update(deltaSeconds)
    },
  }
}
