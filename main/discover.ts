import type { DiscoverDetails, DiscoverMovie, DiscoverRow } from '../shared/types'
import { getTmdbCache, setTmdbCache } from './db'
import { TmdbError, tmdbFetch, tmdbImageUrl, tmdbLanguage, type TmdbMovie } from './tmdb'

/** lists move daily at most - a few hours keeps the page instant without going stale */
const LIST_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const REFERENCE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const MAX_CAST = 8

const ROWS: readonly { id: string; title: string; endpoint: string; regional?: boolean }[] = [
  { id: 'trending', title: 'Tendances de la semaine', endpoint: '/trending/movie/week' },
  { id: 'now-playing', title: 'Au cinema', endpoint: '/movie/now_playing', regional: true },
  { id: 'upcoming', title: 'Bientot au cinema', endpoint: '/movie/upcoming', regional: true },
  { id: 'popular', title: 'Populaires', endpoint: '/movie/popular' },
  { id: 'top-rated', title: 'Les mieux notes', endpoint: '/movie/top_rated' },
]

interface ListResponse {
  results: TmdbMovie[]
}

interface GenreListResponse {
  genres: { id: number; name: string }[]
}

interface MovieDetailsResponse {
  tagline?: string
  runtime?: number | null
  production_countries?: { name: string }[]
  credits?: {
    cast?: { name: string }[]
    crew?: { name: string; job: string }[]
  }
}

/** an expired copy still beats an empty page when offline */
async function fetchCached<T>(
  endpoint: string,
  params: Record<string, string>,
  maxAgeMs: number,
): Promise<T> {
  const cacheKey = `discover:${endpoint}:${new URLSearchParams(params).toString()}`
  const cached = getTmdbCache(cacheKey, maxAgeMs)
  if (cached) return JSON.parse(cached) as T

  try {
    const data = await tmdbFetch<T>(endpoint, params)
    setTmdbCache(cacheKey, JSON.stringify(data))
    return data
  } catch (error) {
    const stale = getTmdbCache(cacheKey, Infinity)
    if (stale && error instanceof TmdbError && error.kind === 'network') {
      return JSON.parse(stale) as T
    }
    throw error
  }
}

function toDiscoverMovie(movie: TmdbMovie, genres: ReadonlyMap<number, string>): DiscoverMovie {
  return {
    id: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    originalLanguage: movie.original_language || null,
    overview: movie.overview,
    releaseDate: movie.release_date || null,
    rating: movie.vote_average || null,
    voteCount: movie.vote_count ?? 0,
    genres: (movie.genre_ids ?? []).flatMap((id) => genres.get(id) ?? []),
    posterUrl: movie.poster_path ? tmdbImageUrl(movie.poster_path, 'w342') : null,
    backdropUrl: movie.backdrop_path ? tmdbImageUrl(movie.backdrop_path, 'w1280') : null,
  }
}

/** films picked by TMDB, whether or not they're in the library - a failed row doesn't hide the others */
export async function listDiscoverRows(): Promise<DiscoverRow[]> {
  const language = tmdbLanguage()
  const region = language.split('-')[1]

  const { genres } = await fetchCached<GenreListResponse>(
    '/genre/movie/list',
    { language },
    REFERENCE_CACHE_MAX_AGE_MS,
  )
  const genreNames = new Map(genres.map((genre) => [genre.id, genre.name]))

  const results = await Promise.allSettled(
    ROWS.map(async ({ id, title, endpoint, regional }): Promise<DiscoverRow> => {
      const params: Record<string, string> =
        regional && region ? { language, region } : { language }
      const { results: movies } = await fetchCached<ListResponse>(
        endpoint,
        params,
        LIST_CACHE_MAX_AGE_MS,
      )
      return {
        id,
        title,
        movies: movies
          .filter((movie) => !movie.adult)
          .map((movie) => toDiscoverMovie(movie, genreNames)),
      }
    }),
  )

  const rows = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const failure = results.find((result) => result.status === 'rejected')
  if (rows.length === 0 && failure) throw failure.reason
  return rows.filter((row) => row.movies.length > 0)
}

/** what the lists don't carry: runtime, tagline, countries and credits */
export async function getDiscoverDetails(movieId: number): Promise<DiscoverDetails> {
  const movie = await fetchCached<MovieDetailsResponse>(
    `/movie/${movieId}`,
    { language: tmdbLanguage(), append_to_response: 'credits' },
    REFERENCE_CACHE_MAX_AGE_MS,
  )
  return {
    tagline: movie.tagline || null,
    runtimeMinutes: movie.runtime || null,
    countries: (movie.production_countries ?? []).map((country) => country.name),
    directors: (movie.credits?.crew ?? [])
      .filter((member) => member.job === 'Director')
      .map((member) => member.name),
    cast: (movie.credits?.cast ?? []).slice(0, MAX_CAST).map((member) => member.name),
  }
}
