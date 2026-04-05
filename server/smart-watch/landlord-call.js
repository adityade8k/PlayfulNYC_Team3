import fs from 'node:fs'

const DEFAULT_INTRO_SCRIPT =
  "Hello, welcome to New York! and welcome to your potentially new apartment and new roommate. It's really nice one right? I'm also a nice guy and would love you guys to get along with each other, so I'm giving you two a free 1 day 1 night stay at this apartment to figure out if you all will be good compatibility. Just make sure that you satisfy all your needs, always make sure your physical and mental well being is good, especially in a stressful city as New York! But, I want to also see how you respect your other roommates wellbeing. Work amongst yourself. Ok i'll leave you all to your own privacy, i may check in on you guys from time to time and you can check your stats on your wristband. See yall tomorrow!"

const DEFAULT_PASS_THRESHOLD = 70
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const NEED_KEYS = ['hunger', 'poop', 'shower', 'sleep']

const KNOWN_FALLBACKS = [
  'pNInz6obpgDQGcFmaJgB',
  'ErXwobaYiN019PkySvjV',
  '21m00Tcm4TlvDq8ikWAM',
]

export const registerLandlordCallRoute = (
  app,
  {
    routePath = '/api/landlord-call',
    script = DEFAULT_INTRO_SCRIPT,
    envFiles = [],
    modelId = 'eleven_flash_v2_5',
    geminiModel = DEFAULT_GEMINI_MODEL,
  } = {}
) => {
  for (const envFile of envFiles) loadEnvFile(envFile)
  const resolvedModelId = process.env.ELEVENLABS_MODEL_ID || modelId
  const resolvedGeminiModel =
    process.env.GEMINI_MODEL_ID || process.env.GEMINI_MODEL || geminiModel

  let introAudioBuffer = null
  let inflightIntro = null
  const allowOrigin = process.env.LANDLORD_CALL_ALLOW_ORIGIN?.trim() || null
  const requestTimeoutMs = toPositiveInteger(
    process.env.LANDLORD_CALL_REQUEST_TIMEOUT_MS,
    15000
  )
  const passThreshold = clampPercent(
    process.env.ROOMMATE_TEST_PASS_THRESHOLD,
    DEFAULT_PASS_THRESHOLD
  )

  const applyCorsHeaders = (res) => {
    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
      if (introAudioBuffer) {
        res.setHeader('Content-Type', 'audio/mpeg')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.send(introAudioBuffer)
        return
      }

      if (!inflightIntro) {
        inflightIntro = synthesizeLandlordAudio({
          script,
          modelId: resolvedModelId,
          timeoutMs: requestTimeoutMs,
        })
          .then((buffer) => {
            introAudioBuffer = buffer
            return buffer
          })
          .finally(() => {
            inflightIntro = null
          })
      }

      const audio = await inflightIntro
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.send(audio)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to synthesize landlord onboarding audio.'
      console.error('[smart-watch][landlord-call] intro request failed:', message)
      applyCorsHeaders(res)
      res.status(500).json({
        error: 'Unable to generate landlord onboarding audio right now.',
      })
    }
  })

  app.post(routePath, async (req, res) => {
    try {
      applyCorsHeaders(res)
      const summaries = normalizeSummaries(req.body?.summaries)
      if (summaries.length === 0) {
        res.status(400).json({
          error: 'Expected at least one player summary in `summaries`.',
        })
        return
      }

      const outcome = evaluateCompatibility(summaries, passThreshold)
      const outcomeScript = await buildOutcomeScript({
        ...outcome,
        passThreshold,
        geminiModel: resolvedGeminiModel,
        timeoutMs: requestTimeoutMs,
      })
      const audio = await synthesizeLandlordAudio({
        script: outcomeScript,
        modelId: resolvedModelId,
        timeoutMs: requestTimeoutMs,
      })

      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Cache-Control', 'no-store')
      res.send(audio)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to synthesize landlord outcome audio.'
      console.error('[smart-watch][landlord-call] outcome request failed:', message)
      applyCorsHeaders(res)
      res.status(500).json({
        error: 'Unable to generate landlord outcome audio right now.',
      })
    }
  })
}

const normalizeSummaries = (summaries) => {
  if (!Array.isArray(summaries)) return []

  return summaries
    .map((summary, index) => {
      const overallScore = clampPercent(summary?.overallScore, null)
      if (overallScore === null) return null

      const needScores = Object.fromEntries(
        NEED_KEYS.map((needKey) => [
          needKey,
          clampPercent(summary?.needScores?.[needKey], 0),
        ])
      )

      return {
        playerId:
          typeof summary?.playerId === 'string' && summary.playerId.trim().length > 0
            ? summary.playerId.trim()
            : `player_${index + 1}`,
        overallScore,
        needScores,
        totalShameEvents: toNonNegativeInteger(summary?.totalShameEvents, 0),
      }
    })
    .filter(Boolean)
}

