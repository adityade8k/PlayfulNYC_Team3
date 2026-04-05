// ============================================================
//  interactions.js  —  src/components/needs/interactions.js
//
//  Exposes two functions for the asset/animation team to call:
//    interactions.onFurnitureTriggered(furnitureId)
//    interactions.onObjectTriggered(objectId)
//
//  Handles all game logic: occupancy checks, space conflict
//  rules, need refill start/stop, and the kitchen/toilet gate.
// ============================================================

// ── Furniture IDs ─────────────────────────────────────────────
// These are the string IDs your asset team will use.
export const FURNITURE = {
  KITCHEN: 'kitchen',
  SHOWER:  'shower',
  DESK:    'desk',
  BED:     'bed',
}

// ── Interactable object IDs → which need they fill ───────────
// Your asset team calls onObjectTriggered() with these IDs.
const OBJECT_TO_NEED = {
  pan:             'hunger',   // kitchen is deployed
  toilet_curtain:  'poop',     // kitchen is NOT deployed
  shower_curtain:  'shower',
  keyboard:        'sleep',    // desk is deployed (work from home)
  pillow:          'sleep',    // bed is deployed
}

// ── Space conflict rules ──────────────────────────────────────
// Which furniture pieces must be OFF to place each one.
const SPACE_CONFLICTS = {
  [FURNITURE.BED]:    [FURNITURE.SHOWER, FURNITURE.DESK],
  [FURNITURE.SHOWER]: [FURNITURE.BED],
  [FURNITURE.DESK]:   [FURNITURE.BED],
  [FURNITURE.KITCHEN]: [],  // kitchen is independent
}

// ── InteractionSystem ─────────────────────────────────────────

export class InteractionSystem {
  /**
   * @param {object} playerNeedsSession - your PlayerNeedsSession instance
   */
  constructor(playerNeedsSession) {
    this.session = playerNeedsSession

    // Current state of each furniture piece
    this.furnitureState = {
      [FURNITURE.KITCHEN]: false,
      [FURNITURE.SHOWER]:  false,
      [FURNITURE.DESK]:    false,
      [FURNITURE.BED]:     false,
    }

    // Callbacks — assign these so the asset team gets notified
    // of state changes and can trigger animations

    // Called when furniture is successfully toggled
    // (furnitureId, isNowOn) => void
    this.onFurnitureToggled = null

    // Called when a toggle is blocked
    // (furnitureId, reason) => void
    //   reason: 'occupied' | 'space_conflict'
    this.onFurnitureBlocked = null

    // Called when a need refill starts
    // (objectId, needKey, playerId) => void
    this.onRefillStarted = null

    // Called when a need refill finishes (stat reached 100)
    // (objectId, needKey, playerId) => void
    this.onRefillFinished = null

    // Called when an object interaction is blocked
    // (objectId, reason) => void
    //   reason: 'kitchen_blocking_toilet' | 'furniture_not_deployed' | 'already_refilling'
    this.onObjectBlocked = null

    // Track which object each player is currently using
    // key = playerId, value = objectId or null
    this._playerActiveObject = {}

    // Track the previous need value to detect when stat reaches 100
    this._prevNeeds = {}
  }

  // ── Public API — asset team calls these ──────────────────────

  /**
   * Call this when a player triggers a furniture piece.
   * @param {string} furnitureId  - one of FURNITURE.*
   * @param {string} playerId     - 'player_1' | 'player_2'
   */
  onFurnitureTriggered(furnitureId, playerId) {
    if (!this.furnitureState.hasOwnProperty(furnitureId)) {
      console.warn(`[interactions] unknown furniture: ${furnitureId}`)
      return
    }

    // Rule 1 — occupancy check
    const occupancyBlock = this._getFurnitureOccupant(furnitureId)
    if (occupancyBlock) {
      console.log(`[interactions] ${furnitureId} toggle blocked — ${occupancyBlock} is refilling here`)
      this.onFurnitureBlocked?.(furnitureId, 'occupied')
      return
    }

    // Rule 2 — space conflict check (only when turning ON)
    const isCurrentlyOn = this.furnitureState[furnitureId]
    if (!isCurrentlyOn) {
      const conflicts = SPACE_CONFLICTS[furnitureId] || []
      const activeConflict = conflicts.find(f => this.furnitureState[f])
      if (activeConflict) {
        console.log(`[interactions] ${furnitureId} blocked — ${activeConflict} is deployed`)
        this.onFurnitureBlocked?.(furnitureId, 'space_conflict')
        return
      }
    }

    // All clear — toggle
    const isNowOn = !isCurrentlyOn
    this.furnitureState[furnitureId] = isNowOn
    console.log(`[interactions] ${furnitureId} is now ${isNowOn ? 'ON' : 'OFF'}`)
    this.onFurnitureToggled?.(furnitureId, isNowOn)
  }

