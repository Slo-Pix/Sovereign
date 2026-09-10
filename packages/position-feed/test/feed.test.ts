import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { handler } from '../src/http'
import { operate } from '../src/operator'
import { listen, serverConfig } from '../src/server'
import { Store, hashToken } from '../src/store'
import { BODY_TIMEOUT_MS, credentials, type Credential, type Position } from '../src/validation'

const id = `0x${'a'.repeat(64)}`
const other = `0x${'b'.repeat(64)}`
const readToken = randomBytes(32).toString('base64url')
const writeToken = randomBytes(32).toString('base64url')
const wrongToken = randomBytes(32).toString('base64url')
const initialNow = 1800000000
const operator = resolve(import.meta.dir, '../src/operator.ts')
const worker = resolve(import.meta.dir, 'worker.ts')
let directory: string
let dbPath: string
let store: Store
let now: number
let serve: ReturnType<typeof handler>
const cleanups: Array<() => void> = []

function entry(role: 'read' | 'write', overrides: Partial<Credential> = {}): Credential {
  return { agreementId: id, role, token: role === 'read' ? readToken : writeToken, capacity: 100, windowSeconds: 60, ...overrides }
}
function config(...items: Credential[]) { return { credentials: items } }
function observation(overrides: Partial<Position> = {}): Position {
  return { agreementId: id, currentLossBps: 180, elapsedSeconds: 10, timestamp: now, ...overrides }
}
function request(method = 'GET', auth: string | null = readToken, data?: unknown, agreement = id): Request {
  const headers: Record<string, string> = {}
  if (auth !== null) headers.Authorization = `Bearer ${auth}`
  if (data !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(`http://127.0.0.1/agreements/${agreement}/position`, {
    method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  })
}
async function put(value: unknown = observation(), auth = writeToken) { return serve(request('PUT', auth, value)) }
async function get(auth: string | null = readToken, agreement = id) { return serve(request('GET', auth, undefined, agreement)) }
function configFile(value: unknown, name = 'credentials.config.json'): string {
  const path = join(directory, name)
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
  return path
}
function cli(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([process.execPath, '--no-env-file', operator, ...args], {
    env, stdout: 'pipe', stderr: 'pipe',
  })
}
async function child(role: 'read' | 'write', value?: Position): Promise<number> {
  const process = Bun.spawn([Bun.which('bun')!, '--no-env-file', worker], {
    env: {
      TEST_DB: dbPath, TEST_ID: id, TEST_ROLE: role, TEST_NOW: String(now),
      TEST_TOKEN: role === 'read' ? readToken : writeToken,
      ...(value ? { TEST_POSITION: JSON.stringify(value) } : {}),
    }, stdout: 'pipe', stderr: 'pipe',
  })
  const output = await new Response(process.stdout).text()
  expect(await process.exited).toBe(0)
  expect(await new Response(process.stderr).text()).toBe('')
  return Number(output)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'position-feed-test-'))
  dbPath = join(directory, 'state', 'position.sqlite')
  now = initialNow
  store = new Store(dbPath)
  store.provision(config(entry('read'), entry('write')))
  serve = handler(store, () => now)
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('authentication and privacy', () => {
  test('no anonymous access; unknown ID, malformed, wrong and wrong-agreement tokens are indistinguishable', async () => {
    const responses = await Promise.all([get(null), get(wrongToken), get(readToken, other), get('short'), get(writeToken)])
    for (const response of responses) {
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Request rejected"}')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('www-authenticate')).toBeNull()
    }
  })

  test('read token cannot write, writer cannot read; each token is bound to exactly one agreement', async () => {
    expect((await put(observation(), readToken)).status).toBe(401)
    expect((await get(writeToken)).status).toBe(401)
    expect((await serve(request('PUT', writeToken, observation({ agreementId: other }), other))).status).toBe(401)
    expect((await put()).status).toBe(204)
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(observation())
  })

  test('health is process-up only, independent of authentication, freshness and existence', async () => {
    const response = await serve(new Request('http://127.0.0.1/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'up' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await get()).status).toBe(503)
  })

  test('no config/admin/list/static routes, CORS or alternate methods', async () => {
    for (const path of ['/agreements', '/config', '/admin', '/.env', '/state/position.sqlite', '/health?details=1',
      `/agreements/${id.toUpperCase()}/position`, `/agreements/${id}/position/`, `/agreements/${id}/position?token=${readToken}`]) {
      const response = await serve(new Request(`http://127.0.0.1${path}`))
      expect(response.status).toBe(404)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(await response.text()).toBe('{"error":"Request rejected"}')
    }
    for (const method of ['POST', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect((await serve(request(method))).status).toBe(404)
    }
  })

  test('no secrets or policy in success/error headers and error bodies', async () => {
    const responses = [await put(), await get(), await get(wrongToken), await put({ ...observation(), policy: 'private-policy-marker' })]
    for (const response of responses) {
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      const output = JSON.stringify([...response.headers]) + await response.text()
      for (const secret of [readToken, writeToken, wrongToken, 'private-policy-marker', 'threshold', dbPath]) {
        expect(output).not.toContain(secret)
      }
      for (const header of ['location', 'set-cookie', 'access-control-allow-origin', 'etag', 'last-modified']) {
        expect(response.headers.get(header)).toBeNull()
      }
    }
  })

  test('fixed-size native hash comparison and only token hashes persisted', async () => {
    await put()
    await get()
    const db = new Database(dbPath, { readonly: true })
    try {
      expect(db.query('SELECT hash FROM credentials ORDER BY role').all()).toEqual([
        { hash: hashToken(readToken) }, { hash: hashToken(writeToken) },
      ])
    } finally { db.close() }
    for (const suffix of ['', '-wal', '-shm']) {
      if (!existsSync(dbPath + suffix)) continue
      const contents = readFileSync(dbPath + suffix)
      expect(contents.includes(Buffer.from(readToken))).toBe(false)
      expect(contents.includes(Buffer.from(writeToken))).toBe(false)
      expect(lstatSync(dbPath + suffix).mode & 0o777).toBe(0o600)
    }
    expect(lstatSync(join(directory, 'state')).mode & 0o777).toBe(0o700)
  })
})

describe('observation validation and replay resistance', () => {
  test('exact four-field response; timestamp remains unchanged on reads and restart', async () => {
    const value = observation({ timestamp: now - 5 })
    expect((await put(value)).status).toBe(204)
    now += 10
    expect(await (await get()).json()).toEqual(value)
    store.close()
    store = new Store(dbPath)
    serve = handler(store, () => now)
    expect(await (await get()).json()).toEqual(value)
    now += 16
    expect((await get()).status).toBe(503)
  })

  test('freshness boundary accepts 30 seconds, rejects 31 and future on both read and write', async () => {
    expect((await put(observation({ timestamp: now - 31 }))).status).toBe(400)
    expect((await put(observation({ timestamp: now + 1 }))).status).toBe(400)
    expect((await put(observation({ timestamp: now - 30 }))).status).toBe(204)
    expect((await get()).status).toBe(200)
    now++
    expect((await get()).status).toBe(503)
    now -= 32
    expect((await get()).status).toBe(503)
  })

  test('strict timestamp increase, nondecreasing elapsed, changed-content replay and persistence', async () => {
    expect((await put()).status).toBe(204)
    expect((await put()).status).toBe(409)
    expect((await put(observation({ currentLossBps: 999 }))).status).toBe(409)
    expect((await put(observation({ timestamp: now - 1 }))).status).toBe(409)
    now++
    expect((await put(observation({ elapsedSeconds: 9 }))).status).toBe(409)
    expect((await put(observation({ currentLossBps: 0 }))).status).toBe(204)
    expect(await (await get()).json()).toEqual(observation({ currentLossBps: 0 }))
    store.close()
    store = new Store(dbPath)
    serve = handler(store, () => now)
    expect((await put()).status).toBe(409)
  })

  test('rejects missing/extra fields, other IDs, arrays and non-safe nonnegative integers', async () => {
    const invalid: unknown[] = [null, [], {}, { ...observation(), extra: true }, observation({ agreementId: other })]
    for (const field of ['currentLossBps', 'elapsedSeconds', 'timestamp']) {
      for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '12', null, true]) {
        invalid.push({ ...observation(), [field]: value })
      }
      const missing: Record<string, unknown> = { ...observation() }
      delete missing[field]
      invalid.push(missing)
    }
    for (const value of invalid) expect((await put(value)).status).toBe(400)
    expect((await get()).status).toBe(503)
    expect((await put(observation({ currentLossBps: Number.MAX_SAFE_INTEGER, elapsedSeconds: Number.MAX_SAFE_INTEGER }))).status).toBe(204)
  })

  test('malformed JSON, invalid UTF8, non-JSON content and compressed bodies fail generically', async () => {
    for (const body of ['{"token":"' + readToken, '{"currentLossBps":NaN}', new Uint8Array([255])]) {
      const response = await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
        method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' }, body,
      }))
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"error":"Request rejected"}')
    }
    for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }]) {
      expect((await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
        method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, ...headers }, body: '{}',
      }))).status).toBe(415)
    }
  })

  test('16KiB streaming cap cancels even when content length is missing or understated', async () => {
    for (const declared of [undefined, '1', '999999']) {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(8193)) },
        cancel() { cancelled = true },
      })
      const headers: Record<string, string> = { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' }
      if (declared) headers['Content-Length'] = declared
      const response = await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, { method: 'PUT', headers, body }))
      expect(response.status).toBe(413)
      expect(cancelled).toBe(true)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('exactly 16KiB valid JSON accepted; one extra byte rejected', async () => {
    const json = JSON.stringify(observation())
    for (const size of [16384, 16385]) {
      const response = await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
        method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        body: json + ' '.repeat(size - json.length),
      }))
      expect(response.status).toBe(size === 16384 ? 204 : 413)
    }
  })

  test('stalled body times out and is cancelled', async () => {
    let cancelled = false
    const response = await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
      method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      body: new ReadableStream({ cancel() { cancelled = true } }),
    }))
    expect(response.status).toBe(408)
    expect(cancelled).toBe(true)
  }, BODY_TIMEOUT_MS + 2000)

  test('aborted body cancels without partial writes', async () => {
    const controller = new AbortController()
    let cancelled = false
    const result = serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
      method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      signal: controller.signal, body: new ReadableStream({ cancel() { cancelled = true } }),
    }))
    controller.abort()
    expect((await result).status).toBe(400)
    expect(cancelled).toBe(true)
    expect((await get()).status).toBe(503)
  })

  test('revocation during body streaming wins final transactional authentication', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const result = serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
      method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      body: new ReadableStream({ start(controller) { streamController = controller } }),
    }))
    const second = new Store(dbPath)
    try { second.revoke(id, 'write') } finally { second.close() }
    streamController.enqueue(new TextEncoder().encode(JSON.stringify(observation())))
    streamController.close()
    expect((await result).status).toBe(401)
    expect((await get()).status).toBe(503)
  })

  test('freshness is checked again inside the write transaction', async () => {
    let calls = 0
    serve = handler(store, () => calls++ === 0 ? now : now + 31)
    expect((await put()).status).toBe(400)
  })
})