const evaluateCompatibility = (summaries, passThreshold) => {
  const players = summaries.slice(0, 2)
  const hasTwoPlayers = players.length === 2
  const teamScore = players.length > 0
    ? Math.round(players.reduce((sum, player) => sum + player.overallScore, 0) / players.length)
    : 0
  const teamStars = scoreToStars(teamScore)
  const pass = hasTwoPlayers && players.every((player) => player.overallScore > passThreshold)
  return { pass, players, teamScore, teamStars }
}

const buildOutcomeScript = async ({
  pass,
  passThreshold,
  players,
  teamScore,
  teamStars,
  geminiModel,
  timeoutMs,
}) => {
  const templateLine = 'Hello hello my future tenants!'
  const deterministicReview = buildDeterministicReview(players)
  let reviewText = deterministicReview
  let reviewSource = 'deterministic'

  try {
    const geminiReview = await generateReviewWithGemini({
      pass,
      passThreshold,
      players,
      teamScore,
      teamStars,
      modelId: geminiModel,
      timeoutMs,
    })
    const cleanedGeminiReview = compactWhitespace(geminiReview)
    if (cleanedGeminiReview.length < 40) {
      throw new Error('Gemini review was too short.')
    }
    reviewText = cleanedGeminiReview
    reviewSource = 'gemini'
  } catch (error) {
    console.warn(
      '[smart-watch][landlord-call] Gemini review fallback:',
      error instanceof Error ? error.message : String(error)
    )
    reviewText = deterministicReview
  }

  console.log(
    '[smart-watch][landlord-call] outcome review source:',
    reviewSource
  )

  if (pass) {
    return compactWhitespace(
      `${templateLine} ${reviewText} ${buildStarToneLine(teamStars, pass)} So it seems like you two are a great match, respectful to each other. Congrats! I would love to have you as my tenants.`
    )
  }

  return compactWhitespace(
    `${templateLine} ${reviewText} ${buildStarToneLine(teamStars, pass)} Hmm.. I've been receiving some complaints. I don't think yall ready to rent this place right now. You can come back another time to see if i still have room in the future tho!`
  )
}

const generateReviewWithGemini = async ({
  pass,
  passThreshold,
  players,
  teamScore,
  teamStars,
  modelId,
  timeoutMs,
}) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY.')
  }

  const reviewPayload = players.map((player, index) => ({
    tenant: formatPlayerLabel(player.playerId, index),
    overallScore: player.overallScore,
    needScores: player.needScores,
    totalShameEvents: player.totalShameEvents,
  }))

  const prompt = [
    'Write ONLY the landlord verbal review section in plain text.',
    'Do not include greeting or final pass/fail verdict sentence.',
    'Address them as Tenant 1 and Tenant 2.',
    'Describe how each tenant did across hunger, bathroom, hygiene, and sleep.',
    'Use natural human language, not a score list.',
    'Do not mention any percentages, raw numbers, or overall score values.',
    'Avoid repetitive sentence patterns. Use conversational variation and different sentence openings.',
    'Condense the feedback: 3 to 5 sentences total.',
    'Include at least one positive note and one concern for each tenant.',
    'Match tone to star result: 3 stars very warm praise, 2 stars mixed but hopeful, 1 star concerned, 0 stars firm dissatisfaction.',
    `Decision context: pass=${pass}, threshold=${passThreshold}.`,
    `Team score=${teamScore}, team stars=${teamStars}.`,
    `Player stats JSON: ${JSON.stringify(reviewPayload)}`,
  ].join('\n')

  const response = await fetchWithTimeout(
    `${GEMINI_API_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: 'You are a New York landlord giving a spoken evaluation after a roommate compatibility trial.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 220,
        },
      }),
    },
    timeoutMs,
    'Gemini generateContent request'
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini request failed (${response.status}): ${errorText.slice(0, 220)}`)
  }

  const payload = await response.json()
  const text = extractGeminiText(payload)
  if (!text) throw new Error('Gemini response did not include text.')

  return compactWhitespace(text)
}

const extractGeminiText = (payload) => {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  const chunks = []

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim())
      }
    }
  }

  return chunks.join(' ').trim()
}

const buildDeterministicReview = (players) =>
  players
    .map((player, index) => {
      const label = formatPlayerLabel(player.playerId, index)
      const seed =
        hashText(`${label}:${player.needScores.hunger}:${player.needScores.poop}:${player.needScores.shower}:${player.needScores.sleep}`)
      const hunger = buildNeedObservation('hunger', player.needScores.hunger, seed + 1)
      const poop = buildNeedObservation('poop', player.needScores.poop, seed + 2)
      const shower = buildNeedObservation('shower', player.needScores.shower, seed + 3)
      const sleep = buildNeedObservation('sleep', player.needScores.sleep, seed + 4)
      return `${label}, ${hunger} ${poop} ${shower} ${sleep}`
    })
    .join(' ')

const formatPlayerLabel = (playerId, fallbackIndex = 0) => {
  const match = String(playerId || '').match(/(\d+)/)
  const tenantNumber = Number(match?.[1] || fallbackIndex + 1)
  return `Tenant ${Math.max(1, tenantNumber)}`
}

