import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { getSubtitlePath } from './db'

/**
 * Subtitles for the <track> element (#3.2): HTML5 only reads WebVTT, so SRT
 * files are converted on the fly. Both are small text files, converted again
 * on each request rather than cached on disk.
 */

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
const TIMING = /(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3}/

/** most subtitle files are UTF-8, older French ones often Windows-1252 */
export function decodeSubtitle(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/** SRT -> WebVTT: header, and a dot instead of the comma in the timings ("00:01:02,500") */
export function srtToVtt(srt: string): string {
  const body = srt
    .split('\n')
    .map((line) => (TIMING.test(line) ? line.replace(/(\d),(\d)/g, '$1.$2') : line))
    .join('\n')
  return `WEBVTT\n\n${body.trim()}\n`
}

/** throws an explicit error when the file can't be used, never crashes the player */
export async function loadSubtitleAsVtt(trackId: number): Promise<string> {
  const filePath = getSubtitlePath(trackId)
  if (!filePath) throw new Error('Sous-titres introuvables (rescanne la source)')
  const info = await stat(filePath).catch(() => null)
  if (!info) throw new Error('Fichier de sous-titres supprime ou inaccessible')
  if (info.size > MAX_SUBTITLE_BYTES) throw new Error('Fichier de sous-titres trop gros')

  const text = decodeSubtitle(await readFile(filePath))
  if (!TIMING.test(text))
    throw new Error('Fichier de sous-titres illisible (aucun minutage trouve)')
  if (path.extname(filePath).toLowerCase() === '.vtt') {
    return text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`
  }
  return srtToVtt(text)
}
