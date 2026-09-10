import { Store, hashToken } from './store'
import { BODY_TIMEOUT_MS, MAX_BODY_BYTES, position, token } from './validation'

export function reply(status: number, value: unknown = { error: 'Request rejected' }): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

class BodyFailure extends Error {
  constructor(readonly status: number) { super('Request rejected') }
}

async function boundedJSON(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    void request.body?.cancel().catch(() => {})
    throw new BodyFailure(413)
  }
  if (!request.body) throw new BodyFailure(400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    const stop = (status: number) => {
      reject(new BodyFailure(status))
      void reader.cancel().catch(() => {})
    }
    timeout = setTimeout(() => stop(408), BODY_TIMEOUT_MS)
    onAbort = () => stop(400)
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
  })
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted])
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) throw new BodyFailure(413)
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new BodyFailure(400) }
  } finally {
    clearTimeout(timeout)
    if (onAbort) request.signal.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => {})
  }
}

export function handler(store: Store, clock = () => Math.floor(Date.now() / 1000)) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      if (url.pathname === '/health' && url.search === '' && request.method === 'GET') {
        return reply(200, { status: 'up' })
      }
      const match = /^\/agreements\/(0x[0-9a-f]{64})\/position$/.exec(url.pathname)
      if (!match || url.search || (request.method !== 'GET' && request.method !== 'PUT')) return reply(404)
      const id = match[1]!
      const role = request.method === 'GET' ? 'read' : 'write'
      const authorization = request.headers.get('authorization') ?? ''
      const rawToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
      // Malformed, unknown, revoked and wrong-slot credentials all share one response.
      const digest = hashToken(token(rawToken) ? rawToken : '')
      if (!store.authorized(id, role, digest)) return reply(401)
      if (role === 'read') {
        const result = store.access(id, role, digest, clock)
        return result.position ? reply(200, result.position) : reply(result.status)
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') ||
          request.headers.has('content-encoding')) return reply(415)
      const parsed = position(await boundedJSON(request), id, clock())
      if (!parsed) return reply(400)
      return reply(store.access(id, role, digest, clock, parsed).status)
    } catch (error) {
      // Never emit request URLs, headers, private bodies, database paths or raw exceptions.
      return reply(error instanceof BodyFailure ? error.status : 503)
    } finally {
      // Rejecting auth/routes/content types must not leave an unread upload running.
      if (request.body && !request.body.locked) void request.body.cancel().catch(() => {})
    }
  }
}