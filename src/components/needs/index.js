// ============================================================
//  PlayerNeedsSystem.js
//  Pure JS — no Three.js dependency, no framework required.
//  Drop this into any game loop; connect XR/multiplayer later.
// ============================================================

// ── Configuration ────────────────────────────────────────────
// All rates are in "units per second" on a 0–100 scale.
// Tweak DECAY_RATES and FILL_RATES to change game feel.

export const NEEDS_CONFIG = {
  gameDuration: 30,        // seconds (default 60s; change freely)
  // Optional watch start hour (24h format). The watch advances
  // through a full 24-hour cycle over gameDuration.
  watchStartHour24: 8,
  // Session milestones (% complete) used by ambience cues and day progression.
  sessionMilestones: {
    nightCompletionPercent: 50,
    nextMorningCompletionPercent: 90,
  },

  // How fast each bar drains per second (0–100 scale)
  decayRates: {
    hunger: 1.8,            // fastest — you get hungry quick
    poop:   1.2,            // medium
    shower: 0.6,            // slow — you can hold it
    sleep:  0.4,            // very slow — long cycle
  },

  // How fast each bar fills while player is in the zone
  fillRates: {
    hunger: 25,             // eating is fast
    poop:   20,             // bathroom takes a moment
    shower: 15,             // shower takes longer
    sleep:  8,              // sleep is slowest to fill
  },

  // Thresholds for bar color and scoring (0–100)
  // green → yellow → red
  thresholds: {
    green:  60,   // above this = green
    yellow: 30,   // above this = yellow, below = red
  },
}

