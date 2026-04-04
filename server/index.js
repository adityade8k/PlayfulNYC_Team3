import { createServer } from 'node:http'
import { Server } from 'socket.io'
import {
  createDefaultSharedState,
  PLAYER_SPAWN_POINTS,
} from '../shared/default-state.js'

const PORT = process.env.PORT || 3001

const state = {
  sharedState: createDefaultSharedState(),
  players: {},
}

const slotOwners = new Array(PLAYER_SPAWN_POINTS.length).fill(null)

const assignSpawnSlot = (socketId) => {
  // Deterministic two-player mapping:
  // first player -> left slot (index 0), second -> right slot (index 1).
  const freeIndex = slotOwners.findIndex((owner) => owner === null)
  if (freeIndex === -1) return PLAYER_SPAWN_POINTS.length - 1
  slotOwners[freeIndex] = socketId
  return freeIndex
}

const releaseSpawnSlot = (socketId) => {
  const index = slotOwners.findIndex((owner) => owner === socketId)
  if (index !== -1) slotOwners[index] = null
}

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

io.on('connection', (socket) => {
  const slotIndex = assignSpawnSlot(socket.id)
  const spawnPosition = PLAYER_SPAWN_POINTS[slotIndex]
  const spawnSide = slotIndex === 0 ? 'left' : 'right'
  const playerName = socket.handshake.query.playerName || 'anonymous'

  state.players[socket.id] = {
    id: socket.id,
    name: String(playerName),
    slotIndex,
    position: [...spawnPosition],
    spawnPosition: [...spawnPosition],
    rotationY: 0,
    isInAr: false,
  }

  // Log deterministic connection/spawn assignment for quick multiplayer debugging.
  console.log(
    `[connect] ${socket.id} (${playerName}) assigned ${spawnSide} spawn (slot=${slotIndex}, position=${spawnPosition.join(',')})`
  )

  socket.emit('snapshot', { ...state, selfId: socket.id })
  io.emit('state:update', { players: state.players })

  socket.on('state:update', (incoming) => {
    if (!incoming || typeof incoming !== 'object') return
    if (!incoming.sharedState) return
    state.sharedState = incoming.sharedState
    io.emit('state:update', { sharedState: state.sharedState })
  })

  socket.on('player:update', (incoming) => {
    if (!incoming || typeof incoming !== 'object') return
    const player = state.players[socket.id]
    if (!player) return

    if (Array.isArray(incoming.position) && incoming.position.length === 3) {
      player.position = [...incoming.position]
    }
    if (typeof incoming.isInAr === 'boolean') {
      player.isInAr = incoming.isInAr
    }
    if (typeof incoming.rotationY === 'number' && Number.isFinite(incoming.rotationY)) {
      player.rotationY = incoming.rotationY
    }

    io.emit('state:update', { players: state.players })
  })

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`)
    delete state.players[socket.id]
    releaseSpawnSlot(socket.id)
    io.emit('state:update', { players: state.players })
  })
})

httpServer.listen(PORT, () => {
  console.log(`Multiplayer server running on http://localhost:${PORT}`)
})