describe('durable quotas and concurrent processes', () => {
  function limit(readCapacity: number, writeCapacity: number) {
    // Fresh DB for custom capacities, without rotating test tokens/reusing historical hashes.
    store.close()
    dbPath = join(directory, 'limited', 'position.sqlite')
    store = new Store(dbPath)
    store.provision(config(entry('read', { capacity: readCapacity }), entry('write', { capacity: writeCapacity })))
    serve = handler(store, () => now)
  }

  test('read/write capacities separate; unauthorized requests never consume legitimate quota', async () => {
    limit(2, 1)
    for (let i = 0; i < 5; i++) {
      expect((await get(wrongToken)).status).toBe(401)
      expect((await put(observation(), readToken)).status).toBe(401)
    }
    expect((await put()).status).toBe(204)
    expect((await put()).status).toBe(429)
    expect((await get()).status).toBe(200)
    expect((await get()).status).toBe(200)
    expect((await get()).status).toBe(429)
  })

  test('quota survives restart, advances fixed windows, and cannot reset on clock rollback', async () => {
    limit(1, 10)
    expect((await get()).status).toBe(503)
    store.close()
    store = new Store(dbPath)
    serve = handler(store, () => now)
    expect((await get()).status).toBe(429)
    now -= 60
    expect((await get()).status).toBe(429)
    now += 120
    expect((await get()).status).toBe(503)
    expect((await get()).status).toBe(429)
  })

  test('independent agreement quotas do not interfere', async () => {
    limit(1, 10)
    store.provision(config(entry('read', { agreementId: other, token: wrongToken, capacity: 1 })))
    expect((await get()).status).toBe(503)
    expect((await get()).status).toBe(429)
    expect((await get(wrongToken, other)).status).toBe(503)
    expect((await get(wrongToken, other)).status).toBe(429)
  })

  test('simultaneous independent processes cannot overdraw quota', async () => {
    limit(3, 10)
    await put()
    const statuses = await Promise.all(Array.from({ length: 8 }, () => child('read')))
    expect(statuses.filter(status => status === 200)).toHaveLength(3)
    expect(statuses.filter(status => status === 429)).toHaveLength(5)
    expect((await get()).status).toBe(429)
  }, 15000)

  test('simultaneous independent writers accept one replay candidate only', async () => {
    const statuses = await Promise.all(Array.from({ length: 6 }, () => child('write', observation())))
    expect(statuses.filter(status => status === 204)).toHaveLength(1)
    expect(statuses.filter(status => status === 409)).toHaveLength(5)
    expect(await (await get()).json()).toEqual(observation())
  }, 15000)
})

