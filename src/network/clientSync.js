const globalCache = {}
const globalSubscribers = new Map()

let socket = null
let hasSocketListeners = false
const pendingMessages = []

const clone = (value) => JSON.parse(JSON.stringify(value))
const DEFAULT_MULTIPLAYER_PORT = '2026'

const toWebSocketUrl = (value, fallbackProtocol) => {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`
  if (value.startsWith('/')) return `${fallbackProtocol}${window.location.host}${value}`
  return `${fallbackProtocol}${value}`
}

const resolveSocketUrl = () => {
  const fallbackProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
  const wsUrlFromEnv = toWebSocketUrl(import.meta.env.VITE_WS_URL, fallbackProtocol)
  if (wsUrlFromEnv) return wsUrlFromEnv

  // During local dev, Vite runs on :5173 and the multiplayer server runs on :2026.
  if (window.location.port === '5173') {
    return `${fallbackProtocol}${window.location.hostname}:${DEFAULT_MULTIPLAYER_PORT}`
  }

  return `${fallbackProtocol}${window.location.host}`
}

const notifyGlobalSubscribers = (name) => {
  const subscribers = globalSubscribers.get(name)
  if (!subscribers) return
  const nextValue = globalCache[name]
  for (const handler of subscribers) {
    handler(nextValue)
  }
}

const applyGlobalUpdate = (name, value) => {
  globalCache[name] = clone(value)
  notifyGlobalSubscribers(name)
}

const flushPendingMessages = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  while (pendingMessages.length > 0) {
    socket.send(pendingMessages.shift())
  }
}

const sendPayload = (payload) => {
  const serialized = JSON.stringify(payload)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(serialized)
    return
  }
  pendingMessages.push(serialized)
}

const handleIncomingMessage = (rawPayload) => {
  if (!rawPayload || typeof rawPayload !== 'object') return

  if (typeof rawPayload.global === 'string') {
    applyGlobalUpdate(rawPayload.global, rawPayload.value)
    return
  }

  if (rawPayload.type === 'global-update' && typeof rawPayload.global === 'string') {
    applyGlobalUpdate(rawPayload.global, rawPayload.value)
    return
  }

  if (
    (rawPayload.type === 'snapshot' || rawPayload.type === 'welcome') &&
    rawPayload.globals &&
    typeof rawPayload.globals === 'object'
  ) {
    for (const [name, value] of Object.entries(rawPayload.globals)) {
      applyGlobalUpdate(name, value)
    }
  }
}

export function connectSocket() {
  if (socket) return socket

  const socketUrl = resolveSocketUrl()
  socket = new WebSocket(socketUrl)

  if (!hasSocketListeners) {
    hasSocketListeners = true

    socket.addEventListener('open', () => {
      console.log(`[clientSync] socket connected: ${socketUrl}`)
      flushPendingMessages()
    })

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data)
        handleIncomingMessage(payload)
      } catch (error) {
        console.warn('[clientSync] Ignoring non-JSON socket payload.', error)
      }
    })

    socket.addEventListener('close', () => {
      hasSocketListeners = false
      socket = null
    })
  }

  return socket
}

export function broadcastGlobal(name, value) {
  if (typeof name !== 'string' || name.length === 0) return
  if (typeof value === 'undefined') return

  // Optimistic local apply keeps local rendering responsive.
  applyGlobalUpdate(name, value)
  sendPayload({
    global: name,
    value,
  })
}

export function setSynchronized(name, value) {
  if (typeof name !== 'string' || name.length === 0) return
  if (typeof value === 'undefined') return
  applyGlobalUpdate(name, value)
}

export function subscribeGlobal(name, handler) {
  if (typeof name !== 'string' || typeof handler !== 'function') {
    return () => {}
  }
  if (!globalSubscribers.has(name)) {
    globalSubscribers.set(name, new Set())
  }
  const subscribers = globalSubscribers.get(name)
  subscribers.add(handler)
  return () => {
    subscribers.delete(handler)
    if (subscribers.size === 0) {
      globalSubscribers.delete(name)
    }
  }
}

export function synchronize(name, initialValue) {
  if (typeof name !== 'string' || name.length === 0) return undefined
  if (!(name in globalCache) && typeof initialValue !== 'undefined') {
    globalCache[name] = clone(initialValue)
  }
  return globalCache[name]
}
