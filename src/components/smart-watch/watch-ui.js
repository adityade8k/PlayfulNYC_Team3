import { NEED_ORDER } from './state.js'

export const createWatchScreenCanvas = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const context = canvas.getContext('2d')

  const render = (state, elapsedMs = 0) => {
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

    drawStatusLine(context)
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
  } = {}
) => {
  const audio = new Audio(endpoint)
  audio.preload = 'auto'
  audio.playsInline = true
  let errorAdvanceTimer = null
  let startPromise = null
  let primed = false

  const clearTimer = () => {
    if (errorAdvanceTimer !== null) {
      window.clearTimeout(errorAdvanceTimer)
      errorAdvanceTimer = null
    }
  }

  const advanceToStats = () => {
    clearTimer()
    store.setCallState({ speaking: false, finished: true })
    store.setScreen('stats')
    onStatus('Landlord intro finished. Stats screen is live.')
  }

  const setError = (message) => {
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

  audio.addEventListener('canplaythrough', () => {
    store.setCallState({ audioReady: true })
    onStatus('Landlord audio buffered.')
  })
  audio.addEventListener('playing', () => {
    clearTimer()
    store.setCallState({ speaking: true, error: null })
    onStatus('Landlord call started.')
  })
  audio.addEventListener('ended', advanceToStats)
  audio.addEventListener('error', () => {
    setError('Audio could not be loaded from ElevenLabs.')
  })

  const primeAudio = () => {
    if (primed) return
    primed = true
    audio.load()
    fetch(endpoint, { cache: 'force-cache' }).catch(() => {})
  }

  const startCall = async () => {
    primeAudio()
    clearTimer()
    if (startPromise) return startPromise
    audio.pause()
    audio.currentTime = 0

    store.setScreen('incoming-call')
    store.setCallState({
      started: true,
      audioReady: false,
      speaking: false,
      finished: false,
      error: null,
    })

    startPromise = audio
      .play()
      .catch((error) => {
        setError(error instanceof Error ? error.message : 'Playback was blocked.')
      })
      .finally(() => {
        startPromise = null
      })

    return startPromise
  }

  return {
    primeAudio,
    startCall,
    replayCall: startCall,
    skipToStats: advanceToStats,
    dispose() {
      clearTimer()
      audio.pause()
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

const drawStatusLine = (context) => {
  context.textAlign = 'left'
  const now = new Date()
  const timeLabel = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const dayLabel = now
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
  const startY = 286
  const rowHeight = 194
  const barWidth = 308
  const barHeight = 54
  context.textAlign = 'left'

  NEED_ORDER.forEach((needKey, index) => {
    const need = state.needs[needKey]
    const needColor = getNeedColor(need.value)
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
