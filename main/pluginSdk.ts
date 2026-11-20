import { PLUGIN_API_VERSION, PLUGIN_MESSAGE_TAG } from '../shared/plugins'

/**
 * Script served to every plugin as `epikodi-sdk.js` (see main/plugins.ts).
 * It hides the postMessage protocol behind `window.epikodi` and applies the
 * EpiKodi theme to the plugin page, so a plugin's CSS can use var(--accent)
 * and friends. Kept as plain ES2020 in a string: it runs in the plugin page,
 * not in Node, and isn't compiled with the main process.
 */
export const PLUGIN_SDK_SOURCE = `/* EpiKodi plugin SDK - API v${PLUGIN_API_VERSION} */
;(() => {
  const TAG = ${JSON.stringify(PLUGIN_MESSAGE_TAG)}
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return
    const root = document.documentElement
    for (const [name, value] of Object.entries(theme.vars || {})) root.style.setProperty(name, value)
    root.style.colorScheme = theme.scheme
    root.dataset.theme = theme.id
  }

  function call(method, params) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      window.parent.postMessage({ tag: TAG, type: 'request', id, method, params }, '*')
    })
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (!message || message.tag !== TAG) return
    if (message.type === 'response') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error))
      else entry.resolve(message.result)
    } else if (message.type === 'event') {
      if (message.name === 'theme') applyTheme(message.data)
      for (const listener of listeners.get(message.name) || []) {
        try {
          listener(message.data)
        } catch (error) {
          console.error('[epikodi] listener failed', error)
        }
      }
    }
  })

  const ready = call('ready').then((info) => {
    applyTheme(info.theme)
    return info
  })

  window.epikodi = Object.freeze({
    apiVersion: ${PLUGIN_API_VERSION},
    /** resolves to { pluginId, apiVersion, theme, nowPlaying } once EpiKodi answered */
    ready,
    player: Object.freeze({
      /** { url, title, subtitle?, kind? } - opens the stream in the EpiKodi player */
      play: (media) => call('player.play', media),
      /** what EpiKodi is playing, or null */
      state: () => call('player.state'),
    }),
    library: Object.freeze({
      /** needs the "library" permission */
      list: () => call('library.list'),
    }),
    storage: Object.freeze({
      /** JSON values kept per plugin (localStorage is unavailable in the sandbox) */
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
    }),
    /** 'theme' | 'nowPlaying' | 'libraryChanged' - returns an unsubscribe function */
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      return () => listeners.get(name).delete(listener)
    },
  })
})()
`
