const globalCache = {}
const globalSubscribers = new Map()

let socket = null
let hasSocketListeners = false
const pendingMessages = []

const clone = (value) => JSON.parse(JSON.stringify(value))

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

  // Keep socket origin in lockstep with the page URL for LAN/headset usage.
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
  socket = new WebSocket(`${protocol}${window.location.host}`)

  if (!hasSocketListeners) {
    hasSocketListeners = true

    socket.addEventListener('open', () => {
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
