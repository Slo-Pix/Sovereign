import { cre, type TeeRuntime } from '@chainlink/cre-sdk'
import { z } from 'zod'
import type { Config } from './config'
import { bytes32, equalHash, positionSchema, type Position } from './domain'
import { positionEndpoint } from './position-endpoint'

// Credential binding lives in the secret, independently of public workflow configuration.
// A config-only change cannot send an existing credential to another origin/agreement.
const credentialSchema = z.object({
  origin: z.string().max(280),
  agreementId: bytes32,
  token: z.string().min(32).max(4096).regex(/^[A-Za-z0-9._~+\/-]+={0,2}$/).refine(value => !/\s/.test(value)),
}).strict()

export function readPrivatePosition(runtime: TeeRuntime<Config>): Position | undefined {
  try {
    const config = runtime.config
    if (config.allowInsecurePositionLoopback && config.delivery !== 'report-only') return undefined
    const url = positionEndpoint(config.positionOrigin, config.agreementId, config.allowInsecurePositionLoopback)
    if (!url || !config.positionAuthSecretId || config.positionAuthSecretId === config.policySecretId) return undefined
    const raw = runtime.getSecret({ id: config.positionAuthSecretId }).result().value
    if (typeof raw !== 'string' || raw.length > 8192) return undefined
    const parsed = credentialSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.origin !== config.positionOrigin ||
        !equalHash(parsed.data.agreementId, config.agreementId)) return undefined

    // CRE documents redirects as unsupported. Never follow a Location header ourselves.
    // Use the TEE overload: no runInNodeMode/usingTheDons receives credentials or position data.
    const response = new cre.capabilities.HTTPClient().sendRequest(runtime, {
      url, method: 'GET', timeout: '5s',
      cacheSettings: { store: false, maxAge: '0s' },
      multiHeaders: {
        Authorization: { values: [`Bearer ${parsed.data.token}`] },
        Accept: { values: ['application/json'] },
        'Cache-Control': { values: ['no-store'] },
      },
    }).result()
    if (response.statusCode !== 200 || response.body.length === 0 || response.body.length > 16384) return undefined
    const headerValues = (name: string): string[] => {
      const multi = Object.entries(response.multiHeaders ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([key]) => key.toLowerCase() === name).flatMap(([, value]) => value.values)
      return multi.length ? multi : Object.entries(response.headers ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([key]) => key.toLowerCase() === name).map(([, value]) => value)
    }
    const contentTypes = headerValues('content-type')
    if (headerValues('location').length || contentTypes.length !== 1 ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentTypes[0])) return undefined
    const position = positionSchema.safeParse(JSON.parse(new TextDecoder().decode(response.body)))
    if (!position.success || !equalHash(position.data.agreementId, config.agreementId)) return undefined
    const now = Math.floor(runtime.now().getTime() / 1000)
    const age = now - position.data.timestamp
    if (!Number.isSafeInteger(now) || now < 0 || age < 0 || age > config.maxPositionAgeSeconds) return undefined
    return position.data
  } catch {
    // Secret-provider/HTTP/parser errors can contain headers, tokens and private response bodies.
    // No raw errors, automatic retries, logs or public per-check error categories.
    return undefined
  }
}