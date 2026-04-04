import { createDefaultSharedState } from '../../shared/default-state.js'
import {
  connectSocket,
  broadcastGlobal as broadcastGlobalValue,
  setSynchronized,
  synchronize,
} from './clientSync.js'

const playerState = {
  players: {},
  selfId: null,
}

let socket = null
let hasBoundSocketEvents = false
const stateSubscribers = new Set()

const clone = (value) => JSON.parse(JSON.stringify(value))

const notifyStateSubscribers = () => {
  const snapshot = getSnapshot()
  for (const callback of stateSubscribers) {
    callback(snapshot)
  }
}

const applyPlayerUpdate = (playerId, incomingPlayer) => {
  if (!playerId || !incomingPlayer) return
  playerState.players[playerId] = clone(incomingPlayer)
  notifyStateSubscribers()
}

const describeSpawnSide = (slotIndex) => {
  if (slotIndex === 0) return 'left'
  if (slotIndex === 1) return 'right'
  return 'unknown'
}

const applySnapshot = (payload) => {
  if (!payload || typeof payload !== 'object') return
  if (typeof payload.selfId === 'string') {
    playerState.selfId = payload.selfId
  }
  if (payload.players && typeof payload.players === 'object') {
    playerState.players = clone(payload.players)
  }
  notifyStateSubscribers()
}

const onSocketMessage = (event) => {
  let payload
  try {
    payload = JSON.parse(event.data)
  } catch (error) {
    console.warn('[multiplayer] Ignoring non-JSON message.', error)
    return
  }

  if (!payload || typeof payload !== 'object') return

  if (payload.type === 'welcome' || payload.type === 'snapshot') {
    applySnapshot(payload)
    if (payload.type === 'welcome' && payload.selfId && payload.players?.[payload.selfId]) {
      const selfPlayer = payload.players[payload.selfId]
      console.log(
        `[multiplayer] connected as #${selfPlayer.connectionOrder ?? '?'} on ${describeSpawnSide(selfPlayer.slotIndex)} spawn`
      )
    }
    return
  }

  if (payload.type === 'player-join') {
    const spawnSide = describeSpawnSide(payload.player?.slotIndex)
    console.log(
      `[multiplayer] player joined: ${payload.id} (#${payload.player?.connectionOrder ?? '?'}, spawn=${spawnSide})`
    )
    applyPlayerUpdate(payload.id, payload.player)
    return
  }

  if (payload.type === 'player-update') {
    applyPlayerUpdate(payload.id, payload.player)
    return
  }

  if (payload.type === 'player-leave' && payload.id) {
    delete playerState.players[payload.id]
    notifyStateSubscribers()
  }
}

export function connectMultiplayer() {
  if (socket) return socket

  socket = connectSocket()
  if (!hasBoundSocketEvents && socket) {
    hasBoundSocketEvents = true
    socket.addEventListener('message', onSocketMessage)
  }

  // Ensure default object exists locally before first network payload.
  synchronize('sharedState', createDefaultSharedState())
  return socket
}

export function setGlobal(name, value) {
  setSynchronized(name, value)
}

export function broadcastGlobal(name, value) {
  const nextValue = typeof value === 'undefined' ? synchronize(name) : value
  if (typeof nextValue === 'undefined') return
  broadcastGlobalValue(name, nextValue)
}

export function updateLocalPlayer(update) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  const selfId = playerState.selfId
  const currentPlayer = selfId ? playerState.players[selfId] : null
  if (selfId && currentPlayer && update && typeof update === 'object') {
    playerState.players[selfId] = {
      ...currentPlayer,
      ...clone(update),
    }
    notifyStateSubscribers()
  }
  socket.send(
    JSON.stringify({
      type: 'player:update',
      value: update,
    })
  )
}

export { synchronize }

export function subscribeState(callback) {
  stateSubscribers.add(callback)
  return () => stateSubscribers.delete(callback)
}

export function getSnapshot() {
  return clone(playerState)
}
