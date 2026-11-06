import { listMediaToProbe, saveMediaMetadata, saveProbeError } from './db'
import { extractMediaMetadata, isFfprobeMissing } from './ffprobe'
import { describeFsError } from './network'

/**
 * ffprobe processes running at once - each is cheap on CPU but reads from
 * disk, and a network share gets slower (not faster) with many parallel reads
 */
const PROBE_CONCURRENCY = 2

function describeProbeError(error: unknown): string {
  const { killed, code } = error as { killed?: boolean; code?: unknown }
  if (killed) return 'Delai depasse (ffprobe ne repond pas)'
  // execFile reports a non-zero exit as a numeric code - ffprobe couldn't parse the file
  if (typeof code === 'number')
    return 'Fichier illisible par ffprobe (corrompu ou format non supporte)'
  return describeFsError(error)
}

export interface MetadataCallbacks {
  onProgress?: (done: number, total: number) => void
}

export interface MetadataOutcome {
  done: number
  total: number
  /** set when extraction stopped early (ffprobe not installed) */
  error: string | null
}

/**
 * Second phase of indexing (Issue 3.4): runs ffprobe on every file of a
 * source that has no metadata yet - new files, or files whose size/mtime
 * changed since the last scan - and stores duration, codecs, resolution and
 * audio tags. A file ffprobe can't read is marked with its error and skipped
 * on later rescans until it changes.
 */
export async function extractSourceMetadata(
  sourceId: number,
  callbacks: MetadataCallbacks = {},
): Promise<MetadataOutcome> {
  const queue = listMediaToProbe(sourceId)
  const total = queue.length
  let done = 0
  let fatalError: string | null = null

  async function worker(): Promise<void> {
    for (let item = queue.shift(); item && !fatalError; item = queue.shift()) {
      try {
        saveMediaMetadata(item.id, await extractMediaMetadata(item.path))
      } catch (error) {
        if (isFfprobeMissing(error)) {
          fatalError = 'ffprobe introuvable : installe FFmpeg (ou definis FFPROBE_PATH)'
          return
        }
        // if the source was removed mid-extraction the row is gone and this is a no-op
        saveProbeError(item.id, describeProbeError(error))
      }
      done += 1
      callbacks.onProgress?.(done, total)
    }
  }

  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, total) }, worker))
  return { done, total, error: fatalError }
}
