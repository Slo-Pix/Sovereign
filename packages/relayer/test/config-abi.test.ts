import { expect, test } from 'bun:test'
import { parseArgs, readConfig } from '../src/config'
import { sinkAbi, registryAbi, escrowAbi } from '../src/abi'
import sink from '../../core/abis/DecisionSink.json'
import registry from '../../core/abis/AgreementRegistry.json'
import escrow from '../../core/abis/SovereignEscrow.json'

const env = { SOURCE_RPC_URL: 'http://127.0.0.1:1', DESTINATION_RPC_URL: 'http://127.0.0.1:2',
  SOURCE_START_BLOCK: '0', DESTINATION_START_BLOCK: '0' }
test('broadcast requires exact CLI flag; environment cannot turn it on', () => {
  expect(parseArgs([]).broadcast).toBe(false)
  expect(parseArgs(['--once']).broadcast).toBe(false)
  expect(parseArgs(['--once', '--broadcast']).broadcast).toBe(true)
  expect(() => parseArgs(['--broadcast=true'])).toThrow()
  expect(() => parseArgs(['--private-key=secret'])).toThrow()
})
test('config accepts no key; requires explicit source AND destination origin, never head default', () => {
  expect(readConfig(env).sourceStart).toBe(0n)
  expect(() => readConfig({ ...env, SOURCE_START_BLOCK: undefined })).toThrow()
  expect(() => readConfig({ ...env, DESTINATION_START_BLOCK: undefined })).toThrow()
})
test('config rejects unbounded windows, low confirmation depth and invalid RPC schemes', () => {
  for (const patch of [{ MAX_BLOCKS: '0' }, { MAX_BLOCKS: '2001' }, { DESTINATION_CONFIRMATIONS: '1' },
    { SOURCE_START_BLOCK: '-1' }, { SOURCE_START_BLOCK: '0x10' }, { SOURCE_RPC_URL: 'ftp://example.org' },
    { DESTINATION_RPC_URL: 'http://example.org' }]) {
    expect(() => readConfig({ ...env, ...patch })).toThrow()
  }
})
function shape(item: unknown): unknown {
  if (Array.isArray(item)) return item.map(shape)
  if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
    .filter(([key, value]) => !['internalType', 'anonymous', 'name'].includes(key) && !(key === 'indexed' && value === false))
    .map(([key, value]) => [key, shape(value)]))
  return item
}
for (const [label, fragments, exported] of [['sink', sinkAbi, sink], ['registry', registryAbi, registry], ['escrow', escrowAbi, escrow]] as const) {
  test(`${label} ABI fragments match existing core exports exactly (tuple widths/order/indexing)`, () => {
    for (const fragment of fragments) {
      const original = exported.find(item => item.type === fragment.type && 'name' in item && item.name === fragment.name)
      expect(original).toBeDefined(); expect(shape(fragment)).toEqual(shape(original))
    }
  })
}
test('CLI rejects missing broadcast key without printing env/RPC secrets', () => {
  const secretMarker = 'DO_NOT_PRINT_RPC_CREDENTIAL'
  const proc = Bun.spawnSync([process.execPath, '--no-env-file', 'src/cli.ts', '--once', '--broadcast'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { PATH: process.env.PATH, ...env, SOURCE_RPC_URL: `https://example.org/${secretMarker}` },
  })
  expect(proc.exitCode).toBe(1)
  const output = proc.stdout.toString() + proc.stderr.toString()
  expect(output).toContain('RELAYER_PRIVATE_KEY')
  expect(output).not.toContain(secretMarker)
})
test('default CLI ignores an invalid key and suppresses credential-bearing RPC errors', () => {
  const secretMarker = 'DO_NOT_PRINT_ENV_CREDENTIAL'
  const proc = Bun.spawnSync([process.execPath, '--no-env-file', 'src/cli.ts', '--once'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { PATH: process.env.PATH, ...env, SOURCE_RPC_URL: `http://127.0.0.1:1/${secretMarker}`,
      RELAYER_PRIVATE_KEY: secretMarker, BROADCAST: 'true', RELAYER_STATE_DIR: '/nonexistent-relayer-dry-test/state' },
  })
  expect(proc.exitCode).toBe(1)
  const output = proc.stdout.toString() + proc.stderr.toString()
  expect(output).not.toContain(secretMarker)
  expect(output).not.toContain('requires RELAYER_PRIVATE_KEY')
  expect(output).toContain('Raw diagnostics suppressed')
})