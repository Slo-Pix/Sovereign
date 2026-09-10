import { describe, expect, test } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import type { HTTP_CLIENT_PB } from '@chainlink/cre-sdk/pb'
import example from '../sovereign/config.example.json'
import { configSchema, type Config } from '../src/config'
import { positionEndpoint } from '../src/position-endpoint'
import { readPrivatePosition } from '../src/position'
import { executeCheck, type WorkflowPorts } from '../src/handler'
import { hashPolicy, hashTerms } from '../../core/src/index'
import vectors from '../../core/fixtures/vectors.json'
import { policySchema, termsSchema } from '../src/domain'

const id = `0x${'bb'.repeat(32)}` as const
const otherId = `0x${'cc'.repeat(32)}` as const
const now = 1799999990
const syntheticToken = 'synthetic-test-token-not-a-real-credential-0123456789'
function harness() {
  const config = configSchema.parse({ ...example, agreementId: id, terms: vectors.terms })
  const calls: HTTP_CLIENT_PB.Request[] = []
  const secretIds: string[] = []
  const logs: string[] = []
  const credential = { origin: config.positionOrigin, agreementId: id, token: syntheticToken }
  const position = { agreementId: id, currentLossBps: 310, elapsedSeconds: 10, timestamp: now }
  const response = { statusCode: 200, body: new TextEncoder().encode(JSON.stringify(position)),
    multiHeaders: { 'Content-Type': { values: ['application/json'] } } as Record<string, { values: string[] }> }
  const runtime = {
    config, now: () => new Date(now * 1000),
    getSecret: (request: { id: string }) => {
      secretIds.push(request.id)
      return { result: () => ({ value: JSON.stringify(credential) }) }
    },
    callCapability: ({ payload }: { payload: HTTP_CLIENT_PB.Request }) => {
      calls.push(payload)
      return { result: () => response }
    },
    log: (message: string) => logs.push(message),
    usingTheDons: () => { throw new Error('Private feed must not cross to DON runtime') },
  } as unknown as TeeRuntime<Config>
  return { config, runtime, credential, response, position, calls, secretIds, logs }
}

describe('endpoint binding', () => {
  test('derives exact agreement route, no caller-controlled path or query', () => {
    expect(positionEndpoint('https://feed.example.com', id)).toBe(`https://feed.example.com/agreements/${id}/position`)
    expect(positionEndpoint('https://feed.example.com:8443', id.toUpperCase().replace('0X', '0x')))
      .toBe(`https://feed.example.com:8443/agreements/${id}/position`)
  })
  test('rejects credentials, redirects-as-query, paths, encoded/ambiguous hosts and plaintext by default', () => {
    for (const origin of ['https://user:pass@feed.example.com', 'https://feed.example.com/',
      'https://feed.example.com?next=https://evil.test', 'https://feed.example.com#fragment',
      'https://feed.example.com\\@evil.test', 'https://feed%2eexample.com', 'https://127.0.0.1',
      'https://2130706433', 'http://feed.example.com', 'http://127.0.0.1:3001',
      'https://feed.example.com:65536', 'https://feed.example.com:0', 'https://feed..example.com',
      'https://feed.example.com.', 'https://-feed.example.com', 'https://FEED.example.com', 'https://feed.example.com\n']) {
      expect(configSchema.safeParse({ ...example, positionOrigin: origin }).success).toBe(false)
    }
  })
  test('loopback is explicit simulation-only and rejects Sepolia delivery', () => {
    const config = { ...example, positionOrigin: 'http://127.0.0.1:3001', allowInsecurePositionLoopback: true }
    expect(configSchema.safeParse(config).success).toBe(true)
    expect(configSchema.safeParse({ ...config, delivery: 'sepolia', reportReceiver: `0x${'44'.repeat(20)}` }).success).toBe(false)
    expect(configSchema.safeParse({ ...config, positionOrigin: 'http://localhost:3001' }).success).toBe(false)
  })
  test('public config takes only a separate credential secret ID', () => {
    expect(configSchema.safeParse({ ...example, positionAuthSecretId: undefined }).success).toBe(false)
    expect(configSchema.safeParse({ ...example, positionAuthSecretId: example.policySecretId }).success).toBe(false)
    expect(configSchema.safeParse({ ...example, positionToken: syntheticToken }).success).toBe(false)
    expect(configSchema.safeParse({ ...example, positionUrl: 'https://evil.test/' }).success).toBe(false)
  })
})

