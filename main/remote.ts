import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { REMOTE_DEFAULT_PORT, type RemoteStatus } from '../shared/remote'

/**
 * Phone remote server (#1.1). Off by default, started from the Settings page.
 * It listens on every interface so a phone on the same Wi-Fi can reach it,
 * and refuses any request without the token generated at each start - a new
 * start invalidates the links/QR codes handed out before.
 *
 * Only the server and its access check live here: the player state and the
 * commands are relayed to the renderer in #1.2, the phone page comes in #1.3.
 */

let server: Server | null = null
let token: string | null = null
let lastError: string | null = null

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

function tokenFromRequest(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', 'http://remote.local')
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

/** constant time, so the token can't be guessed character by character */
function isValidToken(candidate: string | null): boolean {
  if (!token || !candidate) return false
  const expected = Buffer.from(token)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    // the token is in the URL: don't hand it to other sites through the Referer
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (!isValidToken(tokenFromRequest(request))) {
    send(response, 401, 'text/plain', 'EpiKodi : jeton manquant ou expire, rescanne le QR code.')
    return
  }
  const { pathname } = new URL(request.url ?? '/', 'http://remote.local')
  if (request.method === 'GET' && pathname === '/api/status') {
    send(response, 200, 'application/json', JSON.stringify({ app: 'EpiKodi' }))
    return
  }
  if (request.method === 'GET' && pathname === '/') {
    // placeholder until the remote page (#1.3)
    send(
      response,
      200,
      'text/html',
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<title>EpiKodi</title><body style="font-family:system-ui;padding:24px">' +
        '<h1>EpiKodi</h1><p>Connecte a EpiKodi. La telecommande arrive bientot.</p>',
    )
    return
  }
  send(response, 404, 'text/plain', 'Introuvable')
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
  return getRemoteStatus()
}

export async function stopRemote(): Promise<RemoteStatus> {
  const current = server
  server = null
  token = null
  lastError = null
  if (current) {
    // keep-alive connections would hold close() open - cut them, the token is gone anyway
    current.closeAllConnections()
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }
  return getRemoteStatus()
}