describe('offline operator and secure deployment', () => {
  test('CLI provision using arguments and environment; stdout never contains credentials', () => {
    for (const useEnv of [false, true]) {
      const target = join(directory, useEnv ? 'env' : 'args', 'feed.sqlite')
      const path = configFile(config(entry('read'), entry('write')))
      const result = useEnv
        ? cli(['provision'], { POSITION_FEED_DB: target, POSITION_FEED_CREDENTIAL_CONFIG: path })
        : cli(['provision', '--db', target, '--config', path])
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe('Operation completed\n')
      expect(result.stderr.toString()).toBe('')
      const check = new Store(target)
      try {
        expect(check.authorized(id, 'read', hashToken(readToken))).toBe(true)
        expect(check.authorized(id, 'write', hashToken(writeToken))).toBe(true)
      } finally { check.close() }
    }
  })

  test('invalid complete config fails before DB creation, with no partial provisioning', () => {
    const target = join(directory, 'never-created', 'feed.sqlite')
    const path = configFile(config(entry('read'), entry('write', { capacity: 0 })))
    const result = cli(['provision', '--db', target, '--config', path])
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toBe('Operation failed\n')
    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(directory, 'never-created'))).toBe(false)
  })

  test('transaction rolls back earlier rows when a later existing slot conflicts', () => {
    expect(() => store.provision(config(entry('read', { agreementId: other, token: wrongToken }), entry('write')))).toThrow()
    expect(store.authorized(other, 'read', hashToken(wrongToken))).toBe(false)
  })

  test('rotation only changes selected role and rejects old/reused keys', async () => {
    await put()
    const path = configFile(config(entry('read', { token: wrongToken })))
    const result = cli(['rotate', '--db', dbPath, '--config', path])
    expect(result.exitCode).toBe(0)
    expect((await get()).status).toBe(401)
    expect((await get(wrongToken)).status).toBe(200)
    now++
    expect((await put()).status).toBe(204)
    expect(() => store.provision(config(entry('read')), true)).toThrow()
    expect(() => store.provision(config(entry('write', { token: wrongToken })), true)).toThrow()
    expect((await get(wrongToken)).status).toBe(200)
  })

  test('writer rotation preserves read key and observation replay history', async () => {
    await put()
    const path = configFile(config(entry('write', { token: wrongToken })))
    expect(cli(['rotate', '--db', dbPath, '--config', path]).exitCode).toBe(0)
    expect((await put()).status).toBe(401)
    expect((await put(observation(), wrongToken)).status).toBe(409)
    expect((await get()).status).toBe(200)
    now++
    expect((await put(observation(), wrongToken)).status).toBe(204)
  })

  test('offline revoke immediately visible across connections and after restart, role-specific and idempotent', async () => {
    await put()
    for (let i = 0; i < 2; i++) {
      expect(cli(['revoke', '--db', dbPath, '--agreement', id, '--role', 'read']).exitCode).toBe(0)
    }
    expect((await get()).status).toBe(401)
    now++
    expect((await put()).status).toBe(204)
    store.close()
    store = new Store(dbPath)
    serve = handler(store, () => now)
    expect((await get()).status).toBe(401)
    expect(() => store.provision(config(entry('read')))).toThrow()
    store.provision(config(entry('read', { token: wrongToken })))
    expect((await get(wrongToken)).status).toBe(200)
  })

  test('strict config rejects duplicate roles/tokens, token whitespace, policy and incorrect types', () => {
    const invalid = [config(entry('read'), entry('read', { token: wrongToken })),
      config(entry('read'), entry('write', { token: readToken })), config(entry('read', { token: readToken + '\n' })),
      config(entry('read', { token: 'short' })), config(entry('read', { token: 'x'.repeat(4097) })),
      config(entry('read', { agreementId: id.toUpperCase() })), config(entry('read', { windowSeconds: 0 })),
      { ...config(entry('read')), policy: {} }, { credentials: [] }]
    for (const value of invalid) expect(() => credentials(value)).toThrow()
  })

  test('CLI refuses permissive/symlinked config, unknown options and token arguments without leaks', () => {
    const path = configFile(config(entry('read')))
    chmodSync(path, 0o644)
    expect(cli(['provision', '--db', dbPath, '--config', path]).exitCode).toBe(1)
    chmodSync(path, 0o600)
    const link = join(directory, 'link.config.json')
    symlinkSync(path, link)
    expect(cli(['provision', '--db', dbPath, '--config', link]).exitCode).toBe(1)
    const result = cli(['provision', '--token', readToken])
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toBe('Operation failed\n')
    expect(() => operate(['revoke', '--db', dbPath, '--agreement', id, '--role', 'admin'], {})).toThrow()
  })

  test('state refuses insecure directory, database symlinks and WAL symlinks', () => {
    chmodSync(join(directory, 'state'), 0o755)
    expect(() => new Store(dbPath)).toThrow()
    chmodSync(join(directory, 'state'), 0o700)
    const alias = join(directory, 'alias.sqlite')
    symlinkSync(dbPath, alias)
    expect(() => new Store(alias)).toThrow()
    const fresh = join(directory, 'fresh.sqlite')
    symlinkSync(join(directory, 'missing'), fresh + '-wal')
    expect(() => new Store(fresh)).toThrow()
  })

  test('loopback only, strict ports; no insecure deployment bypass', () => {
    expect(serverConfig({}).hostname).toBe('127.0.0.1')
    expect(serverConfig({}).port).toBe(3001)
    for (const host of ['0.0.0.0', '::', '::1', 'localhost', 'example.com', '192.168.1.2']) {
      expect(() => serverConfig({ POSITION_FEED_HOST: host })).toThrow()
    }
    for (const port of ['0', '-1', '65536', '3.1', ' 3001', 'NaN']) {
      expect(() => serverConfig({ POSITION_FEED_PORT: port })).toThrow()
    }
  })

  test('real HTTP roundtrip accepts the CRE bearer format with exact JSON and no-store', async () => {
    const server = listen(store, 0, () => now)
    cleanups.push(() => { void server.stop(true) })
    const url = `http://127.0.0.1:${server.port}/agreements/${id}/position`
    const write = await fetch(url, { method: 'PUT', headers: {
      Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(observation()) })
    expect(write.status).toBe(204)
    const read = await fetch(url, { headers: { Authorization: `Bearer ${readToken}`, Accept: 'application/json', 'Cache-Control': 'no-store' } })
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('application/json')
    expect(read.headers.get('cache-control')).toBe('no-store')
    expect(await read.json()).toEqual(observation())
  })

  test('real HTTP large uploads receive generic no-store errors rather than transport-generated errors', async () => {
    const server = listen(store, 0, () => now)
    cleanups.push(() => { void server.stop(true) })
    for (const size of [16385, 65536, 1024 * 1024]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/agreements/${id}/position`, {
        method: 'PUT', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        body: 'x'.repeat(size),
      })
      expect(response.status).toBe(413)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'Request rejected' })
    }
  })

  test('unauthorized uploads are cancelled before parsing and do not affect observation state', async () => {
    let cancelled = false
    const response = await serve(new Request(`http://127.0.0.1/agreements/${id}/position`, {
      method: 'PUT', headers: { Authorization: `Bearer ${readToken}` },
      body: new ReadableStream({ cancel() { cancelled = true } }),
    }))
    expect(response.status).toBe(401)
    expect(cancelled).toBe(true)
    expect((await get()).status).toBe(503)
  })

  test('server entrypoint refuses non-loopback before creating state and prints only a generic error', () => {
    const target = join(directory, 'not-created', 'feed.sqlite')
    const result = Bun.spawnSync([process.execPath, '--no-env-file', resolve(import.meta.dir, '../src/server.ts')], {
      env: { POSITION_FEED_HOST: '0.0.0.0', POSITION_FEED_DB: target }, stdout: 'pipe', stderr: 'pipe',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toBe('Position feed startup failed\n')
    expect(existsSync(target)).toBe(false)
  })

  test('server process starts without env-file reads, serves persisted state across restart and exits silently', async () => {
    // Synthetic decoy: loading this cwd's .env would cause startup to fail.
    writeFileSync(join(directory, '.env'), 'POSITION_FEED_HOST=0.0.0.0\n', { mode: 0o600 })
    now = Math.floor(Date.now() / 1000)
    const value = observation()
    expect((await put(value)).status).toBe(204)
    for (let restart = 0; restart < 2; restart++) {
      const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
      const port = reservation.port!
      await reservation.stop(true)
      const child = Bun.spawn([process.execPath, '--no-env-file', resolve(import.meta.dir, '../src/server.ts')], {
        cwd: directory, env: { POSITION_FEED_DB: dbPath, POSITION_FEED_PORT: String(port) },
        stdout: 'pipe', stderr: 'pipe',
      })
      try {
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(100) })
            if (health.status === 200) {
              expect(await health.json()).toEqual({ status: 'up' })
              ready = true
              break
            }
          } catch { /* bounded readiness check against a test-owned local listener */ }
          await Bun.sleep(10)
        }
        expect(ready).toBe(true)
        const url = `http://127.0.0.1:${port}/agreements/${id}/position`
        expect((await fetch(url)).status).toBe(401)
        const response = await fetch(url, { headers: { Authorization: `Bearer ${readToken}` } })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(value)
      } finally {
        child.kill('SIGTERM')
        expect(await child.exited).toBe(0)
        expect(await new Response(child.stdout).text()).toBe('')
        expect(await new Response(child.stderr).text()).toBe('')
      }
    }
  }, 10000)
})