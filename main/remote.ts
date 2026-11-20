import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'
import {
  EMPTY_REMOTE_STATE,
  parseRemoteCommand,
  REMOTE_DEFAULT_PORT,
  type RemotePlayerState,
  type RemoteStatus,
} from '../shared/remote'

/**
 * Phone remote server (#1). Off by default, started from the Settings page.
 * It listens on every interface so a phone on the same Wi-Fi can reach it,
 * and refuses any request without the token generated at each start - a new
 * start invalidates the links/QR codes handed out before.
 *
 * The player lives in the renderer: the main process only relays. The
 * renderer publishes its state (remote:publish-state), streamed to the phones
 * as Server-Sent Events; phone commands (POST /api/command) are forwarded to
 * the renderer (remote:command), which applies them with usePlayerControls.
 *
 * The phone page itself is static (remote/ next to package.json, #1.3).
 */

const COOKIE_NAME = 'epikodi_remote'
const HEARTBEAT_MS = 20_000
const MAX_BODY_BYTES = 2048

const pageDirectory = (): string => path.join(__dirname, '../../remote')
const PAGE_FILES: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/remote.css': 'remote.css',
  '/remote.js': 'remote.js',
  '/icon.svg': 'icon.svg',
}
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
}

let server: Server | null = null
let token: string | null = null
let lastError: string | null = null
let heartbeat: NodeJS.Timeout | null = null
/** phones listening to /api/events */
const clients = new Set<ServerResponse>()
let playerState: RemotePlayerState = EMPTY_REMOTE_STATE
/** the window whose player publishes the state - commands go back to it */
let playerWindow: WebContents | null = null

/** 192.168/16, 10/8 and 172.16/12 - what a home Wi-Fi hands out */
function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

export function lanAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  // Docker/VPN bridges also have private addresses, but a Wi-Fi one usually comes first
  return [...found.filter(isPrivateIpv4), ...found.filter((address) => !isPrivateIpv4(address))]
}

function cookieToken(request: IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE_NAME) return value.join('=')
  }
  return null
}

/** ?token= (the QR code link), then the cookie set from it, then a Bearer header */
function tokenFromRequest(request: IncomingMessage, url: URL): string | null {
  const header = request.headers.authorization
  return (
    url.searchParams.get('token') ??
    cookieToken(request) ??
    (header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null)
  )
}

/** constant time, so the token can't be guessed character by character */
function isValidToken(candidate: string | null): boolean {
  if (!token || !candidate) return false
  const expected = Buffer.from(token)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  // the token can be in the URL: don't hand it to other sites through the Referer
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': `${type}; charset=utf-8`,
    ...headers,
  })
  response.end(body)
}

function notifyStatusChanged(): void {
  const status = getRemoteStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send('remote:status-changed', status)
  }
}

function writeEvent(client: ServerResponse, event: string, data: unknown): void {
  client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function openEventStream(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    ...BASE_HEADERS,
    'content-type': 'text/event-stream; charset=utf-8',
    connection: 'keep-alive',
  })
  // EventSource reconnects on its own after a drop, 2 s later
  response.write('retry: 2000\n\n')
  writeEvent(response, 'state', playerState)
  clients.add(response)
  notifyStatusChanged()
  request.on('close', () => {
    clients.delete(response)
    notifyStatusChanged()
  })
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function handleCommand(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // a JSON content type can't be sent cross-site without a CORS preflight, which is never granted
  if (!request.headers['content-type']?.startsWith('application/json')) {
    send(response, 415, 'text/plain', 'JSON attendu')
    return
  }
  let command
  try {
    command = parseRemoteCommand(JSON.parse(await readBody(request)))
  } catch {
    command = null
  }
  if (!command) {
    send(response, 400, 'text/plain', 'Commande invalide')
    return
  }
  const target =
    playerWindow && !playerWindow.isDestroyed()
      ? playerWindow
      : BrowserWindow.getAllWindows()[0]?.webContents
  if (!target || playerState.title === null) {
    send(response, 409, 'text/plain', 'Rien en lecture')
    return
  }
  target.send('remote:command', command)
  response.writeHead(204, BASE_HEADERS).end()
}

