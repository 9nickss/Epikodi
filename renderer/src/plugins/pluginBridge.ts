import {
  PLUGIN_API_VERSION,
  PLUGIN_MESSAGE_TAG,
  type PluginEventMessage,
  type PluginEventName,
  type PluginInfo,
  type PluginLibraryItem,
  type PluginNowPlaying,
  type PluginPlayRequest,
  type PluginRequestMessage,
  type PluginResponseMessage,
  type PluginTheme,
} from '../../../shared/plugins'
import type { MediaRecord } from '../../../shared/types'
import { displayTitle, displayYear } from '../format'
import { nowPlayingTitle, type NowPlaying, type StreamMedia } from '../player/nowPlaying'
import { THEMES } from '../theme/themes'

/**
 * EpiKodi side of the plugin message API (Issue 6.1 / #5.2). Everything a
 * plugin page can ask goes through handlePluginRequest: there's no other way
 * out of its sandboxed iframe, so this file is the whole attack surface.
 */

const THEME_VARS = [...Object.keys(THEMES[0].vars), '--sans', '--heading', '--mono']

const STORAGE_PREFIX = 'epikodi.plugin.'
const MAX_STORAGE_KEY_LENGTH = 100
const MAX_STORAGE_VALUE_LENGTH = 256 * 1024

export interface PluginHostContext {
  plugin: PluginInfo
  media: MediaRecord[]
  nowPlaying: NowPlaying | null
  playStream: (stream: StreamMedia) => void
}

export function isPluginRequest(data: unknown): data is PluginRequestMessage {
  if (!data || typeof data !== 'object') return false
  const message = data as Partial<PluginRequestMessage>
  return (
    message.tag === PLUGIN_MESSAGE_TAG &&
    message.type === 'request' &&
    typeof message.id === 'number' &&
    typeof message.method === 'string'
  )
}

/** the active theme as resolved on <html>, including Metro's CSS overrides */
export function readTheme(): PluginTheme {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const vars: Record<string, string> = {}
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim()
    if (value) vars[name] = value
  }
  return {
    id: root.dataset.theme ?? 'light',
    scheme: root.style.colorScheme === 'light' ? 'light' : 'dark',
    vars,
  }
}

/** library paths stay private; a stream URL is only shown to the plugin that opened it */
export function toPluginNowPlaying(
  nowPlaying: NowPlaying | null,
  pluginId: string,
): PluginNowPlaying | null {
  if (!nowPlaying) return null
  if (nowPlaying.type === 'library') {
    return {
      title: nowPlayingTitle(nowPlaying),
      kind: nowPlaying.media.kind,
      source: 'library',
      url: null,
    }
  }
  const { stream } = nowPlaying
  return {
    title: stream.title,
    kind: stream.kind,
    source: 'stream',
    url: stream.pluginId === pluginId ? stream.url : null,
  }
}

function toLibraryItem(media: MediaRecord): PluginLibraryItem {
  return {
    id: media.id,
    title: displayTitle(media),
    category: media.category,
    kind: media.kind,
    durationSeconds: media.durationSeconds,
    artist: media.artist ?? media.albumArtist,
    album: media.album,
    year: displayYear(media),
  }
}

function parsePlayRequest(params: unknown): PluginPlayRequest {
  if (!params || typeof params !== 'object') throw new Error('player.play : parametres manquants')
  const { url, title, subtitle, kind } = params as Record<string, unknown>
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('player.play : "url" doit etre une URL http(s)')
  }
  try {
    new URL(url)
  } catch {
    throw new Error('player.play : "url" invalide')
  }
  if (typeof title !== 'string' || !title.trim()) throw new Error('player.play : "title" manquant')
  if (subtitle !== undefined && typeof subtitle !== 'string') {
    throw new Error('player.play : "subtitle" doit etre un texte')
  }
  if (kind !== undefined && kind !== 'audio' && kind !== 'video') {
    throw new Error('player.play : "kind" vaut "audio" ou "video"')
  }
  return { url, title: title.trim().slice(0, 200), subtitle: subtitle?.slice(0, 200), kind }
}

function storageKey(pluginId: string, params: unknown): string {
  const key = (params as { key?: unknown } | undefined)?.key
  if (typeof key !== 'string' || !key || key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new Error(
      `storage : "key" doit etre un texte de 1 a ${MAX_STORAGE_KEY_LENGTH} caracteres`,
    )
  }
  return `${STORAGE_PREFIX}${pluginId}.${key}`
}

function requirePermission(plugin: PluginInfo, permission: 'library'): void {
  if (!plugin.manifest.permissions.includes(permission)) {
    throw new Error(`permission "${permission}" absente du manifest.json`)
  }
}

export function handlePluginRequest(
  { method, params }: PluginRequestMessage,
  { plugin, media, nowPlaying, playStream }: PluginHostContext,
): unknown {
  const pluginId = plugin.manifest.id
  switch (method) {
    case 'ready':
      return {
        pluginId,
        apiVersion: PLUGIN_API_VERSION,
        theme: readTheme(),
        nowPlaying: toPluginNowPlaying(nowPlaying, pluginId),
      }
    case 'player.play': {
      const request = parsePlayRequest(params)
      playStream({
        url: request.url,
        title: request.title,
        subtitle: request.subtitle ?? null,
        kind: request.kind ?? 'audio',
        pluginId,
        pluginName: plugin.manifest.name,
      })
      return null
    }
    case 'player.state':
      return toPluginNowPlaying(nowPlaying, pluginId)
    case 'library.list':
      requirePermission(plugin, 'library')
      return media.map(toLibraryItem)
    case 'storage.get': {
      const raw = localStorage.getItem(storageKey(pluginId, params))
      return raw === null ? null : (JSON.parse(raw) as unknown)
    }
    case 'storage.set': {
      const key = storageKey(pluginId, params)
      const value = (params as { value?: unknown }).value
      if (value === undefined || value === null) {
        localStorage.removeItem(key)
        return null
      }
      const raw = JSON.stringify(value)
      if (raw.length > MAX_STORAGE_VALUE_LENGTH) {
        throw new Error('storage.set : valeur trop grande (256 Ko max)')
      }
      localStorage.setItem(key, raw)
      return null
    }
    default:
      throw new Error(`methode inconnue "${String(method)}"`)
  }
}

export function responseMessage(
  id: number,
  outcome: { result: unknown } | { error: string },
): PluginResponseMessage {
  return { tag: PLUGIN_MESSAGE_TAG, type: 'response', id, ...outcome }
}

export function eventMessage(name: PluginEventName, data: unknown): PluginEventMessage {
  return { tag: PLUGIN_MESSAGE_TAG, type: 'event', name, data }
}
