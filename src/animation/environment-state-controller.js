const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

export const ENVIRONMENT_ANIMATION_STATE_CONFIG = {
  // Track indices are preserved exactly as provided by you (1-based).
  // The adapter converts them to 0-based clip indices for gltf.animations/actions arrays.
  clipIndexBase: 1,
  states: {
    bed1: {
      label: 'Bed 1',
      animationIndices: [1, 11, 13, 14],
      semantics: {
        ON: 'bed 1 open',
        OFF: 'bed 1 close',
      },
      initialValue: false,
      dependencies: [
        {
          type: 'exclusiveOnWith',
          whenValue: true,
          states: ['bed2'],
          reason: 'only one bed can be ON at a time',
        },
      ],
    },
    bed2: {
      label: 'Bed 2',
      animationIndices: [10, 11, 13, 14],
      semantics: {
        ON: 'bed 2 open',
        OFF: 'bed 2 close',
      },
      initialValue: false,
      dependencies: [
        {
          type: 'exclusiveOnWith',
          whenValue: true,
          states: ['bed1'],
          reason: 'only one bed can be ON at a time',
        },
      ],
    },
    shower: {
      label: 'Shower',
      animationIndices: [9],
      semantics: {
        ON: 'shower open',
        OFF: 'shower close',
      },
      initialValue: false,
      dependencies: [
        {
          type: 'requiresStatesOff',
          whenValue: true,
          states: ['bed1', 'bed2'],
          reason: 'shower can open only if both beds are closed',
        },
      ],
    },
    kitchen: {
      label: 'Kitchen',
      animationIndices: [2, 3, 4, 5, 6, 7, 8],
      semantics: {
        // Preserved exactly as requested, even though semantics are inverted.
        ON: 'kitchen closed',
        OFF: 'kitchen open',
      },
      initialValue: false,
      dependencies: [],
    },
    toilet: {
      label: 'Toilet',
      animationIndices: [16],
      semantics: {
        ON: 'toilet on',
        OFF: 'toilet off',
      },
      initialValue: false,
      dependencies: [],
    },
  },
}

const DEFAULT_DEBUG_SEQUENCE = [
  { stateName: 'bed1', value: true },
  { stateName: 'bed1', value: false },
  { stateName: 'bed2', value: true },
  { stateName: 'bed2', value: false },
  { stateName: 'shower', value: true },
  { stateName: 'shower', value: false },
  { stateName: 'kitchen', value: true },
  { stateName: 'kitchen', value: false },
  { stateName: 'toilet', value: true },
  { stateName: 'toilet', value: false },
]

