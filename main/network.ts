import { readFileSync } from 'node:fs'
import { opendir, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Network storage support (Issue 3.3): mounted shares (CIFS/NFS/SSHFS/GVFS on
 * Linux, UNC paths on Windows) are read through the regular fs API, but they
 * can hang for a long time or fail with network-specific errors when the
 * server goes away. Everything here exists to turn that into a bounded wait
 * and a readable message.
 *
 * Note: a timed-out fs call keeps occupying a libuv threadpool slot until the
 * OS gives up on it - the timeout only stops *us* from waiting on it.
 */

/** upper bound for a single fs call (stat, opendir, readdir batch) */
export const FS_TIMEOUT_MS = 10_000

export class FsTimeoutError extends Error {
  readonly code = 'ETIMEDOUT'

  constructor(operation: string, targetPath: string) {
    super(`${operation} timed out after ${FS_TIMEOUT_MS / 1000}s: ${targetPath}`)
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
  targetPath: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FsTimeoutError(operation, targetPath)), FS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ENOENT: 'Chemin introuvable (partage non monte ?)',
  ENOTDIR: "Ce chemin n'est pas un dossier",
  EACCES: 'Acces refuse',
  EPERM: 'Acces refuse',
  ETIMEDOUT: 'Delai depasse : le stockage ne repond pas',
  EHOSTDOWN: 'Serveur reseau eteint ou injoignable',
  EHOSTUNREACH: 'Serveur reseau injoignable',
  ENETUNREACH: 'Reseau injoignable',
  ENETDOWN: 'Reseau indisponible',
  ECONNREFUSED: 'Connexion refusee par le serveur',
  ECONNRESET: 'Connexion au serveur interrompue',
  ESTALE: 'Partage reseau deconnecte (handle perime)',
  EIO: "Erreur d'entree/sortie sur le stockage",
  EBUSY: 'Stockage occupe',
  // Windows: UNC share that doesn't exist / server not found
  UNKNOWN: 'Erreur inconnue (serveur ou partage introuvable ?)',
}

/** short French message for an fs error, suitable for the UI */
export function describeFsError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  return error instanceof Error ? error.message : String(error)
}

/** filesystem types of network-backed mounts as they appear in /proc/mounts */
const NETWORK_FS_TYPES = new Set([
  'cifs',
  'smb3',
  'smbfs',
  'nfs',
  'nfs4',
  'afs',
  '9p',
  'davfs',
  'fuse.sshfs',
  'fuse.gvfsd-fuse',
  'fuse.rclone',
])

function isUncPath(sourcePath: string): boolean {
  return /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(sourcePath)
}

/** longest-prefix match of the path against the Linux mount table */
function linuxMountFsType(sourcePath: string): string | null {
  let mounts: string
  try {
    mounts = readFileSync('/proc/mounts', 'utf8')
  } catch {
    return null
  }

  let best: { mountPoint: string; fsType: string } | null = null
  for (const line of mounts.split('\n')) {
    const [, rawMountPoint, fsType] = line.split(' ')
    if (!rawMountPoint || !fsType) continue
    // /proc/mounts escapes spaces etc. as octal (\040)
    const mountPoint = rawMountPoint.replace(/\\([0-7]{3})/g, (_m, oct: string) =>
      String.fromCharCode(parseInt(oct, 8)),
    )
    const isUnder =
      sourcePath === mountPoint ||
      sourcePath.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`)
    if (isUnder && (!best || mountPoint.length > best.mountPoint.length)) {
      best = { mountPoint, fsType }
    }
  }
  return best?.fsType ?? null
}

/** best-effort: true for UNC paths and paths on a known network mount */
export function isNetworkPath(sourcePath: string): boolean {
  if (isUncPath(sourcePath)) return true
  if (process.platform === 'linux') {
    if (/^\/run\/user\/\d+\/gvfs\//.test(sourcePath)) return true
    const fsType = linuxMountFsType(sourcePath)
    return fsType !== null && NETWORK_FS_TYPES.has(fsType)
  }
  return false
}

export type CheckSourceResult = { ok: true; path: string } | { ok: false; error: string }

/**
 * Validates a folder before it is added as a source: catches URLs the fs
 * can't read, unmounted shares, unreachable servers (with a timeout instead
 * of an indefinite hang) and non-directories.
 */
export async function checkSourcePath(rawPath: string): Promise<CheckSourceResult> {
  const trimmed = rawPath.trim()
  if (!trimmed) return { ok: false, error: 'Chemin vide' }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error:
        "Les URL (smb://, nfs://...) ne sont pas lisibles directement : monte d'abord le partage " +
        '(gestionnaire de fichiers, gio mount, /etc/fstab...) puis indique son point de montage.',
    }
  }

  if (process.platform !== 'win32' && isUncPath(trimmed) && trimmed.startsWith('\\\\')) {
    return {
      ok: false,
      error:
        'Les chemins UNC (\\\\serveur\\partage) ne sont lisibles que sous Windows : ' +
        'monte le partage puis indique son point de montage.',
    }
  }

  if (!path.isAbsolute(trimmed)) return { ok: false, error: 'Le chemin doit etre absolu' }

  // drops trailing separators / `..` so the same folder can't be added twice under two spellings
  const normalized = path.resolve(trimmed)

  try {
    const info = await withTimeout(stat(normalized), 'stat', normalized)
    if (!info.isDirectory()) return { ok: false, error: ERROR_MESSAGES.ENOTDIR }
    // stat succeeds on a folder we can't list - open it to catch permission errors up front
    const dir = await withTimeout(opendir(normalized), 'opendir', normalized)
    await dir.close()
  } catch (error) {
    return { ok: false, error: describeFsError(error) }
  }

  return { ok: true, path: normalized }
}
