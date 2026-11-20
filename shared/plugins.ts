/**
 * Plugin contract (Issue 6 / #5.2), shared by the main-process loader and the
 * renderer. A plugin is a folder holding a `manifest.json` and a web page:
 * the page is shown as a sidebar section, inside a sandboxed iframe served on
 * `app-plugin://<id>/`, and only talks to EpiKodi through postMessage (see
 * plugins/README.md). It never gets Node, IPC or the filesystem.
 */

import type { MediaCategory } from './mediaCategory'

/** URL scheme plugin files are served on, see main/plugins.ts */
export const PLUGIN_PROTOCOL = 'app-plugin'

/** bumped on breaking changes of the message API - a plugin declares the one it targets */
export const PLUGIN_API_VERSION = 1

/** served to every plugin at its root, wraps the postMessage protocol (main/pluginSdk.ts) */
export const PLUGIN_SDK_FILE = 'epikodi-sdk.js'

/**
 * - network: may fetch https:// APIs and show https:// images (otherwise only its own files)
 * - library: may read the list of media in the library (titles, categories, durations)
 */
export const PLUGIN_PERMISSIONS = ['network', 'library'] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

export const PLUGIN_PERMISSION_LABELS: Readonly<Record<PluginPermission, string>> = {
  network: 'Acces Internet (https)',
  library: 'Lecture de la bibliotheque',
}

/** content of a plugin's manifest.json, once validated */
export interface PluginManifest {
  /** lowercase letters, digits and dashes - also the host of its app-plugin:// URLs */
  id: string
  name: string
  version: string
  apiVersion: number
  description: string | null
  author: string | null
  /** the sidebar entry the plugin adds */
  section: {
    label: string
    /** one emoji or a short text */
    icon: string
    /** page shown in the section, relative to the plugin folder */
    entry: string
  }
  permissions: PluginPermission[]
}

export interface PluginInfo {
  manifest: PluginManifest
  /** absolute path of the plugin folder */
  directory: string
  /** shipped with EpiKodi (plugins/ in the repo) rather than installed by the user */
  isBundled: boolean
  enabled: boolean
}

/** a folder of a plugins directory that couldn't be loaded - shown on the Plugins page */
export interface PluginLoadError {
  directory: string
  message: string
}

export interface PluginList {
  plugins: PluginInfo[]
  errors: PluginLoadError[]
  /** where the user installs plugins (userData/plugins) */
  userDirectory: string
}

export function toPluginUrl(pluginId: string, file: string): string {
  return `${PLUGIN_PROTOCOL}://${pluginId}/${file.split('/').map(encodeURIComponent).join('/')}`
}

// --- postMessage protocol between a plugin page and EpiKodi ---------------

/** marks EpiKodi plugin messages among whatever else a page may post */
export const PLUGIN_MESSAGE_TAG = 'epikodi-plugin'

export type PluginMethod =
  'ready' | 'player.play' | 'player.state' | 'library.list' | 'storage.get' | 'storage.set'

/** plugin -> EpiKodi */
export interface PluginRequestMessage {
  tag: typeof PLUGIN_MESSAGE_TAG
  type: 'request'
  id: number
  method: PluginMethod
  params?: unknown
}

/** EpiKodi -> plugin, answer to a request */
export interface PluginResponseMessage {
  tag: typeof PLUGIN_MESSAGE_TAG
  type: 'response'
  id: number
  result?: unknown
  error?: string
}

export type PluginEventName = 'theme' | 'nowPlaying' | 'libraryChanged'

/** EpiKodi -> plugin, pushed without a request */
export interface PluginEventMessage {
  tag: typeof PLUGIN_MESSAGE_TAG
  type: 'event'
  name: PluginEventName
  data: unknown
}

/** `player.play` params: a stream or remote file the EpiKodi player opens */
export interface PluginPlayRequest {
  /** http(s) URL */
  url: string
  title: string
  /** second line in the player, e.g. the radio's genre */
  subtitle?: string
  kind?: 'audio' | 'video'
}

/** payload of the `theme` event - the SDK applies `vars` on the plugin's <html> */
export interface PluginTheme {
  id: string
  scheme: 'light' | 'dark'
  vars: Record<string, string>
}

/** payload of the `nowPlaying` event and result of `player.state` */
export interface PluginNowPlaying {
  title: string
  kind: 'audio' | 'video'
  /** library: a media of the library · stream: opened by a plugin */
  source: 'library' | 'stream'
  /** stream URL when opened by this plugin, null otherwise (library paths aren't shared) */
  url: string | null
}

/** result of `library.list` - no file paths, a plugin doesn't need to know them */
export interface PluginLibraryItem {
  id: number
  title: string
  category: MediaCategory
  kind: 'audio' | 'video'
  durationSeconds: number | null
  artist: string | null
  album: string | null
  year: number | null
}
