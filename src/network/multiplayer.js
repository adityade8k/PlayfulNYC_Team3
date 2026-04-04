import { io } from 'socket.io-client'
import { createDefaultSharedState } from '../../shared/default-state.js'

const cachedGlobals = {
  sharedState: createDefaultSharedState(),
  players: {},
  selfId: null,
}

let socket = null
const subscribers = new Set()

const clone = (value) => JSON.parse(JSON.stringify(value))

const notifySubscribers = () => {
  const snapshot = getSnapshot()
  for (const callback of subscribers) {
    callback(snapshot)
  }
}

const applyIncoming = (incomingGlobals = {}) => {
  for (const [name, value] of Object.entries(incomingGlobals)) {
    cachedGlobals[name] = clone(value)
  }
  notifySubscribers()
}

export function connectMultiplayer({ roomId = 'default-room', playerName = 'anonymous' } = {}) {
  if (socket) return socket

  const serverUrl = import.meta.env.VITE_MULTIPLAYER_URL || 'http://localhost:3001'
  socket = io(serverUrl, {
    transports: ['websocket'],
    query: { roomId, playerName },
  })

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message)
  })

  socket.on('snapshot', (payload) => {
    applyIncoming(payload)
  })

  socket.on('state:update', (payload) => {
    applyIncoming(payload)
  })

  return socket
}

export function setGlobal(name, value) {
  cachedGlobals[name] = clone(value)
}

export function broadcastGlobal(name) {
  if (!socket) return
  socket.emit('state:update', {
    [name]: cachedGlobals[name],
  })
}

export function updateLocalPlayer(update) {
  if (!socket) return
  socket.emit('player:update', update)
}

export function synchronize(name) {
  return cachedGlobals[name]
}

export function subscribeState(callback) {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

export function getSnapshot() {
  return clone(cachedGlobals)
}
