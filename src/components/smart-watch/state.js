export const NEEDS_UI_CONFIG = {
  hunger: { label: 'Hunger', icon: '\u{1F37D}' },
  poop: { label: 'Poop', icon: '\u{1F6BD}' },
  shower: { label: 'Hygiene', icon: '\u{1F9FC}' },
  sleep: { label: 'Sleep', icon: '\u{1F319}' },
}

export const NEED_ORDER = Object.keys(NEEDS_UI_CONFIG)

const COLOR_BY_KEY = {
  red: '#e14b4b',
  yellow: '#f0c541',
  green: '#41c95b',
}

const clampValue = (value) => Math.max(0, Math.min(100, Math.round(value)))
const clone = (value) => JSON.parse(JSON.stringify(value))

const resolveNeedColor = (value, colorName) => {
  if (colorName && COLOR_BY_KEY[colorName]) return COLOR_BY_KEY[colorName]
  if (value < 25) return '#e14b4b'
  if (value < 50) return '#f0c541'
  if (value < 75) return '#8fe36a'
  return '#41c95b'
}

const sanitizeSessionSummary = (summary) => {
  if (!summary || typeof summary !== 'object') return null

  const normalizedPlayers = Array.isArray(summary.summaries)
    ? summary.summaries
        .map((player, index) => {
          const overallScore = Number(player?.overallScore)
          if (!Number.isFinite(overallScore)) return null
          return {
            playerId:
              typeof player?.playerId === 'string' && player.playerId.trim()
                ? player.playerId.trim()
                : `player_${index + 1}`,
            overallScore: clampValue(overallScore),
          }
        })
        .filter(Boolean)
    : []

  const teamScoreRaw = Number(summary.teamScore)
  const teamScore = Number.isFinite(teamScoreRaw)
    ? clampValue(teamScoreRaw)
    : normalizedPlayers.length > 0
      ? clampValue(
          normalizedPlayers.reduce((sum, player) => sum + player.overallScore, 0) /
            normalizedPlayers.length
        )
      : null

  const teamStarsRaw = Number(summary.teamStars)
  const teamStars = Number.isFinite(teamStarsRaw)
    ? Math.max(0, Math.min(3, Math.round(teamStarsRaw)))
    : teamScore === null
      ? null
      : teamScore >= 80
        ? 3
        : teamScore >= 50
          ? 2
          : teamScore >= 25
            ? 1
            : 0

  return {
    teamScore,
    teamStars,
    summaries: normalizedPlayers,
  }
}

const buildInitialState = (playerNeedsSession = null, playerId = null) => {
  const playerNeeds = playerNeedsSession?.getPlayer?.(playerId)
  const playerState = playerNeeds?.getState?.()
  const liveNeeds = playerState?.needs || {}
  const liveColors = playerState?.colors || {}

  return {
    screen: 'incoming-call',
    call: {
      started: false,
      audioReady: false,
      speaking: false,
      finished: false,
      error: null,
    },
    sessionSummary: null,
    needs: Object.fromEntries(
      Object.entries(NEEDS_UI_CONFIG).map(([key, config]) => {
        const value = clampValue(liveNeeds[key] ?? 100)
        return [
          key,
          {
            label: config.label,
            icon: config.icon,
            value,
            color: resolveNeedColor(value, liveColors[key]),
          },
        ]
      })
    ),
  }
}

export const createSmartWatchStore = (
  playerNeedsSession = null,
  playerId = null
) => {
  let activePlayerId = playerId
  let state = buildInitialState(playerNeedsSession, activePlayerId)
  const subscribers = new Set()
  let restoreNeedChangedHandler = null

  const bindPlayerNeeds = (nextPlayerId) => {
    if (activePlayerId === nextPlayerId) return

    restoreNeedChangedHandler?.()
    restoreNeedChangedHandler = null
    activePlayerId = nextPlayerId

    state = {
      ...state,
      needs: buildInitialState(playerNeedsSession, activePlayerId).needs,
    }

    const playerNeeds = playerNeedsSession?.getPlayer?.(activePlayerId)
    if (playerNeeds) {
      const previousOnNeedChanged = playerNeeds.onNeedChanged
      playerNeeds.onNeedChanged = (changedPlayerId, needKey, value, color) => {
        if (changedPlayerId === activePlayerId) {
          api.setNeedFromSession(needKey, value, color)
        }
        if (typeof previousOnNeedChanged === 'function') {
          previousOnNeedChanged(changedPlayerId, needKey, value, color)
        }
      }

      restoreNeedChangedHandler = () => {
        playerNeeds.onNeedChanged = previousOnNeedChanged || null
      }
    }

    notify()
  }

  const notify = () => {
    const snapshot = clone(state)
    for (const subscriber of subscribers) subscriber(snapshot)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('smart-watch:state-change', { detail: snapshot })
      )
    }
  }

  const api = {
    getState() {
      return clone(state)
    },

    getPlayerId() {
      return activePlayerId
    },

    subscribe(callback) {
      subscribers.add(callback)
      callback(clone(state))
      return () => subscribers.delete(callback)
    },

    bindPlayerNeeds(playerId) {
      bindPlayerNeeds(playerId || null)
    },

    setScreen(screen) {
      state.screen = screen
      notify()
    },

    setCallState(partial) {
      state.call = { ...state.call, ...partial }
      notify()
    },

    setSessionSummary(summary) {
      state.sessionSummary = sanitizeSessionSummary(summary)
      notify()
    },

    setNeed(needKey, value) {
      if (!state.needs[needKey]) return
      state.needs[needKey].value = clampValue(value)
      state.needs[needKey].color = resolveNeedColor(state.needs[needKey].value)
      notify()
    },

    setNeedFromSession(needKey, value, colorName) {
      if (!state.needs[needKey]) return
      state.needs[needKey].value = clampValue(value)
      state.needs[needKey].color = resolveNeedColor(state.needs[needKey].value, colorName)
      notify()
    },

    adjustNeed(needKey, delta) {
      if (!state.needs[needKey]) return
      state.needs[needKey].value = clampValue(state.needs[needKey].value + delta)
      state.needs[needKey].color = resolveNeedColor(state.needs[needKey].value)
      notify()
    },

    reset() {
      state = buildInitialState(playerNeedsSession, activePlayerId)
      notify()
    },

    dispose() {
      restoreNeedChangedHandler?.()
      restoreNeedChangedHandler = null
    },
  }

  bindPlayerNeeds(activePlayerId)

  return api
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
