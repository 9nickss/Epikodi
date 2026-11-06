import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { getTmdbCache, setTmdbCache } from './db'
import { normalizeTitle, titleSimilarity, type MovieQuery } from './movieName'

/**
 * Minimal TMDB client (Issue 5.1). Credentials come from `.env` (see
 * .env.example): either a v3 API key (`TMDB_API_KEY`) or a v4 read access
 * token (`TMDB_ACCESS_TOKEN`) - TMDB accepts both for the v3 endpoints we use.
 */

const API_BASE = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'
const REQUEST_TIMEOUT_MS = 10_000
/** search results barely change - a month keeps rescans offline-friendly and cheap */
const SEARCH_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface TmdbMovie {
  id: number
  title: string
  original_title: string
  overview: string
  release_date?: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average?: number
  vote_count?: number
  popularity?: number
  original_language?: string
  genre_ids?: number[]
  adult?: boolean
}

interface SearchResponse {
  results: TmdbMovie[]
}

/** errors the enrichment loop must react to differently (stop vs. skip one file) */
export class TmdbError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'rate-limit' | 'http',
  ) {
    super(message)
  }
}

function credentials(): { apiKey: string } | { token: string } | null {
  const token = process.env.TMDB_ACCESS_TOKEN?.trim()
  if (token) return { token }
  const apiKey = process.env.TMDB_API_KEY?.trim()
  if (apiKey) return { apiKey }
  return null
}

export function isTmdbConfigured(): boolean {
  return credentials() !== null
}

export function tmdbLanguage(): string {
  return process.env.TMDB_LANGUAGE?.trim() || 'fr-FR'
}

export async function tmdbFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const auth = credentials()
  if (!auth) throw new TmdbError('TMDB non configure (TMDB_API_KEY absent du .env)', 'auth')

  const url = new URL(`${API_BASE}${endpoint}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if ('apiKey' in auth) url.searchParams.set('api_key', auth.apiKey)

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...('token' in auth ? { authorization: `Bearer ${auth.token}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new TmdbError('TMDB injoignable (pas de connexion ?)', 'network')
  }

  if (response.status === 401) throw new TmdbError('Cle TMDB invalide (401)', 'auth')
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? '1')
    throw new TmdbError(
      `Limite de requetes TMDB atteinte (reessayer dans ${retryAfter}s)`,
      'rate-limit',
    )
  }
  if (!response.ok) throw new TmdbError(`Erreur TMDB ${response.status}`, 'http')
  return (await response.json()) as T
}

/** movie search, cached in SQLite per (title, year, language) */
export async function searchMovies(query: MovieQuery): Promise<TmdbMovie[]> {
  const cacheKey = `search:movie:${tmdbLanguage()}:${normalizeTitle(query.title)}:${query.year ?? ''}`
  const cached = getTmdbCache(cacheKey, SEARCH_CACHE_MAX_AGE_MS)
  if (cached) return (JSON.parse(cached) as SearchResponse).results

  const params: Record<string, string> = {
    query: query.title,
    language: tmdbLanguage(),
    include_adult: 'false',
  }
  if (query.year) params.year = String(query.year)

  let data = await tmdbFetch<SearchResponse>('/search/movie', params)
  // a wrong year in the file name (re-release, typo) would hide the right movie
  if (data.results.length === 0 && query.year) {
    delete params.year
    data = await tmdbFetch<SearchResponse>('/search/movie', params)
  }

  setTmdbCache(cacheKey, JSON.stringify({ results: data.results }))
  return data.results
}

export function tmdbReleaseYear(movie: TmdbMovie): number | null {
  const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : NaN
  return Number.isFinite(year) ? year : null
}

/**
 * Picks the result that really is this file, or null. TMDB's search is
 * fuzzy and always returns *something*, so a home video called "bar ugo"
 * must not end up with a random movie's poster: we require the titles to
 * match closely, and the year to agree when the file name has one.
 */
export function pickBestMatch(query: MovieQuery, results: TmdbMovie[]): TmdbMovie | null {
  let best: { movie: TmdbMovie; score: number } | null = null

  for (const movie of results.slice(0, 10)) {
    const similarity = Math.max(
      titleSimilarity(query.title, movie.title),
      titleSimilarity(query.title, movie.original_title),
    )
    const year = tmdbReleaseYear(movie)
    const yearDelta = query.year && year ? Math.abs(query.year - year) : null

    if (yearDelta !== null && yearDelta > 1) continue
    const exact =
      normalizeTitle(query.title) === normalizeTitle(movie.title) ||
      normalizeTitle(query.title) === normalizeTitle(movie.original_title)
    if (!exact && similarity < (yearDelta !== null ? 0.5 : 0.75)) continue

    // exact title + matching year first, then similarity, popularity as a tie-breaker
    const score =
      (exact ? 2 : similarity) +
      (yearDelta === 0 ? 1 : 0) +
      Math.min(movie.popularity ?? 0, 100) / 1000
    if (!best || score > best.score) best = { movie, score }
  }

  return best?.movie ?? null
}

/** remote URL of a TMDB image - for pictures not worth keeping on disk (Discover page) */
export function tmdbImageUrl(imagePath: string, size: 'w342' | 'w1280'): string {
  return `${IMAGE_BASE}/${size}${imagePath}`
}

/**
 * Downloads a poster/backdrop into userData so the library still shows it
 * offline (Issue 5.2 cache). Returns the local file path.
 */
export async function downloadTmdbImage(imagePath: string, size: 'w342' | 'w780'): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'tmdb', size)
  const target = path.join(dir, path.basename(imagePath))

  let response: Response
  try {
    response = await fetch(`${IMAGE_BASE}/${size}${imagePath}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 3),
    })
  } catch {
    throw new TmdbError('Telechargement image TMDB impossible', 'network')
  }
  if (!response.ok) throw new TmdbError(`Image TMDB ${response.status}`, 'http')

  await mkdir(dir, { recursive: true })
  // write then rename, so an interrupted download never leaves a half image in the cache
  const temp = `${target}.part`
  await writeFile(temp, Buffer.from(await response.arrayBuffer()))
  await rename(temp, target)
  return target
}
