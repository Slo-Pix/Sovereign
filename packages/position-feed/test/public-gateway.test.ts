import { describe, expect, test } from 'bun:test'
import { gatewayConfig, publicHandler } from '../src/public-gateway'

const id = `0x${'12'.repeat(32)}`

describe('read-only public gateway', () => {
  test('permits only health and position GET routes', async () => {
    let calls = 0
    const handler = publicHandler('http://127.0.0.1:3111', async () => {
      calls++
      return Response.json({ status: 'up' })
    })
    for (const request of [
      new Request('http://gateway/health', { method: 'POST' }),
      new Request(`http://gateway/agreements/${id}/position`, { method: 'PUT' }),
      new Request('http://gateway/admin'),
      new Request('http://gateway/health?probe=1'),
    ]) expect((await handler(request)).status).toBe(404)
    expect(calls).toBe(0)
    expect((await handler(new Request('http://gateway/health'))).status).toBe(200)
    expect(calls).toBe(1)
  })

  test('forwards only the position authorization header and strips upstream headers', async () => {
    let target = '', authorization: string | null = null, leaked = ''
    const handler = publicHandler('http://127.0.0.1:3111', async (input, init) => {
      target = String(input)
      const headers = new Headers(init?.headers)
      authorization = headers.get('authorization')
      leaked = headers.get('x-private') || ''
      return new Response(JSON.stringify({ agreementId: id, currentLossBps: 1, elapsedSeconds: 2, timestamp: 3 }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'forbidden=1' },
      })
    })
    const response = await handler(new Request(`http://gateway/agreements/${id}/position`, {
      headers: { Authorization: 'Bearer scoped-token', 'X-Private': 'do-not-forward' },
    }))
    expect(target).toBe(`http://127.0.0.1:3111/agreements/${id}/position`)
    expect(String(authorization)).toBe('Bearer scoped-token')
    expect(leaked).toBe('')
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('accepts only an explicit loopback origin and valid public port', () => {
    expect(gatewayConfig({})).toEqual({ origin: 'http://127.0.0.1:3111', port: 3112 })
    for (const origin of ['https://127.0.0.1:3111', 'http://localhost:3111', 'http://127.0.0.1:3111/path']) {
      expect(() => gatewayConfig({ POSITION_FEED_PRIVATE_ORIGIN: origin })).toThrow()
    }
  })
})