export const createEnvironmentAnimationStateController = ({
  config = ENVIRONMENT_ANIMATION_STATE_CONFIG,
  mixer,
  actions,
  logger = console,
}) => {
  const currentState = {}
  const stateEntries = Object.entries(config.states)
  let isDebugSequenceRunning = false

  for (const [stateName, stateConfig] of stateEntries) {
    currentState[stateName] = Boolean(stateConfig.initialValue)
  }

  const stopActions = (actionGroup) => {
    for (let actionIndex = 0; actionIndex < actionGroup.length; actionIndex += 1) {
      actionGroup[actionIndex].stop()
    }
  }

  const resolveActionsForState = (stateName) => {
    const stateConfig = config.states[stateName]
    if (!stateConfig) return []
    const resolvedActions = []
    for (let index = 0; index < stateConfig.animationIndices.length; index += 1) {
      const configuredIndex = stateConfig.animationIndices[index]
      const clipIndex = configuredIndex - config.clipIndexBase
      if (clipIndex < 0 || clipIndex >= actions.length) {
        logger.warn(
          `[animation-state] ${stateName}: configured index ${configuredIndex} resolved to invalid clip index ${clipIndex}`
        )
        continue
      }
      resolvedActions.push(actions[clipIndex])
    }
    return resolvedActions
  }

  const getBlockedReason = (stateName, nextValue) => {
    const stateConfig = config.states[stateName]
    if (!stateConfig) return `unknown state "${stateName}"`
    const dependencies = stateConfig.dependencies || []
    const isKitchenToiletState = stateName === 'kitchen' || stateName === 'toilet'

    if (isKitchenToiletState) {
      const kitchenIsOn = Boolean(currentState.kitchen)
      const toiletIsOn = Boolean(currentState.toilet)

      // Requested transition rules:
      // 1) If toilet=OFF and kitchen=OFF, only kitchen can turn ON.
      // 2) If toilet=OFF and kitchen=ON, toilet can turn ON and kitchen can turn OFF.
      // 3) If toilet=ON and kitchen=ON, only toilet can turn OFF.
      if (stateName === 'toilet' && nextValue === true && !toiletIsOn && !kitchenIsOn) {
        return 'blocked by rule: with toilet OFF + kitchen OFF, only kitchen can be turned ON'
      }
      if (stateName === 'kitchen' && nextValue === false && toiletIsOn && kitchenIsOn) {
        return 'blocked by rule: with toilet ON + kitchen ON, only toilet can be turned OFF'
      }
    }

    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
      const dependency = dependencies[dependencyIndex]
      if (dependency.whenValue !== nextValue) continue

      if (dependency.type === 'requiresStatesOff') {
        for (let stateIndex = 0; stateIndex < dependency.states.length; stateIndex += 1) {
          const dependencyState = dependency.states[stateIndex]
          if (currentState[dependencyState]) {
            return dependency.reason
          }
        }
      }

      if (dependency.type === 'exclusiveOnWith') {
        for (let stateIndex = 0; stateIndex < dependency.states.length; stateIndex += 1) {
          const dependencyState = dependency.states[stateIndex]
          if (currentState[dependencyState]) {
            return dependency.reason
          }
        }
      }

      if (dependency.type === 'requiresStatesOn') {
        for (let stateIndex = 0; stateIndex < dependency.states.length; stateIndex += 1) {
          const dependencyState = dependency.states[stateIndex]
          if (!currentState[dependencyState]) {
            return dependency.reason
          }
        }
      }
    }

    return null
  }

  const waitForActionsToFinish = (stateName, actionGroup) =>
    new Promise((resolve) => {
      if (!Array.isArray(actionGroup) || actionGroup.length === 0) {
        resolve()
        return
      }

      const pendingActions = new Set(actionGroup)
      const maxClipDurationSeconds = actionGroup.reduce((maxDuration, action) => {
        const duration = action.getClip()?.duration || 0
        return Math.max(maxDuration, duration)
      }, 0)
      const timeoutMilliseconds = Math.max(1000, Math.ceil(maxClipDurationSeconds * 1400))
      let finished = false

      const cleanup = () => {
        mixer.removeEventListener('finished', onFinished)
        clearTimeout(timeoutId)
      }

      const onFinished = (event) => {
        if (!pendingActions.has(event.action)) return
        pendingActions.delete(event.action)
        if (pendingActions.size > 0) return

        if (finished) return
        finished = true
        cleanup()
        resolve()
      }

      const timeoutId = setTimeout(() => {
        if (finished) return
        finished = true
        cleanup()
        logger.warn(
          `[animation-state] ${stateName}: timed out waiting for actions to finish; continuing`
        )
        resolve()
      }, timeoutMilliseconds)

      mixer.addEventListener('finished', onFinished)
    })

  const setState = async (stateName, nextValue, options = {}) => {
    const stateConfig = config.states[stateName]
    if (!stateConfig) {
      logger.warn(`[animation-state] blocked: unknown state "${stateName}"`)
      return false
    }

    const normalizedValue = Boolean(nextValue)
    const currentValue = currentState[stateName]
    const targetLabel = normalizedValue ? 'ON' : 'OFF'
    const targetSemantic = stateConfig.semantics[targetLabel]
    const source = options.source || 'manual'

    if (currentValue === normalizedValue) {
      logger.log(
        `[animation-state] no-op (${source}) ${stateName} already ${targetLabel} (${targetSemantic})`
      )
      return true
    }

    const blockedReason = getBlockedReason(stateName, normalizedValue)
    if (blockedReason) {
      logger.warn(
        `[animation-state] blocked (${source}) ${stateName} -> ${targetLabel} (${targetSemantic}) | reason: ${blockedReason}`
      )
      return false
    }

    const actionsForState = resolveActionsForState(stateName)
    if (actionsForState.length === 0) {
      logger.warn(
        `[animation-state] blocked (${source}) ${stateName} -> ${targetLabel}: no valid actions mapped`
      )
      return false
    }

    // Important: do not stop unrelated actions here.
    // Stopping all actions clears clamped end poses from other ON states
    // (e.g. kitchen snapping OFF when toilet turns ON).
    stopActions(actionsForState)
    const playDirection = normalizedValue ? 'forward' : 'reverse'
    for (let actionIndex = 0; actionIndex < actionsForState.length; actionIndex += 1) {
      const action = actionsForState[actionIndex]
      const clipDuration = action.getClip()?.duration || 0
      action.reset()
      action.clampWhenFinished = true
      action.paused = false
      action.enabled = true
      if (normalizedValue) {
        // ON: animate forward from start to end.
        action.time = 0
        action.timeScale = 1
      } else {
        // OFF: animate in reverse from end to start.
        action.time = clipDuration
        action.timeScale = -1
      }
      action.play()
    }

    const clipNames = actionsForState
      .map((action) => action.getClip()?.name || 'unnamed')
      .join(', ')
    logger.log(
      `[animation-state] playing (${source}) ${stateName} -> ${targetLabel} (${targetSemantic}) | direction: ${playDirection} | clips: ${clipNames}`
    )
    await waitForActionsToFinish(stateName, actionsForState)
    currentState[stateName] = normalizedValue
    logger.log(
      `[animation-state] complete (${source}) ${stateName} = ${targetLabel} (${targetSemantic})`
    )
    return true
  }

  const runSequentialDebugTest = async ({
    sequence = DEFAULT_DEBUG_SEQUENCE,
    stepDelayMs = 300,
  } = {}) => {
    if (isDebugSequenceRunning) {
      logger.log('[animation-state] debug sequence already running')
      return
    }

    isDebugSequenceRunning = true
    logger.log('[animation-state] starting sequential debug test')
    try {
      for (let index = 0; index < sequence.length; index += 1) {
        const step = sequence[index]
        const didApply = await setState(step.stateName, step.value, {
          source: `debug-step-${index + 1}/${sequence.length}`,
        })
        if (!didApply) {
          logger.log(
            `[animation-state] debug step ${index + 1}/${sequence.length} skipped due to constraints`
          )
        }
        await wait(stepDelayMs)
      }
    } finally {
      isDebugSequenceRunning = false
      logger.log('[animation-state] sequential debug test finished')
    }
  }

  const getSnapshot = () => ({ ...currentState })

  return {
    config,
    setState,
    getSnapshot,
    runSequentialDebugTest,
  }
}
