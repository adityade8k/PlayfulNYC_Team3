export const GAME_CONFIG = {
  environmentModel: {
    position: [0, 0, 0],
    rotation: [0, -Math.PI / 2, 0],
    scale: [0.852, 0.852, 0.852],
  },
  switches: [
    {
      "id": "switch-kitchen",
      "stateName": "kitchen",
      "position": [
        -0.1,
        0.9,
        -0.4
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.16,
        0.16,
        0.16
      ]
    },
    {
      "id": "switch-toilet",
      "stateName": "toilet",
      "position": [
        -0.36,
        0.9,
        -0.5
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.16,
        0.16,
        0.16
      ]
    },
    {
      "id": "switch-bed1",
      "stateName": "bed1",
      "position": [
        1,
        0.9,
        -0.35
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.16,
        0.16,
        0.16
      ]
    },
    {
      "id": "switch-bed2",
      "stateName": "bed2",
      "position": [
        1,
        0.9,
        0.1
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.16,
        0.16,
        0.16
      ]
    },
    {
      "id": "switch-shower",
      "stateName": "shower",
      "position": [
        0.72,
        0.9,
        -0.5
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.16,
        0.16,
        0.16
      ]
    }
  ],
  zones: [
    {
      "id": "zone_1",
      "position": [
        -0.5,
        0.8,
        -0.2
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.9,
        2,
        0.9
      ]
    },
    {
      "id": "zone_2",
      "position": [
        0.6,
        0.8,
        -0.2
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.9,
        2,
        0.9
      ]
    },
    {
      "id": "zone_3",
      "position": [
        0.6,
        0.8,
        0.7
      ],
      "rotation": [
        0,
        0,
        0
      ],
      "scale": [
        0.9,
        2,
        0.9
      ]
    }
  ],
  playerVisual: {
    capsule: {
      bodyRadius: 0.14,
      bodyLength: 0.65,
      headRadius: 0.11,
      color: '#71d8ff',
    },
  },
  watchOffsets: {
    xr: {
      scale: 0.095,
      position: [0.016, 0.03, -0.004],
      rotation: [Math.PI / 2, Math.PI, -1.18],
    },
    preview: {
      anchorPosition: [-0.12, -0.03, -0.38],
      anchorRotation: [0.06, -0.04, -0.46],
      scale: 0.22,
      position: [0, 0, 0],
      rotation: [0.25, 0.12, -0.28],
    },
  },
  watchUi: {
    // Multiplies the whole watch model scale in XR + preview.
    worldScaleMultiplier: 1.25,
    // Zooms all canvas-drawn watch UI elements uniformly.
    canvasScale: 1.12,
  },
  round: {
    durationSeconds: 180,
    poseBroadcastHz: 20,
    introFallbackDelaySeconds: 0,
    skipIntroCallAndShowStats: false,
  },
  debug: {
    zonesVisible: false,
    enableEnvironmentAnimationTest: false,
    camera: {
      enabled: true,
      position: [3, 2.0, 0],
      lookAt: [0, 0, 0],
      minDistance: 0.4,
      maxDistance: 8.0,
    },
  },
}

export const ROUND_PHASES = Object.freeze({
  boot: 'boot',
  calibrating: 'calibrating',
  waitingForBothPlayers: 'waiting-for-both-players',
  introCall: 'intro-call',
  playing: 'playing',
  outcomeCall: 'outcome-call',
  resetting: 'resetting',
})

export const ZONE_IDS = GAME_CONFIG.zones.map((zone) => zone.id)
export const SWITCH_STATE_NAMES = GAME_CONFIG.switches.map((entry) => entry.stateName)

export const createDefaultRoundState = () => ({
  phase: ROUND_PHASES.boot,
  zoneOccupancy: Object.fromEntries(ZONE_IDS.map((zoneId) => [zoneId, null])),
  spawnSelection: {
    leftTaken: false,
    rightTaken: false,
    playerSides: {},
  },
  needsSummary: null,
  version: 0,
})