async function servePageFile(
  response: ServerResponse,
  file: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const body = await readFile(path.join(pageDirectory(), file))
    send(response, 200, CONTENT_TYPES[path.extname(file)] ?? 'text/plain', body, {
      'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      ...headers,
    })
  } catch {
    send(response, 500, 'text/plain', `Page de telecommande introuvable (${file})`)
  }
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://remote.local')
  const candidate = tokenFromRequest(request, url)
  if (!isValidToken(candidate)) {
    send(
      response,
      401,
      'text/plain',
      'EpiKodi : code expire, rescanne le QR code dans les Reglages.',
    )
    return
  }
  const { pathname } = url

  if (request.method === 'GET' && pathname === '/api/events') {
    openEventStream(request, response)
    return
  }
  if (request.method === 'POST' && pathname === '/api/command') {
    void handleCommand(request, response)
    return
  }
  if (request.method === 'GET' && pathname === '/api/status') {
    send(response, 200, 'application/json', JSON.stringify({ app: 'EpiKodi' }))
    return
  }
  const file = request.method === 'GET' ? PAGE_FILES[pathname] : undefined
  if (file) {
    // from the QR code link: keep the token in a cookie so the page, its files and the
    // event stream work without it in the URL (the page then removes it from the address bar)
    const headers: Record<string, string> = url.searchParams.has('token')
      ? { 'set-cookie': `${COOKIE_NAME}=${candidate}; HttpOnly; SameSite=Strict; Path=/` }
      : {}
    void servePageFile(response, file, headers)
    return
  }
  send(response, 404, 'text/plain', 'Introuvable')
}

/** called by the renderer, throttled on its side */
export function publishPlayerState(sender: WebContents, state: RemotePlayerState): void {
  playerWindow = sender
  playerState = state
  for (const client of clients) writeEvent(client, 'state', state)
}

export function getRemoteStatus(): RemoteStatus {
  const address = server?.address()
  const port = address && typeof address === 'object' ? address.port : null
  const addresses = lanAddresses()
  return {
    running: server !== null && port !== null,
    port,
    addresses,
    url:
      port !== null && token && addresses[0]
        ? `http://${addresses[0]}:${port}/?token=${token}`
        : null,
    error: lastError,
    clients: clients.size,
  }
}

function listen(target: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    target.once('error', onError)
    // 0.0.0.0, not localhost: the phone connects through the LAN address
    target.listen(port, '0.0.0.0', () => {
      target.off('error', onError)
      resolve()
    })
  })
}

export async function startRemote(): Promise<RemoteStatus> {
  if (server) return getRemoteStatus()
  lastError = null
  const next = createServer(handleRequest)
  try {
    await listen(next, REMOTE_DEFAULT_PORT).catch((error: NodeJS.ErrnoException) => {
      // port taken (another EpiKodi, another app): let the OS pick a free one
      if (error.code === 'EADDRINUSE') return listen(next, 0)
      throw error
    })
  } catch (error) {
    next.close()
    lastError = `Demarrage impossible : ${error instanceof Error ? error.message : String(error)}`
    return getRemoteStatus()
  }
  token = randomBytes(18).toString('base64url')
  server = next
  // proxies and phones drop silent connections - a comment line keeps the stream open
  heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n')
  }, HEARTBEAT_MS)
  return getRemoteStatus()
}

export async function stopRemote(): Promise<RemoteStatus> {
  const current = server
  server = null
  token = null
  lastError = null
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  for (const client of clients) client.end()
  clients.clear()
  if (current) {
    // keep-alive connections would hold close() open - cut them, the token is gone anyway
    current.closeAllConnections()
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }
  return getRemoteStatus()
}
