const NEEDS = {
  hygiene: { label: 'Hygiene', icon: '\u{1F9FC}', value: 84 },
  hunger: { label: 'Hunger', icon: '\u{1F37D}', value: 62 },
  bladder: { label: 'Bladder', icon: '\u{1F6BD}', value: 74 },
  work: { label: 'Work', icon: '\u{1F4BC}', value: 57 },
  energy: { label: 'Energy', icon: '\u{1F319}', value: 48 },
  social: { label: 'Social', icon: '\u{1F4AC}', value: 71 },
}
// later port the NEEDS value to a dynamic system that changes over time and based on interactions

export const NEED_ORDER = ['hygiene', 'hunger', 'bladder', 'work', 'energy', 'social']

const clampValue = (value) => Math.max(0, Math.min(100, Math.round(value)))
const clone = (value) => JSON.parse(JSON.stringify(value))

const buildInitialState = () => ({
  screen: 'incoming-call',
  call: {
    started: false,
    audioReady: false,
    speaking: false,
    finished: false,
    error: null,
  },
  needs: Object.fromEntries(
    Object.entries(NEEDS).map(([key, config]) => [
      key,
      {
        label: config.label,
        icon: config.icon,
        value: config.value,
      },
    ])
  ),
})

export const createSmartWatchStore = () => {
  let state = buildInitialState()
  const subscribers = new Set()

  const notify = () => {
    const snapshot = clone(state)
    for (const subscriber of subscribers) subscriber(snapshot)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('smart-watch:state-change', { detail: snapshot })
      )
    }
  }

  return {
    getState() {
      return clone(state)
    },

    subscribe(callback) {
      subscribers.add(callback)
      callback(clone(state))
      return () => subscribers.delete(callback)
    },

    setScreen(screen) {
      state.screen = screen
      notify()
    },

    setCallState(partial) {
      state.call = { ...state.call, ...partial }
      notify()
    },

    setNeed(needKey, value) {
      if (!state.needs[needKey]) return
      state.needs[needKey].value = clampValue(value)
      notify()
    },

    adjustNeed(needKey, delta) {
      if (!state.needs[needKey]) return
      state.needs[needKey].value = clampValue(state.needs[needKey].value + delta)
      notify()
    },

    reset() {
      state = buildInitialState()
      notify()
    },
  }
}

export const attachSmartWatchGlobals = (store) => {
  if (typeof window === 'undefined') return

  window.smartWatchStore = store
  window.updateSmartWatchNeed = (needKey, delta) => {
    store.adjustNeed(String(needKey).toLowerCase(), Number(delta) || 0)
  }
  window.setSmartWatchNeed = (needKey, value) => {
    store.setNeed(String(needKey).toLowerCase(), Number(value) || 0)
  }

  window.addEventListener('smart-watch:adjust-need', (event) => {
    const { need, delta } = event.detail || {}
    if (typeof need === 'string') {
      store.adjustNeed(need.toLowerCase(), Number(delta) || 0)
    }
  })

  window.addEventListener('smart-watch:set-need', (event) => {
    const { need, value } = event.detail || {}
    if (typeof need === 'string') {
      store.setNeed(need.toLowerCase(), Number(value) || 0)
    }
  })
}
