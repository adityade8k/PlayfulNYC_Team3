// ============================================================
//  zones.js  —  src/components/needs/zones.js
//  Invisible trigger zones that activate player needs.
//  Each zone is a box in world space. When the player's head
//  position is inside a box, that need starts filling.
// ============================================================
import * as THREE from 'three'

// ── Zone layout ───────────────────────────────────────────────
// Positions are in world space. Adjust these once you have the
// real apartment geometry. For now, one zone per corner.
//
// The floor plane in this project is at FLOOR_Y = -1.
// The 8x8 floor goes from -4 to +4 on X and Z.
// Corners are at roughly ±3 on X and Z.

const ZONE_DEFINITIONS = [
  {
    key:      'hunger',      // must match a need key in PlayerNeedsSystem
    label:    'Kitchen',
    position: new THREE.Vector3(-3,  0, -3),   // back-left corner
    size:     new THREE.Vector3( 1.5, 2.5, 1.5),
    color:    0xffaa00,      // orange — visible debug mesh
  },
  {
    key:      'poop',
    label:    'Toilet',
    position: new THREE.Vector3( 3,  0, -3),   // back-right corner
    size:     new THREE.Vector3( 1.5, 2.5, 1.5),
    color:    0x8B4513,      // brown
  },
  {
    key:      'shower',
    label:    'Shower',
    position: new THREE.Vector3( 3,  0,  3),   // front-right corner
    size:     new THREE.Vector3( 1.5, 2.5, 1.5),
    color:    0x00aaff,      // blue
  },
  {
    key:      'sleep',
    label:    'Bed',
    position: new THREE.Vector3(-3,  0,  3),   // front-left corner
    size:     new THREE.Vector3( 1.5, 2.5, 1.5),
    color:    0x9b59b6,      // purple
  },
]

// ── ZoneSystem ────────────────────────────────────────────────

export class ZoneSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {boolean} options.debug  - show colored wireframe boxes (default true)
   */
  constructor(scene, { debug = true } = {}) {
    this.scene = scene
    this.zones = []
    this.debug = debug

    // Track which zone each player is currently in
    // key = playerId, value = zone key or null
    this._playerActiveZone = {}

    this._buildZones()
  }

  // ── Setup ─────────────────────────────────────────────────

  _buildZones() {
    for (const def of ZONE_DEFINITIONS) {
      const box = new THREE.Box3()
      const half = def.size.clone().multiplyScalar(0.5)
      box.min.copy(def.position).sub(half)
      box.max.copy(def.position).add(half)

      this.zones.push({ ...def, box })

      if (this.debug) {
        // Wireframe box so you can see the zones during development
        const helper = new THREE.Box3Helper(box, def.color)
        this.scene.add(helper)

        // Floating label (uses a sprite so it faces the camera)
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 64
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = `#${def.color.toString(16).padStart(6, '0')}`
        ctx.font = 'bold 32px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(def.label, 128, 44)
        const texture = new THREE.CanvasTexture(canvas)
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, transparent: true })
        )
        sprite.position.copy(def.position)
        sprite.position.y += def.size.y * 0.5 + 0.2
        sprite.scale.set(1.2, 0.3, 1)
        this.scene.add(sprite)
      }
    }
  }

  // ── Per-frame update ──────────────────────────────────────
  /**
   * Call this every frame from your animation loop.
   *
   * @param {object} players          - snapshot.players from multiplayer
   * @param {string} selfId           - snapshot.selfId
   * @param {THREE.Vector3|null} localBodyPosition - local player world position
   * @param {object} playerNeedsSession - your PlayerNeedsSession instance
   */
  update(players, selfId, localBodyPosition, playerNeedsSession) {
    if (!players) return

    for (const [playerId, playerData] of Object.entries(players)) {
      // Use local body position for self (more accurate),
      // networked position for the remote player
      let position
      if (playerId === selfId && localBodyPosition) {
        position = localBodyPosition
      } else if (Array.isArray(playerData.position)) {
        position = new THREE.Vector3(...playerData.position)
      } else {
        continue
      }

      // Map server slot to our player keys
      // slot 0 = player_1 (left spawn), slot 1 = player_2 (right spawn)
      const needsPlayerId = playerData.slotIndex === 0 ? 'player_1' : 'player_2'
      const playerNeeds = playerNeedsSession.getPlayer(needsPlayerId)
      if (!playerNeeds) continue

      // Check which zone this player is in
      let currentZoneKey = null
      for (const zone of this.zones) {
        if (zone.box.containsPoint(position)) {
          currentZoneKey = zone.key
          break
        }
      }

      // Only call enterZone/exitZone when the zone actually changes
      const previousZoneKey = this._playerActiveZone[playerId] ?? null
      if (currentZoneKey !== previousZoneKey) {
        if (currentZoneKey) {
          playerNeeds.enterZone(currentZoneKey)
          console.log(`[zones] ${needsPlayerId} entered ${currentZoneKey}`)
        } else {
          playerNeeds.exitZone()
          console.log(`[zones] ${needsPlayerId} exited ${previousZoneKey}`)
        }
        this._playerActiveZone[playerId] = currentZoneKey
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  /** Hide all debug wireframes (call once apartment geometry is final) */
  hideDebug() {
    this.debug = false
  }

  /**
   * Reposition a zone by key — use this once you have real apartment coords.
   * @param {string} key        - 'hunger' | 'poop' | 'shower' | 'sleep'
   * @param {THREE.Vector3} newPosition
   * @param {THREE.Vector3} [newSize]
   */
  repositionZone(key, newPosition, newSize) {
    const zone = this.zones.find(z => z.key === key)
    if (!zone) return
    const size = newSize || zone.size
    const half = size.clone().multiplyScalar(0.5)
    zone.position.copy(newPosition)
    zone.size.copy(size)
    zone.box.min.copy(newPosition).sub(half)
    zone.box.max.copy(newPosition).add(half)
  }
}
