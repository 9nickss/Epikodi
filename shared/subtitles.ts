/**
 * External subtitle files (#3.1): `film.srt`, `film.fr.srt`, `film.eng.vtt`...
 * sitting next to a video are attached to it at scan time. Pure functions,
 * shared by the scanner (main) and the player menu (renderer).
 */

export const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt'])

export type SubtitleFormat = 'srt' | 'vtt'

/** a subtitle file attached to a video in the library */
export interface SubtitleTrack {
  id: number
  /** ISO 639-1 code when the file name has a known one ("fr", "en"), else null */
  language: string | null
  /** shown in the player menu and the detail page: "Francais", "Anglais (force)"... */
  label: string
  format: SubtitleFormat
}

export function isSubtitleExtension(extension: string): boolean {
  return SUBTITLE_EXTENSIONS.has(extension.toLowerCase())
}

/** 2- and 3-letter codes (and a few names) found in subtitle file names -> ISO 639-1 */
const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  fr: 'fr',
  fre: 'fr',
  fra: 'fr',
  french: 'fr',
  francais: 'fr',
  vf: 'fr',
  vff: 'fr',
  vfq: 'fr',
  en: 'en',
  eng: 'en',
  english: 'en',
  anglais: 'en',
  vo: 'en',
  es: 'es',
  spa: 'es',
  esp: 'es',
  spanish: 'es',
  de: 'de',
  ger: 'de',
  deu: 'de',
  german: 'de',
  it: 'it',
  ita: 'it',
  italian: 'it',
  pt: 'pt',
  por: 'pt',
  ja: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
  zho: 'zh',
  ar: 'ar',
  ara: 'ar',
  ru: 'ru',
  rus: 'ru',
  nl: 'nl',
  dut: 'nl',
  nld: 'nl',
}

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  fr: 'Francais',
  en: 'Anglais',
  es: 'Espagnol',
  de: 'Allemand',
  it: 'Italien',
  pt: 'Portugais',
  ja: 'Japonais',
  ko: 'Coreen',
  zh: 'Chinois',
  ar: 'Arabe',
  ru: 'Russe',
  nl: 'Neerlandais',
}

const FLAG_LABELS: Readonly<Record<string, string>> = {
  forced: 'force',
  force: 'force',
  sdh: 'malentendants',
  cc: 'malentendants',
  hi: 'malentendants',
}

/**
 * What sits between the video name and the extension: "fr", "eng.forced",
 * "French"... -> language + label. Unknown words are kept in the label so two
 * files never end up with the same name.
 */
export function describeSubtitle(
  qualifier: string,
  fallbackIndex: number,
): {
  language: string | null
  label: string
} {
  const parts = qualifier
    .toLowerCase()
    .split(/[.\-_ ]+/)
    .filter(Boolean)
  let language: string | null = null
  const flags: string[] = []
  const others: string[] = []
  for (const part of parts) {
    if (!language && LANGUAGE_CODES[part]) language = LANGUAGE_CODES[part]
    else if (FLAG_LABELS[part]) flags.push(FLAG_LABELS[part])
    else others.push(part)
  }
  const base = language
    ? LANGUAGE_LABELS[language]
    : others.length > 0
      ? others.join(' ')
      : `Sous-titres ${fallbackIndex}`
  const extra = [...(language ? others : []), ...flags]
  return { language, label: extra.length > 0 ? `${base} (${extra.join(', ')})` : base }
}

/**
 * Pairs subtitle files with the videos of the same folder: "Film.fr.srt" goes
 * with "Film.mkv" (case-insensitive). The longest matching video name wins,
 * so "Film 2.srt" doesn't go to "Film.mkv". Returns video path -> its files.
 */
export function matchSubtitles(
  videos: readonly { path: string; baseName: string }[],
  subtitles: readonly { path: string; fileName: string }[],
): Map<string, { path: string; qualifier: string; format: SubtitleFormat }[]> {
  const byVideo = new Map<string, { path: string; qualifier: string; format: SubtitleFormat }[]>()
  const sorted = [...videos].sort((a, b) => b.baseName.length - a.baseName.length)
  for (const subtitle of subtitles) {
    const dot = subtitle.fileName.lastIndexOf('.')
    const format = subtitle.fileName.slice(dot + 1).toLowerCase() as SubtitleFormat
    const stem = subtitle.fileName.slice(0, dot)
    const lowerStem = stem.toLowerCase()
    const video = sorted.find((candidate) => {
      const base = candidate.baseName.toLowerCase()
      return lowerStem === base || lowerStem.startsWith(`${base}.`)
    })
    if (!video) continue
    const qualifier = stem.slice(video.baseName.length + 1)
    const list = byVideo.get(video.path) ?? []
    list.push({ path: subtitle.path, qualifier, format })
    byVideo.set(video.path, list)
  }
  return byVideo
}
