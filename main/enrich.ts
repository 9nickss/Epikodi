import path from 'node:path'
import type { MediaRecord } from '../shared/types'
import { getMedia, listMediaToEnrich, saveTmdbMatch, type TmdbMatchInput } from './db'
import { parseMovieFileName, type MovieQuery } from './movieName'
import {
  downloadTmdbImage,
  isTmdbConfigured,
  pickBestMatch,
  searchMovies,
  TmdbError,
  tmdbReleaseYear,
  type TmdbMovie,
} from './tmdb'

/** pause between lookups - TMDB allows ~40 req/s, a library scan has no reason to get near that */
const REQUEST_SPACING_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface EnrichCallbacks {
  onProgress?: (done: number, total: number) => void
}

export interface EnrichOutcome {
  done: number
  total: number
  error: string | null
}

/** images are optional - a failed download keeps the match, just without that picture */
async function tryDownload(
  imagePath: string | null,
  size: 'w342' | 'w780',
): Promise<string | null> {
  if (!imagePath) return null
  try {
    return await downloadTmdbImage(imagePath, size)
  } catch {
    return null
  }
}

async function toMatchInput(movie: TmdbMovie): Promise<TmdbMatchInput> {
  const [posterPath, backdropPath] = await Promise.all([
    tryDownload(movie.poster_path, 'w342'),
    tryDownload(movie.backdrop_path, 'w780'),
  ])
  return {
    tmdbId: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    overview: movie.overview,
    year: tmdbReleaseYear(movie),
    rating: movie.vote_average ?? null,
    posterPath,
    backdropPath,
  }
}

function queryForFile(filePath: string): MovieQuery {
  return parseMovieFileName(path.basename(filePath, path.extname(filePath)))
}

/** one lookup, with a single retry after TMDB's rate-limit window */
async function lookUp(query: MovieQuery): Promise<TmdbMovie | null> {
  try {
    return pickBestMatch(query, await searchMovies(query))
  } catch (error) {
    if (error instanceof TmdbError && error.kind === 'rate-limit') {
      await sleep(2_000)
      return pickBestMatch(query, await searchMovies(query))
    }
    throw error
  }
}

/**
 * Third phase of a scan (Issue 5.2): looks every new film of a source up on
 * TMDB and stores title, synopsis, year, rating and locally cached
 * poster/backdrop. Files without a confident match are marked as checked so
 * they aren't searched again on each rescan (the detail page can force a
 * new lookup with a corrected title). Stops at the first auth/network error
 * - remaining films stay unchecked and are retried on the next scan.
 */
export async function enrichSourceFromTmdb(
  sourceId: number,
  callbacks: EnrichCallbacks = {},
): Promise<EnrichOutcome> {
  if (!isTmdbConfigured()) return { done: 0, total: 0, error: null }

  const queue = listMediaToEnrich(sourceId)
  const total = queue.length
  let done = 0

  for (const item of queue) {
    try {
      const movie = await lookUp(queryForFile(item.path))
      saveTmdbMatch(item.id, movie ? await toMatchInput(movie) : null)
    } catch (error) {
      if (error instanceof TmdbError && error.kind !== 'http') {
        return { done, total, error: error.message }
      }
      // one bad response (5xx...) shouldn't stop the others - leave this file for the next scan
    }
    done += 1
    callbacks.onProgress?.(done, total)
    await sleep(REQUEST_SPACING_MS)
  }

  return { done, total, error: null }
}

/**
 * Forces a new lookup for one film (detail page), optionally with a title/year
 * typed by the user when the file name is misleading.
 */
export async function rematchMedia(mediaId: number, override?: MovieQuery): Promise<MediaRecord> {
  const media = getMedia(mediaId)
  if (!media) throw new Error(`Media ${mediaId} introuvable`)
  if (!isTmdbConfigured())
    throw new TmdbError('TMDB non configure (TMDB_API_KEY absent du .env)', 'auth')

  const query = override?.title.trim() ? override : queryForFile(media.path)
  const movie = await lookUp(query)
  saveTmdbMatch(mediaId, movie ? await toMatchInput(movie) : null)
  return getMedia(mediaId) as MediaRecord
}
