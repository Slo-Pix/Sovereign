import { reply } from './http'

const POSITION_PATH = /^\/agreements\/0x[0-9a-f]{64}\/position$/
const RESPONSE_LIMIT = 16 * 1024
type RequestFn = (input: string, init: RequestInit) => Promise<Response>

export function gatewayConfig(env: Record<string, string | undefined>) {
  const origin = new URL(env.POSITION_FEED_PRIVATE_ORIGIN || 'http://127.0.0.1:3111')
  const port = env.POSITION_FEED_PUBLIC_PORT || '3112'
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/'
      || origin.search || origin.hash || !origin.port || !/^\d+$/.test(port)
      || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid configuration')
  return { origin: origin.origin, port: Number(port) }
}

export function publicHandler(origin: string, requestFn: RequestFn = fetch) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const position = POSITION_PATH.test(url.pathname)
      if (request.method !== 'GET' || url.search || (url.pathname !== '/health' && !position)) return reply(404)
      const authorization = request.headers.get('authorization')
      const init: RequestInit = { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000) }
      if (position && authorization) init.headers = { Authorization: authorization }
      const upstream = await requestFn(`${origin}${url.pathname}`, init)
      if (upstream.status >= 300 && upstream.status < 400) return reply(503)
      const body = await upstream.arrayBuffer()
      if (body.byteLength > RESPONSE_LIMIT || !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type') || '')) {
        return reply(503)
      }
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      })
    } catch {
      return reply(503)
    }
  }
}

if (import.meta.main) {
  try {
    if (Bun.argv.length !== 2) throw new Error('Invalid arguments')
    const config = gatewayConfig(process.env)
    Bun.serve({
      hostname: '127.0.0.1',
      port: config.port,
      fetch: publicHandler(config.origin),
      idleTimeout: 5,
      development: false,
      error: () => reply(503),
    })
  } catch {
    process.stderr.write('Position feed public gateway startup failed\n')
    process.exitCode = 1
  }
}
