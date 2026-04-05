const NEED_IDS = ['hunger', 'poop', 'shower', 'sleep', 'fun']
const ZONE_IDS = ['zone_1', 'zone_2', 'zone_3']

const clone = (value) => JSON.parse(JSON.stringify(value))

const normalizeOccupancy = (occupancy = {}) =>
  Object.fromEntries(ZONE_IDS.map((zoneId) => [zoneId, occupancy?.[zoneId] || null]))

const playerSortWeight = (playerId) => {
  if (playerId === 'player_1') return 0
  if (playerId === 'player_2') return 1
  return 99
}

const resolveNeedForZone = (zoneId, environmentStates, needsPlayerId) => {
  const kitchenOn = Boolean(environmentStates.kitchen)
  const bed1On = Boolean(environmentStates.bed1)
  const bed2On = Boolean(environmentStates.bed2)

  if (zoneId === 'zone_1') {
    return kitchenOn ? 'poop' : 'hunger'
  }

  if (zoneId === 'zone_2') {
    // Zone 2 priority:
    // 1) sleep when this player's own bed is ON
    // 2) fun only when both beds are OFF
    // 3) otherwise no interaction
    if (needsPlayerId === 'player_1' && bed1On) return 'sleep'
    if (needsPlayerId === 'player_2' && bed2On) return 'sleep'
    if (!bed1On && !bed2On) return 'fun'
    return null
  }

  if (zoneId === 'zone_3') {
    // Shower is blocked whenever any bed is ON.
    if (bed1On || bed2On) return null
    return 'shower'
  }

  return null
}

export class InteractionSystem {
  constructor(playerNeedsSession) {
    this.session = playerNeedsSession
    this.lastResolved = {
      occupancy: normalizeOccupancy(),
      candidates: {
        player_1: null,
        player_2: null,
      },
    }
  }

  _resolveOccupancy(candidates, previousOccupancy) {
    const nextOccupancy = normalizeOccupancy()
    const claimsByZone = new Map()
    for (const [playerId, candidate] of Object.entries(candidates)) {
      if (!candidate?.zoneId) continue
      if (!claimsByZone.has(candidate.zoneId)) claimsByZone.set(candidate.zoneId, [])
      claimsByZone.get(candidate.zoneId).push(playerId)
    }

    for (const zoneId of ZONE_IDS) {
      const claimants = claimsByZone.get(zoneId) || []
      if (claimants.length === 0) {
        nextOccupancy[zoneId] = null
        continue
      }
      if (claimants.length === 1) {
        nextOccupancy[zoneId] = claimants[0]
        continue
      }
      const previousOccupant = previousOccupancy?.[zoneId]
      if (previousOccupant && claimants.includes(previousOccupant)) {
        nextOccupancy[zoneId] = previousOccupant
        continue
      }
      nextOccupancy[zoneId] = claimants.sort(
        (a, b) => playerSortWeight(a) - playerSortWeight(b)
      )[0]
    }
    return nextOccupancy
  }

  update({
    playerZones,
    playerGripState,
    environmentStates,
    sharedOccupancy,
    hostCanWriteOccupancy = false,
  }) {
    const candidates = { player_1: null, player_2: null }
    const previousOccupancy = normalizeOccupancy(sharedOccupancy)
    for (const playerId of ['player_1', 'player_2']) {
      const zoneId = playerZones?.[playerId] || null
      const isGripHeld = Boolean(playerGripState?.[playerId])
      if (!zoneId || !isGripHeld) continue
      const needId = resolveNeedForZone(zoneId, environmentStates || {}, playerId)
      if (!needId || !NEED_IDS.includes(needId)) continue
      candidates[playerId] = { zoneId, needId }
    }

    const occupancy = hostCanWriteOccupancy
      ? this._resolveOccupancy(candidates, previousOccupancy)
      : previousOccupancy

    for (const playerId of ['player_1', 'player_2']) {
      const player = this.session.getPlayer(playerId)
      if (!player) continue
      const candidate = candidates[playerId]
      const isAllowed =
        candidate &&
        occupancy[candidate.zoneId] === playerId
      player.setActiveNeed(isAllowed ? candidate.needId : null)
    }

    this.lastResolved = {
      occupancy: clone(occupancy),
      candidates: clone(candidates),
    }
    return this.lastResolved
  }

  clearActiveNeeds() {
    for (const playerId of ['player_1', 'player_2']) {
      const player = this.session.getPlayer(playerId)
      player?.setActiveNeed(null)
    }
  }

  getState() {
    return {
      occupancy: clone(this.lastResolved.occupancy),
      candidates: clone(this.lastResolved.candidates),
    }
  }
}