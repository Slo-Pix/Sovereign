import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Hex } from 'viem'
import { assertLocalRpc } from './chain-guards'
export { LOCAL_MODE } from './chain-guards'

export const FOUNDRY_VERSION = '1.7.1'
export const ROOT = resolve(import.meta.dir, '../../..')
export type Artifact = { abi: Abi; bytecode: { object: Hex } }

export function localClient(url: string, chainId: number) {
  assertLocalRpc(url, chainId)
  const chain = defineChain({ id: chainId, name: `Isolated local ${chainId}`,
    nativeCurrency: { name: 'Local gas', symbol: 'TEST', decimals: 18 },
    rpcUrls: { default: { http: [url] } } })
  const transport = http(url, { timeout: 5000, retryCount: 0 })
  return { public: createPublicClient({ chain, transport, pollingInterval: 25 }),
    wallet: createWalletClient({ chain, transport }), chainId, url }
}
export type LocalClient = ReturnType<typeof localClient>

// No dotenv, shell, inherited signing/RPC variables, fork, or persistent Anvil state.
// HOME/PATH are needed only to find the installed Bun/Foundry/compiler caches.
const childEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME,
  TMPDIR: tmpdir(), NO_COLOR: '1' })

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

export async function withLocalEvm<T>(run: (context: {
  sepolia: LocalClient; arc: LocalClient; artifact: (name: string) => Promise<Artifact>
}) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(resolve(tmpdir(), 'sovereign-local-lifecycle-'))
  const processes: { child: ChildProcess; closed: Promise<void> }[] = []
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  function launch(args: string[]) {
    const child = spawn('bun', ['--no-env-file', 'x', '--bun', ...args], {
      cwd: ROOT, env: childEnv(), stdio: 'ignore', detached: true,
    })
    const closed = new Promise<void>(resolve => {
      child.once('close', () => resolve())
      child.once('error', () => resolve())
    })
    processes.push({ child, closed })
    return { child, closed }
  }
  try {
    const build = launch([`@foundry-rs/forge@${FOUNDRY_VERSION}`, 'build', '--root', ROOT,
      '--out', resolve(directory, 'out'), '--cache-path', resolve(directory, 'cache'),
      '--skip', 'test', 'script'])
    // MockUSDC is not a .t.sol file, so it remains in the compilation.
    await Promise.race([build.closed, delay(180_000, undefined, { signal: controller.signal })
      .then(() => { throw new Error('Local contract compilation timed out') })])
    assert.equal(build.child.exitCode, 0, 'Local contract compilation failed')
    async function start(chainId: number) {
      const port = await freePort()
      const { child } = launch([`@foundry-rs/anvil@${FOUNDRY_VERSION}`, '--host', '127.0.0.1', '--port', String(port),
        '--chain-id', String(chainId), '--silent'])
      const client = localClient(`http://127.0.0.1:${port}`, chainId)
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        controller.signal.throwIfAborted()
        assert.equal(child.exitCode, null, 'Local Anvil exited during startup')
        assert.equal(child.signalCode, null, 'Local Anvil stopped during startup')
        try {
          const actualId = await client.public.getChainId()
          assert.equal(actualId, chainId, 'Local Anvil chain ID mismatch')
          return client
        } catch (error) {
          if (error instanceof assert.AssertionError) throw error
        }
        await delay(50, undefined, { signal: controller.signal })
      }
      throw new Error('Local Anvil startup timed out')
    }
    const sepolia = await start(11155111)
    const arc = await start(5042002)
    assert.notEqual(sepolia.url, arc.url, 'Local chains must use separate processes/ports')
    const artifact = async (name: string): Promise<Artifact> => {
      assert.ok(/^[A-Za-z]+$/.test(name), 'Invalid artifact name')
      const result = JSON.parse(await readFile(resolve(directory, 'out', `${name}.sol`, `${name}.json`), 'utf8')) as Artifact
      assert.ok(result.bytecode.object.length > 2, 'Missing compiled deployment bytecode')
      return result
    }
    controller.signal.throwIfAborted()
    const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort',
      () => reject(new Error('Local run interrupted')), { once: true }))
    return await Promise.race([run({ sepolia, arc, artifact }), interrupted])
  } finally {
    controller.abort()
    // Kill the process group too: bun x may have spawned a native Foundry child.
    for (const { child } of processes) {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ }
      }
    }
    await Promise.all(processes.map(async ({ child, closed }) => {
      const timeout = setTimeout(() => {
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ }
        }
      }, 2000)
      try { await closed } finally { clearTimeout(timeout) }
    }))
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await rm(directory, { recursive: true, force: true })
  }
}