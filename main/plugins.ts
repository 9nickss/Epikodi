import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, protocol } from 'electron'
import {
  PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS,
  PLUGIN_PROTOCOL,
  PLUGIN_SDK_FILE,
  type PluginInfo,
  type PluginList,
  type PluginLoadError,
  type PluginManifest,
  type PluginPermission,
} from '../shared/plugins'
import { PLUGIN_SDK_SOURCE } from './pluginSdk'

/**
 * Plugin loader (Issue 6.2 / #5.2). Plugins are read from two folders:
 * - plugins/ next to package.json: examples shipped with EpiKodi
 * - userData/plugins/: plugins installed by the user
 *
 * Nothing from a plugin runs in the main process: the loader only validates
 * manifests and serves the plugin's files on app-plugin://<id>/, where the
 * renderer shows them in a sandboxed iframe. A broken plugin is listed with
 * its error and skipped, it never stops the others or the app from starting.
 */

const MANIFEST_FILE = 'manifest.json'
const STATE_FILE = 'plugins-state.json'
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

const bundledDirectory = (): string => path.join(__dirname, '../../plugins')
const userDirectory = (): string => path.join(app.getPath('userData'), 'plugins')
const statePath = (): string => path.join(app.getPath('userData'), STATE_FILE)

let current: PluginList | null = null

class ManifestError extends Error {}

function requireString(raw: Record<string, unknown>, key: string, fallback?: string): string {
  const value = raw[key] ?? fallback
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManifestError(`champ "${key}" manquant ou invalide`)
  }
  return value.trim()
}

function optionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ManifestError(`champ "${key}" invalide`)
  return value.trim() || null
}

/** a path inside the plugin folder: relative, forward slashes, no way out of it */
function checkRelativePath(file: string, key: string): string {
  const normalized = path.posix.normalize(file.replace(/\\/g, '/'))
  if (path.posix.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new ManifestError(`"${key}" doit etre un chemin relatif dans le dossier du plugin`)
  }
  return normalized
}

/** exported for tests - throws a ManifestError explaining what's wrong */
export function parseManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError('le manifeste doit etre un objet JSON')
  }
  const manifest = raw as Record<string, unknown>

  const id = requireString(manifest, 'id')
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(
      `id "${id}" invalide (lettres minuscules, chiffres et tirets uniquement)`,
    )
  }

  const apiVersion = manifest.apiVersion
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion) || apiVersion < 1) {
    throw new ManifestError('champ "apiVersion" manquant ou invalide')
  }
  if (apiVersion > PLUGIN_API_VERSION) {
    throw new ManifestError(
      `necessite l'API plugin v${apiVersion}, cette version d'EpiKodi fournit la v${PLUGIN_API_VERSION}`,
    )
  }

  const section = manifest.section
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new ManifestError('champ "section" manquant (la section ajoutee a la sidebar)')
  }
  const rawSection = section as Record<string, unknown>
  const icon = requireString(rawSection, 'icon', '🧩')
  if ([...icon].length > 4) throw new ManifestError('"section.icon" : un emoji ou 4 caracteres max')

  const permissions = manifest.permissions ?? []
  if (!Array.isArray(permissions)) throw new ManifestError('"permissions" doit etre une liste')
  for (const permission of permissions) {
    if (!PLUGIN_PERMISSIONS.includes(permission as PluginPermission)) {
      throw new ManifestError(
        `permission inconnue "${String(permission)}" (connues : ${PLUGIN_PERMISSIONS.join(', ')})`,
      )
    }
  }

  return {
    id,
    name: requireString(manifest, 'name'),
    version: requireString(manifest, 'version'),
    apiVersion,
    description: optionalString(manifest, 'description'),
    author: optionalString(manifest, 'author'),
    section: {
      label: requireString(rawSection, 'label'),
      icon,
      entry: checkRelativePath(requireString(rawSection, 'entry', 'index.html'), 'section.entry'),
    },
    permissions: [...new Set(permissions as PluginPermission[])],
  }
}

async function isDirectory(target: string): Promise<boolean> {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  )
}

