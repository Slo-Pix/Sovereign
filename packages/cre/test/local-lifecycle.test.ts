import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { receiverConfigFromEnv } from '../scripts/check-receiver'
import { assertLocalRpc, LOCAL_MODE } from '../scripts/chain-guards'

describe('local lifecycle safety boundaries', () => {
  test('only explicit loopback and the two expected chain IDs', () => {
    for (const id of [11155111, 5042002]) expect(() => assertLocalRpc('http://127.0.0.1:12345', id)).not.toThrow()
    for (const url of ['https://rpc.testnet.arc.network', 'http://localhost:12345', 'http://0.0.0.0:12345',
      'http://127.0.0.1:12345@evil.test', 'http://127.0.0.1:12345/path', 'http://127.0.0.1:12345?fork=1']) {
      expect(() => assertLocalRpc(url, 11155111)).toThrow()
    }
    expect(() => assertLocalRpc('http://127.0.0.1:12345', 1)).toThrow()
  })

  test('receiver preflight requires all public inputs and ignores unrelated secrets', () => {
    const env = { SEPOLIA_RPC_URL: 'http://127.0.0.1:12345', CRE_WORKFLOW_ID: `0x${'ab'.repeat(32)}`,
      CRE_REPORT_RECEIVER: `0x${'11'.repeat(20)}`, CRE_WORKFLOW_OWNER: `0x${'22'.repeat(20)}`,
      CRE_FORWARDER: `0x${'33'.repeat(20)}`, CRE_DECISION_SINK: `0x${'44'.repeat(20)}`,
      CRE_AGREEMENT_REGISTRY: `0x${'55'.repeat(20)}`, CRE_INTENT_REGISTRY: `0x${'66'.repeat(20)}` }
    expect(String(receiverConfigFromEnv(env).workflowId)).toBe(env.CRE_WORKFLOW_ID)
    for (const key of Object.keys(env)) expect(() => receiverConfigFromEnv({ ...env, [key]: undefined })).toThrow()
    expect(() => receiverConfigFromEnv({ ...env, CRE_WORKFLOW_ID: `0x${'00'.repeat(32)}` })).toThrow()
    expect(() => receiverConfigFromEnv({ ...env, CRE_WORKFLOW_OWNER: `0x${'00'.repeat(20)}` })).toThrow()
    expect(() => receiverConfigFromEnv({ ...env, CRE_REPORT_RECEIVER: `${env.CRE_REPORT_RECEIVER}\n` })).toThrow()
    const guarded = new Proxy(env, { get(target, key) {
      if (String(key).includes('PRIVATE_KEY')) throw new Error('Must not inspect private keys')
      return Reflect.get(target, key)
    } })
    expect(String(receiverConfigFromEnv(guarded).sink)).toBe(env.CRE_DECISION_SINK)
  })
})

test('real two-Anvil lifecycle, receiver migration, rejection receipts and token conservation', async () => {
  // Keep the host process APIs outside the SDK's restricted WASM type context.
  // This executes the same standalone command an operator runs, not a mock.
  const started = Date.now()
  const child = Bun.spawn([process.execPath, '--no-env-file', resolve(import.meta.dir, '../scripts/demo-chain.ts')], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdout: 'pipe', stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill('SIGTERM'), 210_000)
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
    expect(stdout).toContain(`${LOCAL_MODE}: PASS`)
  } finally { clearTimeout(timeout) }
  const report = await Bun.file(resolve(import.meta.dir, '../evidence/local-lifecycle/latest.json')).json() as {
    evidenceMode: string; status: string; completedAt: string; chains: { sepolia: { rpc: string }; arc: { rpc: string } }
    transactions: { status: string }[]; balances: { afterUnwind: unknown; beforeLock: unknown }; finalState: unknown
  }
  expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(started)
  expect(report.evidenceMode).toBe(LOCAL_MODE)
  expect(report.status).toBe('PASS')
  expect(report.chains.sepolia.rpc).not.toBe(report.chains.arc.rpc)
  expect(report.transactions.filter(tx => tx.status === 'reverted').length).toBeGreaterThanOrEqual(10)
  expect(report.balances.afterUnwind).toEqual(report.balances.beforeLock)
  expect(report.finalState).toEqual({ agreement: 'SETTLED', escrow: 'UNWOUND', decisionNonce: '2', migrationNonce: '42' })
  expect(JSON.stringify(report)).not.toMatch(/"(?:salt|privateKey|minYieldBps|maxLossBps|maxDuration)"/)
  // A successful run must have shut down both RPC processes before publication.
  for (const chain of [report.chains.sepolia, report.chains.arc]) {
    await expect(fetch(chain.rpc, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  }
}, 240_000)

test('both Anvil subprocesses are cleaned up after an injected callback failure', async () => {
  const modulePath = resolve(import.meta.dir, '../scripts/local-evm.ts')
  const code = `
    import { withLocalEvm } from ${JSON.stringify(modulePath)};
    let urls = [];
    try {
      await withLocalEvm(async ({ sepolia, arc }) => {
        urls = [sepolia.url, arc.url];
        throw new Error('EXPECTED_LOCAL_TEST_FAILURE');
      });
      process.exit(2);
    } catch (error) {
      if (error.message !== 'EXPECTED_LOCAL_TEST_FAILURE') process.exit(3);
    }
    console.log(JSON.stringify(urls));
  `
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', code], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdout: 'pipe', stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill('SIGTERM'), 210_000)
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const urls = JSON.parse(stdout) as string[]
    expect(urls).toHaveLength(2)
    for (const url of urls) await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  } finally { clearTimeout(timeout) }
}, 240_000)