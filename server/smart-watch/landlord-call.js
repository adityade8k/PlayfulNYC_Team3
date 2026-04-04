import fs from 'node:fs'

const DEFAULT_SCRIPT =
  "Hello, welcome to New York! and welcome to your potentially new apartment and new roommate. It's really nice one right? I'm also a nice guy and would love you guys to get along with each other, so I'm giving you two a free 1 day 1 night stay at this apartment to figure out if you all will be good compatibility. Just make sure that you satisfy all your needs, always make sure your physical and mental well being is good, especially in a stressful city as New York! But, I want to also see how you respect your other roommates wellbeing. Work amongst yourself. Ok i'll leave you all to your own privacy, i may check in on you guys from time to time and you can check your stats on your wristband. See yall tomorrow!"

const KNOWN_FALLBACKS = [
  'pNInz6obpgDQGcFmaJgB',
  'ErXwobaYiN019PkySvjV',
  '21m00Tcm4TlvDq8ikWAM',
]

export const registerLandlordCallRoute = (
  app,
  {
    routePath = '/api/landlord-call',
    script = DEFAULT_SCRIPT,
    envFiles = [],
    modelId = 'eleven_flash_v2_5',
  } = {}
) => {
  for (const envFile of envFiles) loadEnvFile(envFile)
  const resolvedModelId = process.env.ELEVENLABS_MODEL_ID || modelId

  let audioBuffer = null
  let inflight = null
  const allowOrigin = process.env.LANDLORD_CALL_ALLOW_ORIGIN?.trim() || null
  const requestTimeoutMs = toPositiveInteger(
    process.env.LANDLORD_CALL_REQUEST_TIMEOUT_MS,
    15000
  )

  const applyCorsHeaders = (res) => {
    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
      res.setHeader('Vary', 'Origin')
    }
  }

  app.options(routePath, (_req, res) => {
    applyCorsHeaders(res)
    res.status(204).end()
  })

  app.get(routePath, async (_req, res) => {
    try {
      applyCorsHeaders(res)
      if (audioBuffer) {
        res.setHeader('Content-Type', 'audio/mpeg')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.send(audioBuffer)
        return
      }

      if (!inflight) {
        inflight = synthesizeLandlordAudio({
          script,
          modelId: resolvedModelId,
          timeoutMs: requestTimeoutMs,
        })
          .then((buffer) => {
            audioBuffer = buffer
            return buffer
          })
          .finally(() => {
            inflight = null
          })
      }

      const audio = await inflight
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.send(audio)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to synthesize landlord onboarding audio.'
      console.error('[smart-watch][landlord-call] request failed:', message)
      applyCorsHeaders(res)
      res.status(500).json({
        error: 'Unable to generate landlord onboarding audio right now.',
      })
    }
  })
}

const loadEnvFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return
  const raw = fs.readFileSync(filePath, 'utf8')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

const synthesizeLandlordAudio = async ({ script, modelId, timeoutMs }) => {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID

  if (!apiKey || !configuredVoiceId) {
    throw new Error('Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID.')
  }

  const primary = await requestSpeech({
    apiKey,
    voiceId: configuredVoiceId,
    script,
    modelId,
    timeoutMs,
  })

  if (primary.ok) return Buffer.from(await primary.arrayBuffer())

  const primaryMessage = await primary.text()
  if (primary.status === 402 && primaryMessage.includes('paid_plan_required')) {
    const fallbacks = await getFallbackVoiceIds(apiKey, configuredVoiceId, timeoutMs)
    for (const fallbackVoiceId of fallbacks) {
      const fallback = await requestSpeech({
        apiKey,
        voiceId: fallbackVoiceId,
        script,
        modelId,
        timeoutMs,
      })
      if (fallback.ok) return Buffer.from(await fallback.arrayBuffer())
    }
    throw new Error(
      'Configured ElevenLabs voice requires a paid plan and no accessible fallback voice succeeded.'
    )
  }

  throw new Error(
    `ElevenLabs request failed (${primary.status}): ${primaryMessage.slice(0, 200)}`
  )
}

const requestSpeech = ({ apiKey, voiceId, script, modelId, timeoutMs }) =>
  fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: script,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          use_speaker_boost: true,
        },
      }),
    },
    timeoutMs,
    `ElevenLabs speech request for voice ${voiceId}`
  )

const getFallbackVoiceIds = async (apiKey, excludedVoiceId, timeoutMs) => {
  let response
  try {
    response = await fetchWithTimeout(
      'https://api.elevenlabs.io/v1/voices',
      {
        headers: {
          Accept: 'application/json',
          'xi-api-key': apiKey,
        },
      },
      timeoutMs,
      'ElevenLabs voice list request'
    )
  } catch {
    return KNOWN_FALLBACKS.filter((voiceId) => voiceId !== excludedVoiceId)
  }

  if (!response.ok) {
    return KNOWN_FALLBACKS.filter((voiceId) => voiceId !== excludedVoiceId)
  }

  const payload = await response.json()
  const voices = Array.isArray(payload?.voices) ? payload.voices : []

  const preferred = voices
    .filter(
      (voice) =>
        voice?.voice_id &&
        voice.voice_id !== excludedVoiceId &&
        (voice.category === 'premade' || voice.category === 'professional')
    )
    .map((voice) => voice.voice_id)

  const alternates = voices
    .filter((voice) => voice?.voice_id && voice.voice_id !== excludedVoiceId)
    .map((voice) => voice.voice_id)

  return [...new Set([...preferred, ...alternates, ...KNOWN_FALLBACKS])].filter(
    (voiceId) => voiceId !== excludedVoiceId
  )
}

const fetchWithTimeout = async (url, options, timeoutMs, context) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${context} timed out after ${timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const toPositiveInteger = (rawValue, fallback) => {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}