async function loadPluginFolder(directory: string): Promise<PluginManifest> {
  let text: string
  try {
    text = await readFile(path.join(directory, MANIFEST_FILE), 'utf8')
  } catch {
    throw new ManifestError(`${MANIFEST_FILE} introuvable`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ManifestError(
      `${MANIFEST_FILE} n'est pas du JSON valide (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const manifest = parseManifest(raw)
  const entryPath = path.join(directory, manifest.section.entry)
  const entry = await stat(entryPath).catch(() => null)
  if (!entry?.isFile()) {
    throw new ManifestError(
      `page "${manifest.section.entry}" introuvable dans le dossier du plugin`,
    )
  }
  return manifest
}

async function readDisabledIds(): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { disabled?: unknown }
    return new Set(Array.isArray(raw.disabled) ? raw.disabled.map(String) : [])
  } catch {
    return new Set()
  }
}

async function writeDisabledIds(ids: Set<string>): Promise<void> {
  await writeFile(statePath(), JSON.stringify({ disabled: [...ids].sort() }, null, 2))
}

/** (re)reads both plugin folders - user plugins can't take the id of a bundled one */
export async function loadPlugins(): Promise<PluginList> {
  const userDir = userDirectory()
  await mkdir(userDir, { recursive: true }).catch(() => undefined)
  const disabled = await readDisabledIds()

  const plugins: PluginInfo[] = []
  const errors: PluginLoadError[] = []
  const roots = [
    { root: bundledDirectory(), isBundled: true },
    { root: userDir, isBundled: false },
  ]

  for (const { root, isBundled } of roots) {
    const names = await readdir(root).catch(() => [])
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (name.startsWith('.')) continue
      const directory = path.join(root, name)
      if (!(await isDirectory(directory))) continue
      try {
        const manifest = await loadPluginFolder(directory)
        const duplicate = plugins.find((plugin) => plugin.manifest.id === manifest.id)
        if (duplicate) {
          throw new ManifestError(`id "${manifest.id}" deja utilise par ${duplicate.directory}`)
        }
        plugins.push({ manifest, directory, isBundled, enabled: !disabled.has(manifest.id) })
      } catch (error) {
        // anything else than a ManifestError is still reported, never thrown at startup
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ directory, message })
        console.warn(`[plugins] ${directory} ignore : ${message}`)
      }
    }
  }

  current = { plugins, errors, userDirectory: userDir }
  return current
}

export async function listPlugins(): Promise<PluginList> {
  return current ?? loadPlugins()
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginList> {
  const disabled = await readDisabledIds()
  if (enabled) disabled.delete(pluginId)
  else disabled.add(pluginId)
  await writeDisabledIds(disabled)
  const list = await listPlugins()
  for (const plugin of list.plugins) {
    if (plugin.manifest.id === pluginId) plugin.enabled = enabled
  }
  return list
}

// --- app-plugin:// --------------------------------------------------------

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

/**
 * What a plugin page may load: its own files, plus https:// when it has the
 * "network" permission. Scripts only ever come from the plugin folder.
 */
function contentSecurityPolicy(manifest: PluginManifest): string {
  const self = `${PLUGIN_PROTOCOL}://${manifest.id}`
  const network = manifest.permissions.includes('network')
  return [
    "default-src 'none'",
    `script-src ${self}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:${network ? ' https:' : ''}`,
    `font-src ${self} data:`,
    `media-src ${self} blob:${network ? ' https:' : ''}`,
    `connect-src ${self}${network ? ' https:' : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/** must be part of the registerSchemesAsPrivileged call, see main/protocols.ts */
export const PLUGIN_SCHEME: Electron.CustomScheme = {
  scheme: PLUGIN_PROTOCOL,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

/** must run after app.whenReady() */
export function registerPluginProtocolHandler(): void {
  protocol.handle(PLUGIN_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    const plugin = current?.plugins.find((p) => p.manifest.id === url.hostname)
    if (!plugin?.enabled) return textResponse(404, 'Plugin introuvable ou desactive')

    const headers: Record<string, string> = {
      'content-security-policy': contentSecurityPolicy(plugin.manifest),
      // the sandboxed iframe has an opaque origin: needed for fetch() and module scripts
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    }

    let relative: string
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return textResponse(400, 'URL invalide')
    }
    if (relative === PLUGIN_SDK_FILE) {
      return new Response(PLUGIN_SDK_SOURCE, {
        headers: { ...headers, 'content-type': CONTENT_TYPES.js },
      })
    }

    const root = path.resolve(plugin.directory)
    const filePath = path.resolve(root, relative || plugin.manifest.section.entry)
    if (!filePath.startsWith(root + path.sep)) return textResponse(403, 'Acces refuse')

    try {
      const body = await readFile(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      return new Response(body, {
        headers: { ...headers, 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' },
      })
    } catch {
      return textResponse(404, 'Fichier introuvable')
    }
  })
}