const buildNeedObservation = (needKey, score, seed = 0) => {
  const value = clampPercent(score, 0)

  if (needKey === 'hunger') {
    if (value < 20) return pickVariant([
      'it looked like you were running on empty and barely eating.',
      'I noticed you were skipping meals and running low on fuel.',
      'you seemed to go long stretches without food.'
    ], seed)
    if (value < 45) return pickVariant([
      'you ate here and there, but your meals were still inconsistent.',
      'your eating rhythm felt shaky, with a few missed meals.',
      'you were eating sometimes, but not enough to stay steady.'
    ], seed)
    if (value < 70) return pickVariant([
      'you were mostly okay on food, with a few rough patches.',
      'your meals were decent overall, though not fully consistent.',
      'I saw decent meal habits, but there is still room to tighten that up.'
    ], seed)
    return pickVariant([
      'you kept yourself well fed and energized.',
      'your meal routine looked healthy and consistent.',
      'you did a solid job staying nourished throughout.'
    ], seed)
  }

  if (needKey === 'poop') {
    if (value < 20) return pickVariant([
      'it seemed like you were holding your pee for too long and waiting too much.',
      'you looked uncomfortable at times, like bathroom breaks were being delayed.',
      'I could tell bathroom timing was a real struggle.'
    ], seed)
    if (value < 45) return pickVariant([
      'bathroom timing was rough, and that made things stressful.',
      'you had a few uncomfortable moments around bathroom breaks.',
      'you managed some breaks, but timing still felt off.'
    ], seed)
    if (value < 70) return pickVariant([
      'you handled bathroom breaks okay, with only a few stressful moments.',
      'you were mostly fine on bathroom timing, though not perfect.',
      'bathroom management was decent overall with minor misses.'
    ], seed)
    return pickVariant([
      'you handled bathroom breaks smoothly and stayed comfortable.',
      'your bathroom timing looked calm and consistent.',
      'you managed that side well without much stress.'
    ], seed)
  }

  if (needKey === 'shower') {
    if (value < 20) return pickVariant([
      'hygiene really slipped, and that can create tension in shared living.',
      'cleanliness dropped too low, which is tough in a shared apartment.',
      'your hygiene needed much more attention.'
    ], seed)
    if (value < 45) return pickVariant([
      'hygiene was inconsistent and needed more care.',
      'cleanliness was up and down, not quite stable.',
      'you kept up sometimes, but hygiene still fell behind.'
    ], seed)
    if (value < 70) return pickVariant([
      'you stayed fairly clean, though there is room to improve.',
      'hygiene looked decent overall, with a few misses.',
      'you were mostly fine on cleanliness but not fully consistent.'
    ], seed)
    return pickVariant([
      'you kept yourself clean and respectful of shared space.',
      'I liked how consistent you were with hygiene.',
      'your hygiene was solid and apartment-friendly.'
    ], seed)
  }

  if (value < 20) return pickVariant([
    'you looked seriously sleep-deprived and drained.',
    'rest was very low, and your energy seemed flat.',
    'you were running on fumes from lack of sleep.'
  ], seed)
  if (value < 45) return pickVariant([
    'sleep was limited, and fatigue probably hit your mood.',
    'you did not rest enough, and it showed in your pace.',
    'your sleep looked patchy, with noticeable fatigue.'
  ], seed)
  if (value < 70) return pickVariant([
    'you got some rest, but not quite enough to stay fully recharged.',
    'sleep was okay-ish, though it could be steadier.',
    'you rested a bit, but your energy could be better.'
  ], seed)
  return pickVariant([
    'you rested well and kept your energy steady.',
    'your sleep routine looked healthy and balanced.',
    'you kept your rest in a good place.'
  ], seed)
}

const buildStarToneLine = (teamStars, pass) => {
  if (teamStars >= 3) {
    return pass
      ? 'This felt mature, cooperative, and genuinely respectful.'
      : 'There were strong moments here, and with a little polish you can absolutely get this right.'
  }
  if (teamStars === 2) {
    return pass
      ? 'There is a good foundation here, even if a few habits still need tuning.'
      : 'I can see potential, but daily habits need to be steadier before I can feel confident.'
  }
  if (teamStars === 1) {
    return 'I saw effort, but the day-to-day rhythm still felt fragile and conflict-prone.'
  }
  return 'Right now the living dynamic feels unstable, and that is a real concern for a shared home.'
}

const scoreToStars = (teamScore) =>
  teamScore >= 80 ? 3
  : teamScore >= 50 ? 2
  : teamScore >= 25 ? 1
  : 0

const pickVariant = (options, seed = 0) => {
  const list = Array.isArray(options) ? options : []
  if (list.length === 0) return ''
  const index = Math.abs(seed) % list.length
  return list[index]
}

const hashText = (text) => {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0
  }
  return hash
}

const compactWhitespace = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()

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

const clampPercent = (rawValue, fallback) => {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

const toNonNegativeInteger = (rawValue, fallback) => {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}
