import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import express from 'express'
import { WebSocketServer } from 'ws'
import { registerLandlordCallRoute } from './smart-watch/landlord-call.js'
import {
  PLAYER_SPAWN_POINTS,
  createDefaultSharedState,
} from '../shared/default-state.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.resolve(projectRoot, 'dist')

const cliPort = Number(process.argv[2])
const portFromEnv = Number(process.env.PORT)
const PORT = Number.isFinite(portFromEnv) && portFromEnv > 0
  ? portFromEnv
  : Number.isFinite(cliPort) && cliPort > 0
    ? cliPort
    : 2026

const keyPath = process.env.HTTPS_KEY_PATH || process.env.SSL_KEY_PATH
const certPath = process.env.HTTPS_CERT_PATH || process.env.SSL_CERT_PATH

const app = express()

registerLandlordCallRoute(app, {
  envFiles: [path.resolve(projectRoot, '.env.local')],
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
} else {
  app.use((_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send(
        'Client build not found. Run "npm run build" first, then restart the LAN server.'
      )
  })
}

const createHttpServer = () => {
  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      protocol: 'https',
      server: https.createServer(
        {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
        app
      ),
    }
  }
  return {
    protocol: 'http',
    server: http.createServer(app),
  }
}

const { protocol, server } = createHttpServer()
const wss = new WebSocketServer({ server })

const clients = new Map()
const slotOwners = new Array(PLAYER_SPAWN_POINTS.length).fill(null)
let connectionCounter = 0
const globals = {
  sharedState: createDefaultSharedState(),
  // Example shared object used as a reference sync pattern.
  ballInfo: { rgb: 'red', xyz: [0, 1.5, 0] },
}

const assignSpawnSlot = (clientId) => {
  // Deterministic two-player spawn mapping: first -> left, second -> right.
  const freeIndex = slotOwners.findIndex((owner) => owner === null)
  const slotIndex = freeIndex === -1 ? PLAYER_SPAWN_POINTS.length - 1 : freeIndex
  slotOwners[slotIndex] = clientId
  return slotIndex
}

const releaseSpawnSlot = (clientId) => {
  const slotIndex = slotOwners.findIndex((owner) => owner === clientId)
  if (slotIndex !== -1) slotOwners[slotIndex] = null
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const toPlayersObject = () => {
  const players = {}
  for (const [id, client] of clients.entries()) {
    players[id] = clone(client.player)
  }
  return players
}

const sendJson = (ws, payload) => {
  if (ws.readyState !== 1) return
  ws.send(JSON.stringify(payload))
}

const broadcastJson = (payload, exceptId = null) => {
  const serialized = JSON.stringify(payload)
  for (const [clientId, client] of clients.entries()) {
    if (exceptId && clientId === exceptId) continue
    if (client.ws.readyState !== 1) continue
    client.ws.send(serialized)
  }
}

wss.on('connection', (ws) => {
  const id = randomUUID()
  connectionCounter += 1
  const connectionOrder = connectionCounter
  const slotIndex = assignSpawnSlot(id)
  const spawnPosition = PLAYER_SPAWN_POINTS[slotIndex]
  const spawnSide = slotIndex === 0 ? 'left' : 'right'

  const player = {
    id,
    connectionOrder,
    slotIndex,
    spawnPosition: clone(spawnPosition),
    position: clone(spawnPosition),
    rotationY: 0,
    isInAr: false,
  }

  clients.set(id, { ws, player })

  console.log(
    `[connect] #${connectionOrder} ${id} assigned ${spawnSide} spawn (slot=${slotIndex}, position=${spawnPosition.join(',')})`
  )

  sendJson(ws, {
    type: 'welcome',
    selfId: id,
    players: toPlayersObject(),
    globals: clone(globals),
  })

  // Join/leave and player updates are broadcast so all clients stay in sync.
  broadcastJson(
    {
      type: 'player-join',
      id,
      player: clone(player),
    },
    id
  )

  ws.on('message', (message) => {
    let payload
    try {
      payload = JSON.parse(message.toString())
    } catch {
      return
    }
    if (!payload || typeof payload !== 'object') return

    if (typeof payload.global === 'string') {
      globals[payload.global] = clone(payload.value)
      // Global shared values are relayed to all other clients.
      broadcastJson(
        {
          type: 'global-update',
          global: payload.global,
          value: clone(payload.value),
        },
        id
      )
      return
    }

    if (payload.type === 'player:update' && payload.value && typeof payload.value === 'object') {
      const client = clients.get(id)
      if (!client) return
      const incoming = payload.value
      if (Array.isArray(incoming.position) && incoming.position.length === 3) {
        client.player.position = clone(incoming.position)
      }
      if (typeof incoming.rotationY === 'number' && Number.isFinite(incoming.rotationY)) {
        client.player.rotationY = incoming.rotationY
      }
      if (typeof incoming.isInAr === 'boolean') {
        client.player.isInAr = incoming.isInAr
      }
      broadcastJson(
        {
          type: 'player-update',
          id,
          player: clone(client.player),
        },
        id
      )
      return
    }

    // Generic JSON relay path for additional realtime state channels.
    broadcastJson(payload, id)
  })

  ws.on('close', () => {
    clients.delete(id)
    releaseSpawnSlot(id)
    console.log(`[disconnect] ${id}`)
    broadcastJson({
      type: 'player-leave',
      id,
    })
  })
})

const getLanIpHint = () => {
  const interfaces = os.networkInterfaces()
  for (const network of Object.values(interfaces)) {
    if (!network) continue
    for (const detail of network) {
      if (detail.family === 'IPv4' && !detail.internal) {
        return detail.address
      }
    }
  }
  return '<your-ip>'
}

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIpHint()
  console.log(`[server] ${protocol.toUpperCase()} + WebSocket listening on 0.0.0.0:${PORT}`)
  console.log(`[server] localhost: ${protocol}://localhost:${PORT}`)
  console.log(`[server] LAN hint: ${protocol}://${lanIp}:${PORT}`)
})
