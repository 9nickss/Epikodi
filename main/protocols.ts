import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_PROTOCOL } from '../shared/mediaUrl'

/**
 * Electron rejects file:// in <video>/<audio> when the page's own origin
 * isn't file:// (true for our http://localhost:5173 dev server, and still a
 * risk in prod). A custom protocol is the supported way to serve local files
 * to the renderer instead.
 *
 * Range requests are handled by hand (net.fetch on a file:// URL does *not*
 * forward them into a 206 response on its own) - <video> needs them to seek
 * without re-downloading the whole file.
 */
export { MEDIA_PROTOCOL, toMediaUrl } from '../shared/mediaUrl'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** must run before app.whenReady() */
export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

async function serveLocalFile(filePath: string, rangeHeader: string | null): Promise<Response> {
  const { size: fileSize } = await stat(filePath)
  const contentType = contentTypeFor(filePath)

  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null
  if (match) {
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : fileSize - 1
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: {
        'content-type': contentType,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${fileSize}`,
        'content-length': String(end - start + 1),
      },
    })
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'content-length': String(fileSize),
    },
  })
}

/** must run after app.whenReady() */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    return serveLocalFile(filePath, request.headers.get('range'))
  })
}
