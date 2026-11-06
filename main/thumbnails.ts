import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { getSource, listMediaToThumbnail, saveThumbnail, type ThumbnailQueueItem } from './db'
import { extractVideoFrame, isFfmpegMissing } from './ffmpeg'

/** ffmpeg processes running at once - same reasoning as PROBE_CONCURRENCY, plus each one decodes video */
const THUMBNAIL_CONCURRENCY = 2

/** fraction of the duration the frame is taken at - far enough to skip logos and fade-ins */
const THUMBNAIL_POSITION = 0.1

export interface ThumbnailCallbacks {
  onProgress?: (done: number, total: number) => void
}

export interface ThumbnailOutcome {
  done: number
  total: number
  /** set when generation stopped early (ffmpeg not installed) */
  error: string | null
}

function thumbnailDir(mediaId: number): string {
  return path.join(app.getPath('userData'), 'thumbnails', String(mediaId))
}

/** goes through a temp file so a killed ffmpeg never leaves a truncated thumb.jpg */
async function generateThumbnail(item: ThumbnailQueueItem): Promise<string> {
  const dir = thumbnailDir(item.id)
  await mkdir(dir, { recursive: true })

  const partialPath = path.join(dir, 'thumb.partial.jpg')
  const thumbnailPath = path.join(dir, 'thumb.jpg')
  await extractVideoFrame(item.path, partialPath, (item.durationSeconds ?? 0) * THUMBNAIL_POSITION)
  await rename(partialPath, thumbnailPath)
  return thumbnailPath
}

export async function removeThumbnails(mediaIds: number[]): Promise<void> {
  for (const id of mediaIds) await rm(thumbnailDir(id), { recursive: true, force: true })
}

/**
 * Last phase of a scan (Issue F2.1): grabs one frame of every video of a
 * source that has no thumbnail yet - new files, or files whose size/mtime
 * changed since the last scan. A file ffmpeg can't read is marked as checked
 * and keeps its placeholder until it changes. Stops if the source is removed.
 */
export async function generateSourceThumbnails(
  sourceId: number,
  callbacks: ThumbnailCallbacks = {},
): Promise<ThumbnailOutcome> {
  const queue = listMediaToThumbnail(sourceId)
  const total = queue.length
  let done = 0
  let fatalError: string | null = null

  async function worker(): Promise<void> {
    for (
      let item = queue.shift();
      item && !fatalError && getSource(sourceId);
      item = queue.shift()
    ) {
      try {
        const thumbnailPath = await generateThumbnail(item)
        // source removed mid-generation: the row is gone, nothing else would clean this up
        if (!saveThumbnail(item.id, thumbnailPath)) await removeThumbnails([item.id])
      } catch (error) {
        if (isFfmpegMissing(error)) {
          fatalError = 'ffmpeg introuvable : installe FFmpeg (ou definis FFMPEG_PATH)'
          return
        }
        saveThumbnail(item.id, null)
      }
      done += 1
      callbacks.onProgress?.(done, total)
    }
  }

  await Promise.all(Array.from({ length: Math.min(THUMBNAIL_CONCURRENCY, total) }, worker))
  return { done, total, error: fatalError }
}
