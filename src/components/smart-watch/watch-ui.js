import { NEED_ORDER } from './state.js'

export const createWatchScreenCanvas = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const context = canvas.getContext('2d')

  const render = (state, elapsedMs = 0, watchClock = null) => {
    context.clearRect(0, 0, canvas.width, canvas.height)

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    background.addColorStop(0, '#386f7a')
    background.addColorStop(0.55, '#2c6170')
    background.addColorStop(1, '#234956')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)

    const vignette = context.createRadialGradient(
      canvas.width * 0.45,
      canvas.height * 0.22,
      40,
      canvas.width * 0.5,
      canvas.height * 0.45,
      840
    )
    vignette.addColorStop(0, 'rgba(255,255,255,0.08)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.22)')
    context.fillStyle = vignette
    context.fillRect(0, 0, canvas.width, canvas.height)

    drawStatusLine(context, watchClock)
    if (state.screen === 'incoming-call') {
      drawIncomingCall(context, state, elapsedMs)
    } else {
      drawStats(context, state)
    }
  }

  return { canvas, context, render }
}

export const createLandlordCallController = (
  store,
  {
    endpoint = '/api/landlord-call',
    autoAdvanceOnError = false,
    onStatus = () => {},
    onFinished = () => {},
  } = {}
) => {
  const audio = new Audio()
  audio.preload = 'auto'
  audio.playsInline = true
  audio.crossOrigin = 'anonymous'
  let errorAdvanceTimer = null
  let startPromise = null
  let primed = false
  let audioUnlocked = false
  let activeObjectUrl = null
  let activeCallKind = 'intro'

  const logAudio = (message, extra = null) => {
    if (extra) {
      console.log(`[smart-watch][audio] ${message}`, extra)
      return
    }
    console.log(`[smart-watch][audio] ${message}`)
  }

  const clearTimer = () => {
    if (errorAdvanceTimer !== null) {
      window.clearTimeout(errorAdvanceTimer)
      errorAdvanceTimer = null
    }
  }

  const revokeObjectUrl = () => {
    if (!activeObjectUrl) return
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = null
  }

  const setAudioSource = (sourceUrl) => {
    if (audio.src === sourceUrl) return
    audio.src = sourceUrl
    audio.load()
  }

  const advanceToStats = () => {
    clearTimer()
    logAudio('landlord call finished, switching to stats')
    store.setCallState({ speaking: false, finished: true })
    store.setScreen('stats')
    if (activeCallKind === 'outcome') {
      onStatus('Landlord outcome call finished.')
      return
    }
    onStatus('Landlord call finished.')
    onStatus('Landlord intro finished. Stats screen is live.')
    onFinished()
  }

  const setError = (message) => {
    logAudio('audio error', { message, networkState: audio.networkState, readyState: audio.readyState })
    store.setCallState({
      speaking: false,
      error: message,
      finished: false,
    })
    onStatus(message)

    if (autoAdvanceOnError) {
      errorAdvanceTimer = window.setTimeout(() => {
        advanceToStats()
      }, 1600)
    }
  }

  audio.addEventListener('loadstart', () => {
    logAudio('loadstart', { src: audio.src })
  })
  audio.addEventListener('loadedmetadata', () => {
    logAudio('loadedmetadata', { duration: audio.duration })
  })
  audio.addEventListener('canplay', () => {
    logAudio('canplay', { readyState: audio.readyState })
  })
  audio.addEventListener('canplaythrough', () => {
    logAudio('canplaythrough', { readyState: audio.readyState })
    store.setCallState({ audioReady: true })
    onStatus('Landlord audio buffered.')
  })
  audio.addEventListener('playing', () => {
    clearTimer()
    logAudio('playing', { currentTime: audio.currentTime })
    store.setCallState({ speaking: true, error: null })
    onStatus('Landlord call started.')
  })
  audio.addEventListener('pause', () => {
    logAudio('pause', { currentTime: audio.currentTime })
  })
  audio.addEventListener('ended', () => {
    logAudio('ended', { duration: audio.duration })
    advanceToStats()
  })
  audio.addEventListener('error', () => {
    setError('Audio could not be loaded from ElevenLabs.')
  })

  const primeAudio = () => {
    if (primed) return
    primed = true
    logAudio('priming audio', { endpoint })
    setAudioSource(endpoint)
    fetch(endpoint, { cache: 'force-cache' })
      .then((response) => {
        logAudio('prefetch response', {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
        })
      })
      .catch((error) => {
        logAudio('prefetch failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const playFromCurrentSource = async ({ screen = 'incoming-call' } = {}) => {
    clearTimer()
    if (startPromise) return startPromise
    audio.pause()
    audio.currentTime = 0
    logAudio('startCall invoked', {
      paused: audio.paused,
      readyState: audio.readyState,
      networkState: audio.networkState,
    })

    store.setScreen(screen)
    store.setCallState({
      started: true,
      audioReady: false,
      speaking: false,
      finished: false,
      error: null,
    })

    startPromise = audio
      .play()
      .then(() => {
        logAudio('play() resolved')
      })
      .catch((error) => {
        logAudio('play() rejected', {
          message: error instanceof Error ? error.message : String(error),
        })
        const isAutoplayBlock =
          error?.name === 'NotAllowedError' ||
          (typeof error?.message === 'string' &&
            error.message.toLowerCase().includes('user interaction'))
        setError(
          isAutoplayBlock
            ? 'Audio was blocked until user interaction. Switching to stats.'
            : error instanceof Error
              ? error.message
              : 'Playback was blocked.'
        )
      })
      .finally(() => {
        startPromise = null
      })

    return startPromise
  }

  const unlockAudio = async () => {
    primeAudio()
    if (audioUnlocked) {
      logAudio('unlockAudio skipped, already unlocked')
      return true
    }

    const previousMuted = audio.muted
    try {
      audio.muted = true
      audio.currentTime = 0
      logAudio('unlockAudio attempting silent play')
      await audio.play()
      audio.pause()
      audio.currentTime = 0
      audioUnlocked = true
      logAudio('unlockAudio succeeded')
      return true
    } catch (error) {
      logAudio('unlockAudio failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      audio.muted = previousMuted
    }
  }

  const startCall = async () => {
    activeCallKind = 'intro'
    primeAudio()
    revokeObjectUrl()
    setAudioSource(endpoint)
    return playFromCurrentSource({ screen: 'incoming-call' })
  }

  const startOutcomeCall = async (payload = {}) => {
    activeCallKind = 'outcome'
    clearTimer()
    revokeObjectUrl()
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      setError(
        error instanceof Error
          ? `Landlord follow-up call failed: ${error.message}`
          : 'Landlord follow-up call failed.'
      )
      return Promise.resolve()
    }

    if (!response.ok) {
      let failureMessage = `Landlord follow-up call failed (${response.status}).`
      try {
        const errorJson = await response.json()
        if (typeof errorJson?.error === 'string' && errorJson.error.trim()) {
          failureMessage = errorJson.error
        }
      } catch {
        // Keep generic failure message when response is not JSON.
      }
      setError(failureMessage)
      return Promise.resolve()
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const sourceBlob = await response.blob()
    const sourceBlobType = (sourceBlob.type || '').toLowerCase()
    const isAudioResponse =
      contentType.includes('audio') || sourceBlobType.startsWith('audio/')

    if (!isAudioResponse) {
      const bodyPreview = await sourceBlob
        .text()
        .then((text) => text.trim().slice(0, 180))
        .catch(() => '')
      const mimeLabel = contentType || sourceBlobType || 'unknown'
      setError(
        bodyPreview
          ? `Landlord follow-up call returned non-audio (${mimeLabel}): ${bodyPreview}`
          : `Landlord follow-up call returned non-audio (${mimeLabel}).`
      )
      return Promise.resolve()
    }

    const normalizedBlob = sourceBlobType.startsWith('audio/')
      ? sourceBlob
      : new Blob([await sourceBlob.arrayBuffer()], { type: 'audio/mpeg' })

    if (normalizedBlob.size === 0) {
      setError('Landlord follow-up call returned empty audio.')
      return Promise.resolve()
    }

    logAudio('outcome audio response', {
      status: response.status,
      contentType,
      blobType: normalizedBlob.type,
      size: normalizedBlob.size,
    })

    activeObjectUrl = URL.createObjectURL(normalizedBlob)
    setAudioSource(activeObjectUrl)
    return playFromCurrentSource({ screen: 'stats' })
  }

  return {
    primeAudio,
    unlockAudio,
    startCall,
    startOutcomeCall,
    replayCall: startCall,
    skipToStats: advanceToStats,
    dispose() {
      clearTimer()
      audio.pause()
      revokeObjectUrl()
    },
  }
}

export const describeWatchStatus = (state) => {
  if (state.screen === 'incoming-call') {
    if (!state.call.started) return 'Watch is waiting for the first call.'
    if (state.call.error) return state.call.error
    if (state.call.speaking) return 'Landlord is on the line, giving the move-in rundown.'
    if (state.call.audioReady) return 'Landlord audio is buffered and starting.'
    return 'Connecting the landlord call through ElevenLabs...'
  }

  return 'Stats are live on the watch and can be updated globally.'
}

const drawStatusLine = (context, watchClock = null) => {
  context.textAlign = 'left'
  const now = new Date()
  const timeLabel =
    typeof watchClock?.timeLabel === 'string'
      ? watchClock.timeLabel
      : now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const dayLabel =
    typeof watchClock?.dayLabel === 'string'
      ? watchClock.dayLabel
      : now
          .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
          .toUpperCase()

  context.fillStyle = 'rgba(255,255,255,0.92)'
  context.font = '600 56px "Avenir Next", sans-serif'
  context.fillText(timeLabel, 78, 110)
  context.font = '500 42px "Avenir Next", sans-serif'
  context.fillStyle = 'rgba(255,255,255,0.82)'
  context.fillText(dayLabel, 78, 164)

  const signalX = 840
  context.strokeStyle = 'rgba(255,255,255,0.75)'
  context.lineWidth = 10
  context.lineCap = 'round'
  for (let index = 0; index < 4; index += 1) {
    context.beginPath()
    context.moveTo(signalX + index * 26, 140)
    context.lineTo(signalX + index * 26, 140 - index * 16 - 12)
    context.stroke()
  }
}

const drawIncomingCall = (context, state, elapsedMs) => {
  const pulse = 0.74 + (Math.sin(elapsedMs * 0.0075) + 1) * 0.14
  context.textAlign = 'center'
  context.fillStyle = 'rgba(255,255,255,0.96)'
  context.font = '800 104px "Avenir Next", sans-serif'
  context.fillText('LANDLORD', 512, 410)
  context.font = '500 68px "Avenir Next", sans-serif'
  context.fillStyle = 'rgba(255,255,255,0.9)'
  context.fillText(state.call.speaking ? 'On Call...' : 'Incoming Call...', 512, 500)

  context.fillStyle = `rgba(101, 223, 125, ${pulse})`
  roundRect(context, 334, 712, 356, 126, 56)
  context.fill()

  context.fillStyle = '#ffffff'
  context.font = '700 88px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  context.fillText('\u260E', 512, 804)

  if (state.call.error) {
    context.fillStyle = 'rgba(255, 240, 210, 0.88)'
    context.font = '600 34px "Avenir Next", sans-serif'
    wrapText(context, state.call.error, 160, 610, 704, 40)
  }
}

const drawStats = (context, state) => {
  const columns = [86, 530]
  const hasSessionSummary = Boolean(state.sessionSummary)
  const summaryBottomY = hasSessionSummary
    ? drawTeamSummary(context, state.sessionSummary)
    : 0
  const startY = hasSessionSummary ? summaryBottomY + 82 : 286
  const rowHeight = 184
  const barWidth = 308
  const barHeight = 54
  context.textAlign = 'left'

  NEED_ORDER.forEach((needKey, index) => {
    const need = state.needs[needKey]
    const needColor = need.color || getNeedColor(need.value)
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = columns[column]
    const y = startY + row * rowHeight

    context.fillStyle = '#f5f8f9'
    context.font = '800 62px "Avenir Next", sans-serif'
    context.fillText(need.label.toUpperCase(), x, y)

    context.fillStyle = needColor
    context.beginPath()
    context.arc(x + 44, y + 68, 40, 0, Math.PI * 2)
    context.fill()

    context.font = '700 42px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
    context.textAlign = 'center'
    context.fillStyle = '#103a18'
    context.fillText(need.icon, x + 44, y + 84)
    context.textAlign = 'left'

    context.fillStyle = 'rgba(49, 113, 43, 0.82)'
    roundRect(context, x + 96, y + 40, barWidth, barHeight, 24)
    context.fill()

    const fillWidth = Math.max(30, (barWidth - 10) * (need.value / 100))
    const gradient = context.createLinearGradient(x + 96, y + 40, x + 96 + fillWidth, y + 40)
    gradient.addColorStop(0, shadeColor(needColor, 0.28))
    gradient.addColorStop(1, needColor)
    context.fillStyle = gradient
    roundRect(context, x + 101, y + 45, fillWidth, barHeight - 10, 19)
    context.fill()
  })
}

const drawTeamSummary = (context, sessionSummary) => {
  const x = 78
  const y = 198
  const width = 868
  const height = 164
  const teamScoreLabel =
    Number.isFinite(sessionSummary?.teamScore) ? `${sessionSummary.teamScore}%` : '--'
  const stars = Math.max(
    0,
    Math.min(3, Number.isFinite(sessionSummary?.teamStars) ? sessionSummary.teamStars : 0)
  )
  const tenantLines = Array.isArray(sessionSummary?.summaries)
    ? sessionSummary.summaries
        .slice(0, 2)
        .map((summary, index) =>
          `${formatTenantLabel(summary.playerId, index)}: ${summary.overallScore}%`
        )
    : []

  context.fillStyle = 'rgba(7, 27, 33, 0.32)'
  roundRect(context, x, y, width, height, 28)
  context.fill()

  context.fillStyle = 'rgba(255,255,255,0.95)'
  context.font = '700 34px "Avenir Next", sans-serif'
  context.fillText('Tenant Review', x + 34, y + 50)
  context.font = '900 66px "Avenir Next", sans-serif'
  context.fillText(teamScoreLabel, x + 32, y + 122)

  context.textAlign = 'right'
  context.font = '700 30px "Avenir Next", sans-serif'
  context.fillStyle = 'rgba(255,255,255,0.9)'
  context.fillText(starsToText(stars), x + width - 30, y + 50)

  if (tenantLines.length > 0) {
    context.font = '600 24px "Avenir Next", sans-serif'
    context.fillStyle = 'rgba(255,255,255,0.84)'
    context.fillText(tenantLines[0], x + width - 30, y + 94)
    if (tenantLines[1]) {
      context.fillText(tenantLines[1], x + width - 30, y + 128)
    }
  }

  context.textAlign = 'left'
  return y + height
}

const starsToText = (stars) => {
  const full = '\u2605'.repeat(stars)
  const empty = '\u2606'.repeat(Math.max(0, 3 - stars))
  return `${full}${empty}`
}

const formatTenantLabel = (playerId, fallbackIndex = 0) => {
  const match = String(playerId || '').match(/(\d+)/)
  const tenantNumber = Number(match?.[1] || fallbackIndex + 1)
  return `Tenant ${Math.max(1, tenantNumber)}`
}

const getNeedColor = (value) => {
  if (value < 25) return '#e14b4b'
  if (value < 50) return '#f0c541'
  if (value < 75) return '#8fe36a'
  return '#41c95b'
}

const wrapText = (context, text, x, y, maxWidth, lineHeight) => {
  const words = text.split(/\s+/)
  let line = ''
  let offsetY = 0

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x + maxWidth / 2, y + offsetY)
      line = word
      offsetY += lineHeight
      continue
    }
    line = candidate
  }

  if (line) context.fillText(line, x + maxWidth / 2, y + offsetY)
}

const roundRect = (context, x, y, width, height, radius) => {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

const shadeColor = (color, amount) => {
  const normalized = color.replace('#', '')
  const numeric = Number.parseInt(normalized, 16)
  const red = (numeric >> 16) & 0xff
  const green = (numeric >> 8) & 0xff
  const blue = numeric & 0xff
  const lighten = (value) => Math.min(255, Math.round(value + (255 - value) * amount))
  return `rgb(${lighten(red)}, ${lighten(green)}, ${lighten(blue)})`
}
