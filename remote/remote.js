/* EpiKodi phone remote (#1.3) - talks to main/remote.ts: state over SSE, commands over POST */
;(() => {
  'use strict'

  const $ = (id) => document.getElementById(id)
  const CATEGORY_LABELS = {
    film: '🎬 Film',
    music: '🎵 Musique',
    podcast: '🎙️ Podcast',
    stream: '📻 En direct',
    file: '📄 Fichier',
  }
  /** reconnecting for this long shows the "disconnected" screen with its button */
  const OFFLINE_AFTER_MS = 6000

  // the token came in the QR code link; the server keeps it in a cookie, so drop it from the
  // address bar (screenshots, sharing the page...)
  if (location.search.includes('token=')) history.replaceState(null, '', location.pathname)

  let state = null
  let receivedAt = 0
  let source = null
  let offlineTimer = null
  let isSeeking = false

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
    const total = Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }

  /** the server sends the position about once a second - fill the gaps while playing */
  function currentPosition() {
    if (!state) return 0
    const elapsed = state.isPlaying ? (Date.now() - receivedAt) / 1000 : 0
    const position = state.position + elapsed
    return state.duration ? Math.min(position, state.duration) : position
  }

  function setConnection(kind, text) {
    const badge = $('connection')
    badge.dataset.state = kind
    badge.textContent = text
  }

  function showOffline(title, text, canRetry) {
    $('offline-title').textContent = title
    $('offline-text').textContent = text
    $('reconnect').hidden = !canRetry
    $('offline').hidden = false
  }

  function showError(text) {
    const error = $('error')
    error.textContent = text
    error.hidden = !text
  }

  function renderProgress() {
    const hasMedia = Boolean(state && state.title)
    const live = hasMedia && state.duration === null && state.category === 'stream'
    const seek = $('seek')
    const canSeek = hasMedia && state.duration !== null
    seek.disabled = !canSeek
    $('back').disabled = !canSeek
    $('forward').disabled = !canSeek
    if (canSeek) seek.max = String(Math.floor(state.duration))
    if (!isSeeking) {
      const position = currentPosition()
      seek.value = String(Math.floor(position))
      $('position').textContent = formatTime(position)
    }
    seek.style.setProperty(
      '--fill',
      canSeek && state.duration > 0 ? `${(Number(seek.value) / state.duration) * 100}%` : '0%',
    )
    $('duration').textContent = live ? '● En direct' : formatTime(hasMedia ? state.duration : 0)
    $('duration').classList.toggle('is-live', live)
  }

  function render() {
    const hasMedia = Boolean(state && state.title)
    document.body.classList.toggle('has-media', hasMedia)
    $('title').textContent = hasMedia ? state.title : 'Rien en lecture'
    $('subtitle').textContent = hasMedia
      ? state.subtitle || ''
      : 'Lance un film, un morceau ou une radio sur EpiKodi.'
    const category = $('category')
    category.hidden = !hasMedia || !CATEGORY_LABELS[state.category]
    category.textContent = hasMedia ? CATEGORY_LABELS[state.category] || '' : ''
    $('resume').hidden = !(hasMedia && state.awaitsResume)

    const play = $('play')
    const playing = hasMedia && state.isPlaying
    play.textContent = playing ? '⏸' : '▶'
    play.setAttribute('aria-label', playing ? 'Pause' : 'Lecture')
    play.disabled = !hasMedia
    $('previous').disabled = !(hasMedia && state.hasPrevious)
    $('next').disabled = !(hasMedia && state.hasNext)
    $('mute').disabled = !hasMedia
    $('volume').disabled = !hasMedia

    const muted = hasMedia && (state.muted || state.volume === 0)
    $('mute').textContent = muted ? '🔇' : '🔊'
    $('mute').setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son')
    if (hasMedia && document.activeElement !== $('volume')) {
      $('volume').value = String(Math.round((state.muted ? 0 : state.volume) * 100))
    }
    $('volume').style.setProperty('--fill', `${$('volume').value}%`)
    renderProgress()
  }

  async function send(command) {
    if (navigator.vibrate) navigator.vibrate(8)
    try {
      const response = await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      })
      if (response.status === 401) return handleExpired()
      showError(response.ok ? '' : await response.text())
    } catch {
      showError('Commande non envoyee : EpiKodi injoignable.')
    }
  }

  function handleExpired() {
    if (source) source.close()
    setConnection('offline', 'Deconnecte')
    showOffline(
      'Code expire',
      "La telecommande a ete desactivee ou reactivee sur EpiKodi. Rescanne le QR code affiche dans les Reglages d'EpiKodi.",
      false,
    )
  }

  /** EventSource doesn't say why it failed: ask the server whether the token still works */
  async function diagnose() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' })
      if (response.status === 401) return handleExpired()
    } catch {
      // network down or server stopped: handled below
    }
    setConnection('offline', 'Deconnecte')
    showOffline(
      'Deconnecte',
      'EpiKodi ne repond plus. Verifie que la telecommande est toujours active et que ton telephone est sur le meme Wi-Fi que le PC.',
      true,
    )
  }

  function connect() {
    if (source) source.close()
    clearTimeout(offlineTimer)
    setConnection('connecting', 'Connexion…')
    source = new EventSource('/api/events')

    source.addEventListener('open', () => {
      clearTimeout(offlineTimer)
      offlineTimer = null
      setConnection('online', 'Connecte')
      $('offline').hidden = true
      showError('')
    })

    source.addEventListener('state', (event) => {
      state = JSON.parse(event.data)
      receivedAt = Date.now()
      render()
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        // refused by the server (expired token): EventSource gives up on its own
        void diagnose()
        return
      }
      // dropped: EventSource retries by itself, give it a few seconds before saying so -
      // the disconnected screen stays up (and its label) until a retry succeeds
      if (!$('offline').hidden) return
      setConnection('connecting', 'Reconnexion…')
      if (!offlineTimer) offlineTimer = setTimeout(() => void diagnose(), OFFLINE_AFTER_MS)
    })
  }

  $('play').addEventListener('click', () => void send({ type: 'togglePlay' }))
  $('back').addEventListener('click', () => void send({ type: 'seekBy', seconds: -10 }))
  $('forward').addEventListener('click', () => void send({ type: 'seekBy', seconds: 10 }))
  $('mute').addEventListener('click', () => void send({ type: 'toggleMute' }))
  $('previous').addEventListener('click', () => void send({ type: 'previous' }))
  $('next').addEventListener('click', () => void send({ type: 'next' }))
  $('reconnect').addEventListener('click', connect)

  const seek = $('seek')
  seek.addEventListener('input', () => {
    isSeeking = true
    $('position').textContent = formatTime(Number(seek.value))
    renderProgress()
  })
  seek.addEventListener('change', () => {
    isSeeking = false
    void send({ type: 'seekTo', position: Number(seek.value) })
  })

  let volumeTimer = null
  $('volume').addEventListener('input', (event) => {
    const volume = Number(event.target.value) / 100
    event.target.style.setProperty('--fill', `${event.target.value}%`)
    clearTimeout(volumeTimer)
    // a slider fires dozens of events per second - one request every 120 ms is plenty
    volumeTimer = setTimeout(() => void send({ type: 'setVolume', volume }), 120)
  })

  // the phone locked or the tab was in the background: the stream may be stale
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      (!source || source.readyState !== EventSource.OPEN)
    ) {
      connect()
    }
  })

  setInterval(renderProgress, 250)
  render()
  connect()
})()