const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const formatHourMinute = (hour24, minute) => {
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`
}

export const getWatchClockFromElapsed = (
  elapsedRealSeconds = 0,
  durationRealSeconds = NEEDS_CONFIG.gameDuration,
  config = NEEDS_CONFIG
) => {
  const durationSeconds = toPositiveNumber(
    durationRealSeconds,
    NEEDS_CONFIG.gameDuration
  )
  const startHour24 = Math.max(
    0,
    Math.min(23, Math.floor(toPositiveNumber(config.watchStartHour24, 8)))
  )

  const elapsedSeconds = Math.max(0, Number(elapsedRealSeconds) || 0)
  const progress = Math.max(0, Math.min(1, elapsedSeconds / durationSeconds))
  const watchElapsedSeconds = progress * 24 * 60 * 60
  const totalWatchSeconds = startHour24 * 3600 + watchElapsedSeconds
  const dayNumber = Math.floor(totalWatchSeconds / 86400) + 1
  const secondsOfDay = totalWatchSeconds % 86400
  const hour24 = Math.floor(secondsOfDay / 3600)
  const minute = Math.floor((secondsOfDay % 3600) / 60)

  return {
    dayNumber,
    hour24,
    minute,
    timeLabel: formatHourMinute(hour24, minute),
    dayLabel: `DAY ${dayNumber}`,
  }
}

export const getSessionCompletionPercent = (
  elapsedRealSeconds = 0,
  durationSeconds = NEEDS_CONFIG.gameDuration
) => {
  const duration = toPositiveNumber(durationSeconds, NEEDS_CONFIG.gameDuration)
  const elapsed = Math.max(0, Number(elapsedRealSeconds) || 0)
  return Math.max(0, Math.min(100, (elapsed / duration) * 100))
}

// ── Shame event messages ──────────────────────────────────────
const SHAME_MESSAGES = {
  hunger: [
    'skipped a meal',
    'went malnourished',
    'forgot to eat again',
  ],
  poop: [
    'pooped their pants',
    'had an accident',
    "couldn't hold it",
  ],
  shower: [
    'became unbearable to live with',
    'started to smell',
    'skipped another shower',
  ],
  sleep: [
    'passed out on the floor',
    'collapsed from exhaustion',
    'fell asleep standing up',
  ],
}

function randomMessage(needKey) {
  const msgs = SHAME_MESSAGES[needKey]
  return msgs[Math.floor(Math.random() * msgs.length)]
}

// ── PlayerNeeds ───────────────────────────────────────────────
// Tracks one player's four need bars.
// One instance per player — managed by PlayerNeedsSession.

export class PlayerNeeds {
  /**
   * @param {string} playerId  - e.g. 'player_1', 'player_2'
   * @param {object} config    - optional overrides for NEEDS_CONFIG
   */
  constructor(playerId, config = {}) {
    this.playerId = playerId
    this.cfg = {
      ...NEEDS_CONFIG,
      decayRates: { ...NEEDS_CONFIG.decayRates, ...config.decayRates },
      fillRates:  { ...NEEDS_CONFIG.fillRates,  ...config.fillRates  },
      thresholds: { ...NEEDS_CONFIG.thresholds, ...config.thresholds },
      ...config,
    }

    // Current bar values (0–100)
    this.needs = { hunger: 100, poop: 100, shower: 100, sleep: 100 }

    // Which zone the player is currently standing in (null = none)
    // Set this from your XR collider / zone detection
    this.activeZone = null  // 'hunger' | 'poop' | 'shower' | 'sleep' | null

    // Shame log — array of { need, message, timestamp }
    this.shameEvents = []

    // Snapshot history for end-of-game scoring — recorded every second
    this._history = []
    this._historyTimer = 0

    // ── Callbacks — assign these to connect UI and multiplayer ──
    // Called every frame a value changes:
    this.onNeedChanged = null  // (playerId, needKey, newValue, color) => void
    // Called when a bar hits zero:
    this.onShameEvent  = null  // (playerId, { need, message, timestamp }) => void
    // Called when the game ends:
    this.onGameOver    = null  // (playerId, summary) => void
  }

  // ── update() — call every frame from your game loop ─────────

  update(deltaTime) {
    for (const key of Object.keys(this.needs)) {
      const prev = this.needs[key]
      let val = prev

      // Always decaying
      val -= this.cfg.decayRates[key] * deltaTime

      // Fill while player is standing in the matching zone
      if (this.activeZone === key) {
        val += this.cfg.fillRates[key] * deltaTime
      }

      // Clamp — bar stays at 0, player must go to zone to recover
      val = Math.min(100, Math.max(0, val))

      // First time hitting zero → log a shame event
      if (val <= 0 && prev > 0) {
        this._logShame(key)
      }

      if (val !== prev) {
        this.needs[key] = val
        this.onNeedChanged?.(this.playerId, key, val, this.getBarColor(key))
      }
    }

    // Record a snapshot every second for end-of-game scoring
    this._historyTimer += deltaTime
    if (this._historyTimer >= 1) {
      this._historyTimer = 0
      this._history.push({ ...this.needs })
    }
  }

  // ── Zone API — call from your XR collider events ─────────────

  /** Player entered a need zone (e.g. stepped into kitchen area) */
  enterZone(zoneKey) {
    this.activeZone = zoneKey
  }

  /** Player left a need zone */
  exitZone() {
    this.activeZone = null
  }

  // ── Bar color ─────────────────────────────────────────────────

  /** Returns 'green' | 'yellow' | 'red' for a given need. */
  getBarColor(needKey) {
    const val = this.needs[needKey]
    const { green, yellow } = this.cfg.thresholds
    if (val >= green)  return 'green'
    if (val >= yellow) return 'yellow'
    return 'red'
  }

  /** Returns colors for all four needs at once. */
  getAllColors() {
    return Object.fromEntries(
      Object.keys(this.needs).map(k => [k, this.getBarColor(k)])
    )
  }

  // ── State snapshot — for UI polling or network sync ──────────

  /** Plain object, safe to JSON.stringify and send over WebSocket. */
  getState() {
    return {
      playerId:   this.playerId,
      needs:      { ...this.needs },
      colors:     this.getAllColors(),  // 'green' | 'yellow' | 'red' per need
      activeZone: this.activeZone,
      shameCount: this.shameEvents.length,
    }
  }

  // ── End-of-game scoring ───────────────────────────────────────

  /** Call at end of game. Returns a full summary for the results screen. */
  getFinalSummary() {
    const keys = Object.keys(this.needs)
    const { green } = this.cfg.thresholds

    // Per-need score: % of time the bar spent in the green zone
    const needScores = {}
    for (const key of keys) {
      const snapshots = this._history.map(s => s[key])
      const timeInGreen = snapshots.filter(v => v >= green).length
      needScores[key] = snapshots.length > 0
        ? Math.round((timeInGreen / snapshots.length) * 100)
        : 100
    }

    const overallScore = Math.round(
      Object.values(needScores).reduce((a, b) => a + b, 0) / keys.length
    )

    // Shame events grouped by need
    const shameSummary = {}
    for (const key of keys) {
      const events = this.shameEvents.filter(e => e.need === key)
      if (events.length > 0) {
        shameSummary[key] = {
          count:    events.length,
          messages: events.map(e => e.message),
        }
      }
    }

    // Star rating 0–3
    const stars = overallScore >= 80 ? 3
                : overallScore >= 50 ? 2
                : overallScore >= 25 ? 1
                : 0

    const summary = {
      playerId:         this.playerId,
      overallScore,
      needScores,
      shameSummary,
      stars,
      totalShameEvents: this.shameEvents.length,
    }

    this.onGameOver?.(this.playerId, summary)
    return summary
  }

  // ── Private ───────────────────────────────────────────────────

  _logShame(needKey) {
    const event = {
      need:      needKey,
      message:   randomMessage(needKey),
      timestamp: Date.now(),
    }
    this.shameEvents.push(event)
    this.onShameEvent?.(this.playerId, event)
  }
}

// ── PlayerNeedsSession ────────────────────────────────────────
// Manages both players + the game timer.
// Your compañero can replace this with his multiplayer session
// if he wants the server to be authoritative over time.

export class PlayerNeedsSession {
  /**
   * @param {object} config - optional overrides for NEEDS_CONFIG
   */
  constructor(config = {}) {
    this.cfg = { ...NEEDS_CONFIG, ...config }
    this.players = {}
    this.elapsed = 0
    this.running = false

    // Fires when the game ends — receives array of summaries
    this.onSessionEnd = null  // (summaries) => void
  }

  /** Add a player. Returns the PlayerNeeds instance. */
  addPlayer(playerId, perPlayerConfig = {}) {
    const player = new PlayerNeeds(playerId, {
      ...this.cfg,
      ...perPlayerConfig,
    })
    this.players[playerId] = player
    return player
  }

  getPlayer(playerId) {
    return this.players[playerId]
  }

  start() {
    this.running = true
    this.elapsed = 0
  }

  /** Call this inside your Three.js renderer.setAnimationLoop */
  update(deltaTime) {
    if (!this.running) return

    this.elapsed += deltaTime

    for (const player of Object.values(this.players)) {
      player.update(deltaTime)
    }

    if (this.elapsed >= this.cfg.gameDuration) {
      this.end()
    }
  }

  end() {
    this.running = false
    const summaries = Object.values(this.players).map(p => p.getFinalSummary())
    this.onSessionEnd?.(summaries)
    return summaries
  }

  /** Full state snapshot — JSON.stringify this and send over WebSocket. */
  getState() {
    return {
      elapsed:  this.elapsed,
      duration: this.cfg.gameDuration,
      players:  Object.values(this.players).map(p => p.getState()),
    }
  }
}
