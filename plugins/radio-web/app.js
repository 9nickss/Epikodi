/* Radio web - example EpiKodi plugin. Everything goes through window.epikodi (epikodi-sdk.js). */
;(() => {
  const RADIO_BROWSER = 'https://de1.api.radio-browser.info/json/stations/search'
  const FAVORITES_KEY = 'favorites'

  const $ = (id) => document.getElementById(id)
  const status = $('status')
  let favorites = []
  let playingUrl = null

  function setStatus(text, isError = false) {
    status.textContent = text
    status.classList.toggle('is-error', isError)
  }

  function isFavorite(station) {
    return favorites.some((item) => item.url === station.url)
  }

  async function toggleFavorite(station) {
    favorites = isFavorite(station)
      ? favorites.filter((item) => item.url !== station.url)
      : [...favorites, station]
    await window.epikodi.storage.set(FAVORITES_KEY, favorites)
    renderAll()
  }

  async function play(station) {
    try {
      await window.epikodi.player.play({
        url: station.url,
        title: station.name,
        subtitle: station.tags || undefined,
        kind: 'audio',
      })
      setStatus('')
    } catch (error) {
      setStatus(`Lecture impossible : ${error.message}`, true)
    }
  }

  /** built with textContent only: names and tags come from a public directory */
  function stationItem(station) {
    const item = document.createElement('li')
    item.className = 'radio__station'
    if (station.url === playingUrl) item.classList.add('is-playing')

    const playButton = document.createElement('button')
    playButton.type = 'button'
    playButton.className = 'radio__play'
    playButton.title = `Ecouter ${station.name}`

    const logo = document.createElement('span')
    logo.className = 'radio__logo'
    if (station.favicon) {
      const image = document.createElement('img')
      image.src = station.favicon
      image.alt = ''
      image.referrerPolicy = 'no-referrer'
      image.addEventListener('error', () => {
        image.remove()
        logo.textContent = '📻'
      })
      logo.append(image)
    } else {
      logo.textContent = '📻'
    }

    const text = document.createElement('span')
    text.className = 'radio__text'
    const name = document.createElement('span')
    name.className = 'radio__name'
    name.textContent = station.name
    const tags = document.createElement('span')
    tags.className = 'radio__tags'
    tags.textContent = station.tags || ''
    text.append(name, tags)

    playButton.append(logo, text)
    playButton.addEventListener('click', () => void play(station))

    const star = document.createElement('button')
    star.type = 'button'
    star.className = 'radio__favorite'
    const favorite = isFavorite(station)
    star.textContent = favorite ? '★' : '☆'
    star.title = favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'
    star.setAttribute('aria-pressed', String(favorite))
    star.addEventListener('click', () => void toggleFavorite(station))

    item.append(playButton, star)
    return item
  }

  function renderList(list, stations) {
    list.replaceChildren(...stations.map(stationItem))
  }

  let lastResults = null

  function renderAll() {
    $('favorites-section').hidden = favorites.length === 0
    renderList($('favorites'), favorites)
    renderList($('featured'), window.FEATURED_STATIONS)
    $('results-section').hidden = lastResults === null
    if (lastResults) renderList($('results'), lastResults)
  }

  async function search(query) {
    setStatus(`Recherche de « ${query} »…`)
    const params = new URLSearchParams({
      name: query,
      limit: '40',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
    })
    try {
      const response = await fetch(`${RADIO_BROWSER}?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const found = await response.json()
      // the EpiKodi player only gets HTTPS streams, and duplicates are common in the directory
      const seen = new Set()
      lastResults = found
        .filter((station) => /^https:\/\//.test(station.url_resolved || ''))
        .filter((station) => !seen.has(station.url_resolved) && seen.add(station.url_resolved))
        .slice(0, 25)
        .map((station) => ({
          id: station.stationuuid,
          name: station.name.trim(),
          tags: [station.tags.split(',').slice(0, 3).join(' · '), station.countrycode]
            .filter(Boolean)
            .join(' · '),
          url: station.url_resolved,
          favicon: /^https:\/\//.test(station.favicon) ? station.favicon : null,
        }))
      $('results-title').textContent = `Resultats pour « ${query} »`
      setStatus(lastResults.length === 0 ? 'Aucune radio trouvee (en HTTPS).' : '')
    } catch (error) {
      lastResults = null
      setStatus(`Annuaire injoignable (${error.message}). Hors-ligne ?`, true)
    }
    renderAll()
  }

  function showNowPlaying(nowPlaying) {
    playingUrl = nowPlaying && nowPlaying.url
    $('now').hidden = !playingUrl
    $('now-title').textContent = playingUrl ? nowPlaying.title : ''
    renderAll()
  }

  $('search-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const query = $('search-input').value.trim()
    if (query) void search(query)
  })

  window.epikodi.on('nowPlaying', showNowPlaying)

  void window.epikodi.ready.then(async (info) => {
    favorites = (await window.epikodi.storage.get(FAVORITES_KEY)) || []
    showNowPlaying(info.nowPlaying)
  })
})()
