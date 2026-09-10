import { resolve } from 'node:path'
import { handler, reply } from './http'
import { Store } from './store'

export function listen(store: Store, port: number, clock?: () => number) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: handler(store, clock),
    // Bun's transport-generated 413 omits our privacy headers and bypasses error().
    // Enforce 16KiB in the streaming handler (including Content-Length precheck),
    // not by buffering an unlimited request or relying on that transport response.
    maxRequestBodySize: Infinity,
    idleTimeout: 5,
    development: false,
    error: () => reply(503),
  })
}

export function serverConfig(env: Record<string, string | undefined>) {
  const host = env.POSITION_FEED_HOST || '127.0.0.1'
  const port = env.POSITION_FEED_PORT || '3001'
  // No bypass flag, hostname resolution, wildcard binding or forwarded-header trust.
  if (host !== '127.0.0.1' || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Invalid configuration')
  }
  return {
    hostname: host,
    port: Number(port),
    db: env.POSITION_FEED_DB || resolve(import.meta.dir, '../state/position.sqlite'),
  }
}

if (import.meta.main) {
  let store: Store | undefined
  try {
    if (Bun.argv.length !== 2) throw new Error('Invalid arguments')
    const config = serverConfig(process.env)
    store = new Store(config.db)
    const server = listen(store, config.port)
    const stop = async () => {
      await server.stop(true)
      store?.close()
      process.exit(0)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch {
    store?.close()
    process.stderr.write('Position feed startup failed\n')
    process.exitCode = 1
  }
}