test('TEE-only credential fetch produces scoped GET header; disables cache and bounds timeout', () => {
  const { runtime, position, calls, secretIds, logs, config } = harness()
  expect(readPrivatePosition(runtime)).toEqual(position)
  expect(secretIds).toEqual([config.positionAuthSecretId])
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe(`${config.positionOrigin}/agreements/${id}/position`)
  expect(calls[0].method).toBe('GET')
  expect(calls[0].multiHeaders.Authorization.values).toEqual([`Bearer ${syntheticToken}`])
  expect(calls[0].multiHeaders['Cache-Control'].values).toEqual(['no-store'])
  expect(calls[0].cacheSettings?.store).toBe(false)
  expect(calls[0].cacheSettings?.maxAge?.seconds).toBe(0n)
  expect(calls[0].timeout?.seconds).toBe(5n)
  expect(calls[0].body.length).toBe(0)
  expect(logs).toEqual([])
})
test('missing/malformed/header-injection credentials fail before HTTP without logging', () => {
  const { runtime, credential, calls, logs } = harness()
  for (const raw of ['', '{private invalid JSON', '{}', 'x'.repeat(8193),
    ...['', 'short', 'Bearer token', `${syntheticToken}\r\nX-Evil: true`, `${syntheticToken}\n`, 'x'.repeat(4097)]
      .map(token => JSON.stringify({ ...credential, token })),
    JSON.stringify({ ...credential, extra: true })]) {
    runtime.getSecret = () => ({ result: () => ({ value: raw }) }) as ReturnType<TeeRuntime<Config>['getSecret']>
    expect(readPrivatePosition(runtime)).toBeUndefined()
  }
  runtime.getSecret = () => { throw new Error(syntheticToken) }
  expect(readPrivatePosition(runtime)).toBeUndefined()
  expect(calls).toEqual([])
  expect(logs).toEqual([])
})
test('config-only origin or agreement substitution cannot exfiltrate an existing credential', () => {
  for (const change of [{ positionOrigin: 'https://evil.test' }, { agreementId: otherId }]) {
    const { runtime, calls } = harness()
    Object.assign(runtime.config, change)
    expect(readPrivatePosition(runtime)).toBeUndefined()
    expect(calls).toEqual([])
  }
})
test('HTTP errors and all redirects withhold data and never perform a second request', () => {
  for (const statusCode of [201, 204, 301, 302, 303, 307, 308, 400, 401, 403, 429, 500, 503]) {
    const { runtime, response, calls, logs } = harness()
    response.statusCode = statusCode
    response.multiHeaders.Location = { values: ['https://evil.test/collect'] }
    expect(readPrivatePosition(runtime)).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(logs).toEqual([])
  }
  const { runtime, logs } = harness()
  runtime.callCapability = () => { throw new Error(`timeout with ${syntheticToken}`) }
  expect(readPrivatePosition(runtime)).toBeUndefined()
  expect(logs).toEqual([])
})
test('rejects oversized, malformed, non-JSON or ambiguous responses without disclosing bodies', () => {
  for (const body of ['', 'x'.repeat(16385), '{invalid', JSON.stringify({ secret: syntheticToken })]) {
    const { runtime, response } = harness()
    response.body = new TextEncoder().encode(body)
    expect(readPrivatePosition(runtime)).toBeUndefined()
  }
  const invalidHeaders: Record<string, { values: string[] }>[] = [{}, { 'content-type': { values: ['text/html'] } },
    { 'content-type': { values: ['application/json', 'text/html'] } },
    { 'content-type': { values: ['application/json'] }, Location: { values: ['https://evil.test'] } }]
  for (const headers of invalidHeaders) {
    const { runtime, response } = harness()
    response.multiHeaders = headers
    expect(readPrivatePosition(runtime)).toBeUndefined()
  }
})
test('revalidates freshness, identity and units before returning data to evaluation', () => {
  for (const changes of [{ agreementId: otherId }, { timestamp: now + 1 }, { timestamp: now - 31 },
    { currentLossBps: -1 }, { currentLossBps: 1.5 }, { elapsedSeconds: Number.MAX_SAFE_INTEGER + 1 }]) {
    const { runtime, response, position } = harness()
    response.body = new TextEncoder().encode(JSON.stringify({ ...position, ...changes }))
    expect(readPrivatePosition(runtime)).toBeUndefined()
  }
})
test('authenticated handler publishes only breach; withheld HTTP results and SAFE remain silent', () => {
  for (const mode of ['safe', 'breach', 'unauthorized', 'stale', 'wrong-policy'] as const) {
    const { runtime, config, response, position, credential, calls, logs } = harness()
    runtime.getSecret = request => ({ result: () => ({ value: JSON.stringify(
      request.id === config.policySecretId ? (mode === 'wrong-policy' ? { ...vectors.policy, maxLossBps: '301' } : vectors.policy) : credential),
    }) }) as ReturnType<TeeRuntime<Config>['getSecret']>
    response.statusCode = mode === 'unauthorized' ? 401 : 200
    response.body = new TextEncoder().encode(JSON.stringify({ ...position,
      currentLossBps: mode === 'safe' ? 280 : 310, timestamp: mode === 'stale' ? now - 31 : now }))
    const published: unknown[] = []
    const ports: WorkflowPorts = {
      readSnapshot: () => ({ agreementId: id, intentId: config.terms.intentId, state: 4, lastNonce: 1n,
        policyCommitment: hashPolicy(policySchema.parse(vectors.policy)),
        intentCommitment: hashPolicy(policySchema.parse(vectors.policy)), termsHash: hashTerms(termsSchema.parse(vectors.terms)) }),
      readPosition: () => readPrivatePosition(runtime),
      publish: decision => { published.push(decision); return { delivery: 'report-only' } },
    }
    const output = executeCheck(runtime, 2, ports)
    expect(published).toHaveLength(mode === 'breach' ? 1 : 0)
    if (mode !== 'breach') expect(output).toBe('NO_DECISION')
    if (mode === 'wrong-policy') expect(calls).toHaveLength(0)
    expect(output).not.toContain(syntheticToken)
    expect(output).not.toContain('currentLossBps')
    expect(output).not.toContain('elapsedSeconds')
    expect(logs).toEqual([])
  }
})