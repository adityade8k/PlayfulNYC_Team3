import * as THREE from 'three'
import { GAME_CONFIG } from '../../config/game-config.js'

const tempWorldPoint = new THREE.Vector3()
const tempLocalPoint = new THREE.Vector3()
const tempInverse = new THREE.Matrix4()
const ZONE_DEBUG_COLORS = Object.freeze({
  idle: '#6e7a88',
  inside: '#2f9bff',
  localUsing: '#00d56f',
  blocked: '#ff6d3a',
})

const getNeedsPlayerIdForSlot = (slotIndex) => {
  if (slotIndex === 0) return 'player_1'
  if (slotIndex === 1) return 'player_2'
  return null
}

export class ZoneSystem {
  constructor(scene, { debug = GAME_CONFIG.debug.zonesVisible, zones = GAME_CONFIG.zones } = {}) {
    this.scene = scene
    this.debugRoot = new THREE.Group()
    this.debugRoot.name = 'zone-debug-root'
    this.scene.add(this.debugRoot)
    this.zones = []
    this.debug = debug
    this.localPlayerZone = null
    this.playerZones = {
      player_1: null,
      player_2: null,
    }
    this._buildZones(zones)
  }

  _buildZones(zones) {
    for (let index = 0; index < zones.length; index += 1) {
      const definition = zones[index]
      const node = new THREE.Object3D()
      node.name = `zone-${definition.id}`
      node.position.fromArray(definition.position)
      node.rotation.fromArray(definition.rotation || [0, 0, 0])
      node.scale.fromArray(definition.scale)
      node.updateMatrixWorld(true)

      const zone = {
        id: definition.id,
        label: definition.label || definition.id,
        node,
        debugColor: definition.debugColor || '#ffffff',
        debugMesh: null,
      }
      this.zones.push(zone)
      if (this.debug) {
        this._createDebugMesh(zone)
      }
    }
  }

  _createDebugMesh(zone) {
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: zone.debugColor,
        transparent: true,
        opacity: 0.85,
      })
    )
    wire.position.copy(zone.node.position)
    wire.rotation.copy(zone.node.rotation)
    wire.scale.copy(zone.node.scale)
    this.debugRoot.add(wire)
    zone.debugMesh = wire
  }

  resolveZoneAtWorldPosition(worldPosition) {
    if (!worldPosition) return null
    tempWorldPoint.copy(worldPosition)
    for (let index = 0; index < this.zones.length; index += 1) {
      const zone = this.zones[index]
      zone.node.updateMatrixWorld(true)
      tempInverse.copy(zone.node.matrixWorld).invert()
      tempLocalPoint.copy(tempWorldPoint).applyMatrix4(tempInverse)
      if (
        Math.abs(tempLocalPoint.x) <= 0.5 &&
        Math.abs(tempLocalPoint.y) <= 0.5 &&
        Math.abs(tempLocalPoint.z) <= 0.5
      ) {
        return zone.id
      }
    }
    return null
  }

  update(players, selfId, localBodyPosition) {
    this.localPlayerZone = null
    this.playerZones.player_1 = null
    this.playerZones.player_2 = null
    if (!players || typeof players !== 'object') return this.getSnapshot()

    for (const [networkPlayerId, playerData] of Object.entries(players)) {
      const needsPlayerId = getNeedsPlayerIdForSlot(playerData?.slotIndex)
      if (!needsPlayerId) continue
      let position = null
      if (networkPlayerId === selfId && localBodyPosition) {
        position = localBodyPosition
      } else if (Array.isArray(playerData?.position) && playerData.position.length === 3) {
        position = tempWorldPoint.fromArray(playerData.position)
      }
      if (!position) continue
      const zoneId = this.resolveZoneAtWorldPosition(position)
      this.playerZones[needsPlayerId] = zoneId
      if (networkPlayerId === selfId) {
        this.localPlayerZone = zoneId
      }
    }
    return this.getSnapshot()
  }

  getSnapshot() {
    return {
      localPlayerZone: this.localPlayerZone,
      playerZones: { ...this.playerZones },
    }
  }

  getLocalPlayerZone() {
    return this.localPlayerZone
  }

  updateDebugVisuals({ localNeedsPlayerId = null, occupancy = {}, candidates = {} } = {}) {
    if (!this.debug) return
    const localCandidateZone = candidates?.[localNeedsPlayerId]?.zoneId || null

    for (let index = 0; index < this.zones.length; index += 1) {
      const zone = this.zones[index]
      const debugMesh = zone.debugMesh
      if (!debugMesh?.material) continue

      const occupant = occupancy?.[zone.id] || null
      const isInside = this.localPlayerZone === zone.id
      const isLocalUsing = occupant === localNeedsPlayerId && localCandidateZone === zone.id
      const isBlocked = Boolean(occupant && occupant !== localNeedsPlayerId)

      let color = ZONE_DEBUG_COLORS.idle
      let opacity = 0.55
      if (isInside) {
        color = ZONE_DEBUG_COLORS.inside
        opacity = 0.9
      }
      if (isBlocked) {
        color = ZONE_DEBUG_COLORS.blocked
        opacity = 1
      }
      if (isLocalUsing) {
        color = ZONE_DEBUG_COLORS.localUsing
        opacity = 1
      }

      debugMesh.material.color.set(color)
      debugMesh.material.opacity = opacity
    }
  }

  resetDebugVisuals() {
    if (!this.debug) return
    for (let index = 0; index < this.zones.length; index += 1) {
      const material = this.zones[index].debugMesh?.material
      if (!material) continue
      material.color.set(ZONE_DEBUG_COLORS.idle)
      material.opacity = 0.55
    }
  }

  setDebugVisible(visible) {
    this.debugRoot.visible = Boolean(visible)
  }

  setZoneTransform(zoneId, { position, rotation, scale } = {}) {
    const zone = this.zones.find((entry) => entry.id === zoneId)
    if (!zone) return false

    if (Array.isArray(position) && position.length === 3) {
      zone.node.position.fromArray(position)
    }
    if (Array.isArray(rotation) && rotation.length === 3) {
      zone.node.rotation.fromArray(rotation)
    }
    if (Array.isArray(scale) && scale.length === 3) {
      zone.node.scale.fromArray(scale)
    }
    zone.node.updateMatrixWorld(true)

    if (zone.debugMesh) {
      zone.debugMesh.position.copy(zone.node.position)
      zone.debugMesh.rotation.copy(zone.node.rotation)
      zone.debugMesh.scale.copy(zone.node.scale)
    }
    return true
  }

  getZoneTransforms() {
    return this.zones.map((zone) => ({
      id: zone.id,
      position: zone.node.position.toArray(),
      rotation: [zone.node.rotation.x, zone.node.rotation.y, zone.node.rotation.z],
      scale: zone.node.scale.toArray(),
    }))
  }

  dispose() {
    this.scene.remove(this.debugRoot)
  }
}
