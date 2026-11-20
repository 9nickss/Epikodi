import { useEffect, useRef } from 'react'
import { toPluginUrl, type PluginInfo } from '../../../shared/plugins'
import type { MediaRecord } from '../../../shared/types'
import type { NowPlaying, StreamMedia } from '../player/nowPlaying'
import {
  eventMessage,
  handlePluginRequest,
  isPluginRequest,
  readTheme,
  responseMessage,
  toPluginNowPlaying,
  type PluginHostContext,
} from './pluginBridge'
import './Plugins.css'

interface PluginViewProps {
  plugin: PluginInfo
  media: MediaRecord[]
  nowPlaying: NowPlaying | null
  onPlayStream: (stream: StreamMedia) => void
  onReload: () => void
}

/**
 * The section a plugin adds (Issue 6.3): its page in an iframe sandboxed with
 * scripts and forms only - no same-origin, no popups, no top navigation - so it can't
 * reach window.epikodi, the DOM of EpiKodi or Node. It talks to EpiKodi
 * through postMessage only, see pluginBridge.ts.
 */
export function PluginView({ plugin, media, nowPlaying, onPlayStream, onReload }: PluginViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { manifest } = plugin

  // the listener is attached once, it reads the latest props from here
  const contextRef = useRef<PluginHostContext>({
    plugin,
    media,
    nowPlaying,
    playStream: onPlayStream,
  })
  useEffect(() => {
    contextRef.current = { plugin, media, nowPlaying, playStream: onPlayStream }
  })

  function post(message: unknown): void {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      // only this plugin's frame - its origin is opaque ("null"), the window is what identifies it
      const frame = iframeRef.current?.contentWindow
      if (!frame || event.source !== frame || !isPluginRequest(event.data)) return
      const request = event.data
      let outcome: { result: unknown } | { error: string }
      try {
        outcome = { result: handlePluginRequest(request, contextRef.current) }
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message : String(error) }
      }
      frame.postMessage(responseMessage(request.id, outcome), '*')
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // theme changes land on <html> (themes.ts) - possibly after a view transition, so watch it
  useEffect(() => {
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => post(eventMessage('theme', readTheme())))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    post(eventMessage('nowPlaying', toPluginNowPlaying(nowPlaying, manifest.id)))
  }, [nowPlaying, manifest.id])

  const canReadLibrary = manifest.permissions.includes('library')
  useEffect(() => {
    if (canReadLibrary) post(eventMessage('libraryChanged', { count: media.length }))
  }, [media, canReadLibrary])

  return (
    <section className="plugin-view">
      <header className="plugin-view__header">
        <h2>
          <span className="plugin-view__icon" aria-hidden="true">
            {manifest.section.icon}
          </span>
          {manifest.section.label}
        </h2>
        <span className="plugin-view__meta">
          {manifest.name} v{manifest.version} · plugin
        </span>
        <button type="button" className="plugin-view__reload" onClick={onReload}>
          ↻ Recharger
        </button>
      </header>
      <iframe
        ref={iframeRef}
        className="plugin-view__frame"
        title={manifest.name}
        src={toPluginUrl(manifest.id, manifest.section.entry)}
        // allow-forms only lets submit events fire: form-action 'none' (CSP) still blocks sending
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}