  /**
   * Call this when a player touches an interactable object and pulls the trigger.
   * @param {string} objectId   - e.g. 'pan', 'pillow', 'toilet_curtain'
   * @param {string} playerId   - 'player_1' | 'player_2'
   */
  onObjectTriggered(objectId, playerId) {
    const needKey = OBJECT_TO_NEED[objectId]
    if (!needKey) {
      console.warn(`[interactions] unknown object: ${objectId}`)
      return
    }

    const playerNeeds = this.session.getPlayer(playerId)
    if (!playerNeeds) {
      console.warn(`[interactions] unknown player: ${playerId}`)
      return
    }

    // Gate — toilet only available when kitchen is OFF
    if (objectId === 'toilet_curtain' && this.furnitureState[FURNITURE.KITCHEN]) {
      console.log(`[interactions] toilet blocked — kitchen is deployed`)
      this.onObjectBlocked?.(objectId, 'kitchen_blocking_toilet')
      return
    }

    // Gate — pan only available when kitchen is ON
    if (objectId === 'pan' && !this.furnitureState[FURNITURE.KITCHEN]) {
      console.log(`[interactions] pan blocked — kitchen is not deployed`)
      this.onObjectBlocked?.(objectId, 'furniture_not_deployed')
      return
    }

    // Gate — shower curtain only available when shower is ON
    if (objectId === 'shower_curtain' && !this.furnitureState[FURNITURE.SHOWER]) {
      console.log(`[interactions] shower curtain blocked — shower is not deployed`)
      this.onObjectBlocked?.(objectId, 'furniture_not_deployed')
      return
    }

    // Gate — keyboard only available when desk is ON
    if (objectId === 'keyboard' && !this.furnitureState[FURNITURE.DESK]) {
      console.log(`[interactions] keyboard blocked — desk is not deployed`)
      this.onObjectBlocked?.(objectId, 'furniture_not_deployed')
      return
    }

    // Gate — pillow only available when bed is ON
    if (objectId === 'pillow' && !this.furnitureState[FURNITURE.BED]) {
      console.log(`[interactions] pillow blocked — bed is not deployed`)
      this.onObjectBlocked?.(objectId, 'furniture_not_deployed')
      return
    }

    // Gate — player already refilling something
    if (this._playerActiveObject[playerId]) {
      console.log(`[interactions] ${playerId} already refilling ${this._playerActiveObject[playerId]}`)
      this.onObjectBlocked?.(objectId, 'already_refilling')
      return
    }

    // All clear — start refill
    this._playerActiveObject[playerId] = objectId
    this._prevNeeds[playerId] = { ...playerNeeds.needs }
    playerNeeds.enterZone(needKey)

    console.log(`[interactions] ${playerId} started refilling ${needKey} via ${objectId}`)
    this.onRefillStarted?.(objectId, needKey, playerId)
  }

  /**
   * Call this when a player releases the trigger or leaves the object.
   * @param {string} playerId - 'player_1' | 'player_2'
   */
  onObjectReleased(playerId) {
    const objectId = this._playerActiveObject[playerId]
    if (!objectId) return

    const needKey = OBJECT_TO_NEED[objectId]
    const playerNeeds = this.session.getPlayer(playerId)

    playerNeeds?.exitZone()
    this._playerActiveObject[playerId] = null

    console.log(`[interactions] ${playerId} stopped refilling ${needKey}`)
  }

  // ── update() — call every frame ───────────────────────────────
  // Detects when a stat reaches 100 and auto-stops the refill.

  update() {
    for (const [playerId, objectId] of Object.entries(this._playerActiveObject)) {
      if (!objectId) continue

      const needKey = OBJECT_TO_NEED[objectId]
      const playerNeeds = this.session.getPlayer(playerId)
      if (!playerNeeds) continue

      const currentValue = playerNeeds.needs[needKey]
      if (currentValue >= 100) {
        playerNeeds.exitZone()
        this._playerActiveObject[playerId] = null
        console.log(`[interactions] ${playerId} finished refilling ${needKey}`)
        this.onRefillFinished?.(objectId, needKey, playerId)
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Returns the playerId currently refilling a stat in a given furniture space, or null */
  _getFurnitureOccupant(furnitureId) {
    const objectsInFurniture = {
      [FURNITURE.KITCHEN]: ['pan'],
      [FURNITURE.SHOWER]:  ['shower_curtain'],
      [FURNITURE.DESK]:    ['keyboard'],
      [FURNITURE.BED]:     ['pillow'],
    }

    const objects = objectsInFurniture[furnitureId] || []
    for (const [playerId, activeObject] of Object.entries(this._playerActiveObject)) {
      if (activeObject && objects.includes(activeObject)) return playerId
    }

    // Special case: toilet is in the kitchen space
    if (furnitureId === FURNITURE.KITCHEN) {
      for (const [playerId, activeObject] of Object.entries(this._playerActiveObject)) {
        if (activeObject === 'toilet_curtain') return playerId
      }
    }

    return null
  }

  /** Returns the full current apartment state — useful for debugging */
  getState() {
    return {
      furniture:    { ...this.furnitureState },
      activeRefills: { ...this._playerActiveObject },
    }
  }
}
