/**
 * Turns a video file name into a TMDB search query (Issue 5.1):
 *   "Inception.2010.1080p.BluRay.x264-GRP"  → { title: "Inception", year: 2010 }
 *   "Le Fabuleux Destin d'Amélie Poulain (2001) [VOSTFR]" → { title: "Le Fabuleux Destin d'Amélie Poulain", year: 2001 }
 */

/** release-name tokens that mark the end of the actual title */
const JUNK_TOKENS = new Set([
  '480p',
  '576p',
  '720p',
  '1080p',
  '1080i',
  '2160p',
  '4k',
  'uhd',
  'hdr',
  'hdr10',
  'dv',
  'bluray',
  'blu-ray',
  'bdrip',
  'brrip',
  'webrip',
  'web-dl',
  'webdl',
  'web',
  'hdtv',
  'dvdrip',
  'dvdscr',
  'hdrip',
  'remux',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'xvid',
  'divx',
  'aac',
  'ac3',
  'dts',
  'truehd',
  'atmos',
  'multi',
  'french',
  'truefrench',
  'vff',
  'vfq',
  'vf',
  'vo',
  'vostfr',
  'subfrench',
  'english',
  'proper',
  'repack',
  'extended',
  'unrated',
  'director',
  'directors',
  'remastered',
  'imax',
])

export interface MovieQuery {
  title: string
  year: number | null
}

export function parseMovieFileName(baseName: string): MovieQuery {
  let name = baseName
    // [GROUP], {tags} - never part of the title
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    // release names use dots/underscores as spaces; a name that already has spaces keeps its dots ("Mr. Nobody")
    .replace(baseName.includes(' ') ? /_/g : /[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  let year: number | null = null
  // the last plausible year wins: "2001 A Space Odyssey 1968" → 1968
  const yearMatches = [...name.matchAll(/(?:^|[\s(-])((?:19|20)\d{2})(?=$|[\s)-])/g)]
  // a "year" in the future is part of the title ("Blade Runner 2049")
  const maxYear = new Date().getFullYear() + 1
  const yearMatch = yearMatches.filter((m) => (m.index ?? 0) > 0 && Number(m[1]) <= maxYear).at(-1)
  if (yearMatch) {
    year = Number(yearMatch[1])
    name = name.slice(0, yearMatch.index)
  }

  const words = name.split(' ')
  const junkIndex = words.findIndex(
    (word, index) => index > 0 && JUNK_TOKENS.has(word.toLowerCase()),
  )
  if (junkIndex > 0) name = words.slice(0, junkIndex).join(' ')

  const title = name
    // remaining parentheses are annotations - "(Director's Cut)", "(Court-Metrage)"
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { title: title || baseName.trim(), year }
}

/** lowercase, accents/punctuation stripped - for comparing a file title with TMDB results */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** share of words in common (Jaccard index), 0..1 */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(Boolean))
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let common = 0
  for (const word of wordsA) if (wordsB.has(word)) common += 1
  return common / (wordsA.size + wordsB.size - common)
}
