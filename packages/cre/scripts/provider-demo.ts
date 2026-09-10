import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { hashPolicy } from '../../core/src/index'
import example from '../sovereign/config.example.json'
import vectors from '../../core/fixtures/vectors.json'

// Synthetic inputs ONLY. The provider and CRE HTTP capability are real; the
// agreement snapshot, clock injection and report-only execution are not a chain/TEE.
const root = resolve(import.meta.dir, '..')
const provider = resolve(root, '../position-feed/src')
const command = 'bun --no-env-file packages/cre/scripts/provider-demo.ts'
const scenarios = ['safe', 'breach', 'revoked'] as const
type Scenario = typeof scenarios[number]
type Observation = { agreementId: string; currentLossBps: number; elapsedSeconds: number; timestamp: number }
type Quota = { window_start: number; used: number }
type Child = ReturnType<typeof launch>
let stage = 'initialization'

function check(condition: unknown): asserts condition {
  // Never include assertion values, HTTP bodies, SQL rows or subprocess errors.
  if (!condition) throw new Error('Provider integration assertion failed')
}

function killGroup(proc: Bun.Subprocess, signal: NodeJS.Signals) {
  try { process.kill(-proc.pid, signal) } catch { /* Already exited. */ }
}

function launch(args: string[], cwd: string, env: Record<string, string>) {
  const proc = Bun.spawn(args, { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: true })
  async function capture(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 1024 * 1024) {
          killGroup(proc, 'SIGKILL')
          throw new Error('Child output exceeded limit')
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks).toString('utf8')
    } finally { reader.releaseLock() }
  }
  // Attach rejection handlers immediately, including for long-lived servers.
  const result = Promise.all([capture(proc.stdout), capture(proc.stderr), proc.exited])
    .then(([stdout, stderr, code]) => ({ stdout, stderr, code }), () => null)
  return { proc, result }
}

export async function main() {
  check(process.argv.length === 2)
  const cli = process.env.CRE_BIN ?? Bun.which('cre') ?? resolve(process.env.HOME ?? '', '.cre/bin/cre')
  const readerToken = randomBytes(32).toString('base64url')
  const writerToken = randomBytes(32).toString('base64url')
  const agreementId = `0x${'bb'.repeat(32)}`
  const policy = { ...vectors.policy, salt: `0x${randomBytes(32).toString('hex')}` as const }
  const policyCommitment = hashPolicy({ minYieldBps: BigInt(policy.minYieldBps),
    maxLossBps: BigInt(policy.maxLossBps), maxDuration: BigInt(policy.maxDuration), salt: policy.salt })
  const forbidden = [readerToken, writerToken, policy.salt, policy.salt.slice(2),
    ...[readerToken, writerToken].map(value => createHash('sha256').update(value).digest('hex')),
    ...Object.keys(policy), 'currentLossBps', 'elapsedSeconds', JSON.stringify(policy)]
  function scan(text: string) {
    check(!forbidden.some(value => text.toLowerCase().includes(value.toLowerCase())))
    check(!/authorization\s*[":=]|bearer\s+[A-Za-z0-9._~+/-]{32}/i.test(text))
  }
  const children = new Set<Child>()
  const abort = new AbortController()
  const interrupt = () => {
    abort.abort()
    for (const child of children) killGroup(child.proc, 'SIGTERM')
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let work: string | undefined
  let server: Child | undefined
  let reservation: Bun.TCPSocketListener<undefined> | undefined
  let cliMetadataRpc: ReturnType<typeof Bun.serve> | undefined
  const cliRpcMethods: string[] = []
  let audit: Database | undefined
  const records: object[] = []
  const transcripts: { scenario: Scenario; text: string }[] = []
  let serverStarts = 0
  const hashes: Record<string, string> = {}
  async function stop(child: Child) {
    killGroup(child.proc, 'SIGTERM')
    const timer = setTimeout(() => killGroup(child.proc, 'SIGKILL'), 1000)
    try { await child.result } finally {
      clearTimeout(timer)
      killGroup(child.proc, 'SIGKILL') // Include any surviving compiler descendants.
      children.delete(child)
    }
  }
  try {
    work = await mkdtemp(resolve(tmpdir(), 'sovereign-provider-integration-'))
    await chmod(work, 0o700)
    const project = resolve(work, 'packages/cre')
    const dbPath = resolve(work, 'state/position.sqlite')
    const credentialPath = resolve(work, 'credentials.json')
    const envPath = resolve(work, 'synthetic.env')
    const configPath = resolve(work, 'simulation.json')
    // Do not inherit repository credentials, proxies, NODE_OPTIONS or Bun options.
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
      LANG: 'C.UTF-8', TMPDIR: work }
    async function run(args: string[], cwd = work!, limitMs = 25_000) {
      abort.signal.throwIfAborted()
      const child = launch(args, cwd, env)
      children.add(child)
      let expired = false
      const timer = setTimeout(() => { expired = true; killGroup(child.proc, 'SIGKILL') }, limitMs)
      try {
        const result = await child.result
        check(result)
        scan(`${result.stdout}\n${result.stderr}`)
        if (result.code !== 0 && !expired && !abort.signal.aborted) {
          // Only scan-passed, path-redacted diagnostics may be displayed. Never
          // persist failed runs or expose the unscanned exception object.
          console.error(`${result.stdout}\n${result.stderr}`.replaceAll(work!, '<temporary-demo-directory>'))
        }
        check(!expired && !abort.signal.aborted && result.code === 0)
        return result
      } finally { clearTimeout(timer); await stop(child) }
    }
    stage = 'isolate-unchanged-workflow'
    // Compile a byte-identical copy so CLI .cre_build_tmp.js/WASM output never
    // modifies the workspace. Never copy .env, private configs or existing builds.
    for (const name of ['src', 'package.json', 'tsconfig.json',
      'feed-simulation/main.ts', 'feed-simulation/workflow.yaml', 'feed-simulation/secrets.yaml']) {
      await cp(resolve(root, name), resolve(project, name), { recursive: true })
    }
    for (const name of ['src', 'abis', 'package.json']) {
      await cp(resolve(root, '../core', name), resolve(project, '../core', name), { recursive: true })
    }
    for (const [source, target] of [[resolve(root, 'node_modules'), resolve(project, 'node_modules')],
      [resolve(root, '../core/node_modules'), resolve(project, '../core/node_modules')],
      [resolve(root, '../../node_modules'), resolve(work, 'node_modules')]]) {
      await symlink(source, target, 'dir')
    }
    // CRE requires an RPC URL even for this no-chain binary and probes eth_chainId
    // at startup. This metadata-only stub is NOT the position provider or an EVM.
    // It cannot supply state, accept transactions or service any other RPC method.
    cliMetadataRpc = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      try {
        const value = await request.json() as { id?: number; method?: string }
        const allowed = value.method === 'eth_chainId'
        cliRpcMethods.push(allowed ? 'eth_chainId' : 'UNEXPECTED_METHOD')
        return Response.json(allowed ? { jsonrpc: '2.0', id: value.id, result: '0xaa36a7' } :
          { jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Method not supported' } })
      } catch { cliRpcMethods.push('INVALID_REQUEST'); return new Response(null, { status: 400 }) }
    } })
    await writeFile(resolve(project, 'project.yaml'), 'staging-settings:\n  rpcs:\n' +
      '    - chain-name: ethereum-testnet-sepolia\n' +
      `      url: http://127.0.0.1:${cliMetadataRpc.port}\n`, { mode: 0o600 })
    for (const name of ['feed-simulation/main.ts', 'src/position.ts']) {
      const source = await readFile(resolve(root, name))
      check(source.equals(await readFile(resolve(project, name))))
      hashes[name] = createHash('sha256').update(source).digest('hex')
    }
    for (const name of ['server.ts', 'operator.ts', 'http.ts', 'store.ts', 'validation.ts']) {
      hashes[`position-feed/src/${name}`] = createHash('sha256').update(await readFile(resolve(provider, name))).digest('hex')
    }
    stage = 'provision-private-credentials'
    await writeFile(credentialPath, JSON.stringify({ credentials: [
      { agreementId, role: 'read', token: readerToken, capacity: 10000, windowSeconds: 86400 },
      { agreementId, role: 'write', token: writerToken, capacity: 10000, windowSeconds: 86400 },
    ] }), { mode: 0o600 })
    check(((await lstat(credentialPath)).mode & 0o777) === 0o600)
    const provision = await run([process.execPath, '--no-env-file', resolve(provider, 'operator.ts'),
      'provision', '--db', dbPath, '--config', credentialPath])
    check(provision.stdout === 'Operation completed\n' && provision.stderr === '')
    // The server must rely on durable hashes, not the original provisioning file.
    await rm(credentialPath)
    let origin = ''
    async function start() {
      // Reserve an OS-assigned loopback port; release immediately before spawning.
      // The CLI server rejects port zero. A competing bind fails closed (no retries).
      reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
      const port = reservation.port
      check(port && port > 0)
      origin = `http://127.0.0.1:${port}`
      reservation.stop(true)
      reservation = undefined
      server = launch([process.execPath, '--no-env-file', resolve(provider, 'server.ts')], work!,
        { ...env, POSITION_FEED_DB: dbPath, POSITION_FEED_HOST: '127.0.0.1', POSITION_FEED_PORT: String(port) })
      children.add(server)
      const deadline = performance.now() + 5000
      while (performance.now() < deadline) {
        abort.signal.throwIfAborted()
        check(server.proc.exitCode === null)
        try {
          const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(300), redirect: 'error' })
          if (response.status === 200 && await response.text() === '{"status":"up"}') {
            // A short bounded delay also catches a child that lost the port handoff.
            await Bun.sleep(30)
            check(server.proc.exitCode === null)
            serverStarts++
            return
          }
        } catch { /* Bounded readiness only; never renew an observation here. */ }
        await Bun.sleep(25)
      }
      throw new Error('Provider readiness deadline exceeded')
    }
    async function stopServer() {
      check(server)
      await stop(server)
      const result = await server.result
      check(result)
      scan(result.stdout + result.stderr)
      check(result.code === 0 && result.stdout === '' && result.stderr === '')
      server = undefined
    }
    async function request(method: 'GET' | 'PUT', token?: string, observation?: Observation) {
      abort.signal.throwIfAborted()
      if (observation) check(Object.keys(observation).sort().join(',') ===
        'agreementId,currentLossBps,elapsedSeconds,timestamp')
      const response = await fetch(`${origin}/agreements/${agreementId}/position`, {
        method, redirect: 'error', signal: AbortSignal.timeout(2000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(observation ? { 'Content-Type': 'application/json' } : {}) },
        ...(observation ? { body: JSON.stringify(observation) } : {}),
      })
      check(response.headers.get('cache-control') === 'no-store')
      check(response.headers.get('x-content-type-options') === 'nosniff')
      check(response.headers.get('referrer-policy') === 'no-referrer')
      const body = await response.text()
      if (response.status >= 400) check(body === '{"error":"Request rejected"}')
      return { status: response.status, body }
    }
    function persisted(observation: Observation) {
      check(audit)
      const row = audit.query<Observation, [string]>(
        'SELECT agreementId, currentLossBps, elapsedSeconds, timestamp FROM observations WHERE agreementId = ?',
      ).get(agreementId)
      check(JSON.stringify(row) === JSON.stringify(observation))
    }
    function quota(): Quota | null {
      check(audit)
      return audit.query<Quota, [string]>(`SELECT q.window_start, q.used FROM quotas q
        JOIN credentials c ON c.hash = q.hash WHERE c.agreement_id = ? AND c.role = 'read'`).get(agreementId)
    }
    const now = () => Math.floor(Date.now() / 1000)
    const activation = now() - 10
    let previous: Observation | undefined
    for (const scenario of scenarios) {
      stage = `${scenario}:start-and-persistence`
      if (server) await stopServer()
      await start()
      audit ??= new Database(dbPath, { readonly: true, strict: true })
      if (previous) {
        // Before any new PUT, read exactly the old persisted observation via HTTP
        // and SQLite; this proves credentials and original timestamps survive.
        persisted(previous)
        const restored = await request('GET', readerToken)
        check(restored.status === 200 && JSON.stringify(JSON.parse(restored.body)) === JSON.stringify(previous))
      }
      if (scenario === 'revoked') {
        stage = 'revoked:operator-and-restart'
        const revoke = await run([process.execPath, '--no-env-file', resolve(provider, 'operator.ts'),
          'revoke', '--db', dbPath, '--agreement', agreementId, '--role', 'read'])
        check(revoke.stdout === 'Operation completed\n' && revoke.stderr === '')
        check((await request('GET', readerToken)).status === 401)
        await stopServer()
        await start()
        check((await request('GET', readerToken)).status === 401)
        check(previous)
        persisted(previous)
      }
      stage = `${scenario}:explicit-observation-and-auth`
      const deadline = performance.now() + 3000
      while (previous && now() <= previous.timestamp && performance.now() < deadline) {
        abort.signal.throwIfAborted()
        await Bun.sleep(20)
      }
      const timestamp = now()
      check(!previous || timestamp > previous.timestamp)
      // Three separately authored observations, with changing measurements. No
      // polling timer, GET, restart, retry or compilation refreshes their timestamps.
      const observation: Observation = { agreementId,
        currentLossBps: scenario === 'safe' ? 280 : scenario === 'breach' ? 310 : 320,
        elapsedSeconds: timestamp - activation, timestamp }
      check((await request('PUT', readerToken, observation)).status === 401)
      check((await request('GET', writerToken)).status === 401)
      check((await request('GET')).status === 401)
      check((await request('PUT', undefined, observation)).status === 401)
      const written = await request('PUT', writerToken, observation)
      check(written.status === 204 && written.body === '')
      persisted(observation)
      check((await request('PUT', writerToken, observation)).status === 409)
      const read = await request('GET', readerToken)
      check(read.status === (scenario === 'revoked' ? 401 : 200))
      if (read.status === 200) check(JSON.stringify(JSON.parse(read.body)) === JSON.stringify(observation))
      // Only the independently bound read token enters CRE. No writer token or
      // provider policy fields are passed in HTTP/config, and no real .env is read.
      await writeFile(envPath, `SOVEREIGN_DEMO_POLICY_JSON='${JSON.stringify(policy)}'\n` +
        `SOVEREIGN_DEMO_POSITION_AUTH_JSON='${JSON.stringify({ origin, agreementId, token: readerToken })}'\n`, { mode: 0o600 })
      await writeFile(configPath, JSON.stringify({ simulationOnly: true, policyCommitment,
        evaluationTimeSeconds: timestamp, workflow: { ...example, agreementId, terms: vectors.terms,
          delivery: 'report-only', maxPositionAgeSeconds: 30, positionOrigin: origin,
          allowInsecurePositionLoopback: true, policySecretId: 'SOVEREIGN_DEMO_POLICY',
          positionAuthSecretId: 'SOVEREIGN_DEMO_POSITION_AUTH' },
      }), { mode: 0o600 })
      stage = `${scenario}:actual-cre-http`
      const before = quota()
      const hostStart = now()
      check(hostStart >= timestamp && hostStart - timestamp <= 30)
      const result = await run([cli, 'workflow', 'simulate', './feed-simulation', '--target', 'staging-settings',
        '--non-interactive', '--trigger-index', '0', '--config', configPath, '--env', envPath], project)
      const hostEnd = now()
      check(hostEnd >= hostStart && hostEnd - timestamp <= 30)
      persisted(observation)
      const after = quota()
      if (scenario === 'revoked') check(JSON.stringify(after) === JSON.stringify(before))
      else check(after && (before?.window_start === after.window_start ? after.used - before.used : after.used) === 1)
      const text = `${result.stdout}\n${result.stderr}`.replaceAll(work, '<temporary-demo-directory>')
      const outputs: { reportsGenerated: number; decision: null | {
        agreementId: string; checkKind: number; result: boolean; decisionNonce: string; delivery: string
      } }[] = []
      for (const line of text.split('\n')) {
        if (!line.trim().startsWith('"')) continue
        try {
          const value = JSON.parse(JSON.parse(line.trim()))
          if (value.evidenceMode === 'CRE_HTTP_SYNTHETIC_PROVIDER_NOT_A_TEE') outputs.push(value)
        } catch { /* Not a CRE result line. */ }
      }
      check(outputs.length === 1)
      const output = outputs[0]
      if (scenario === 'breach') check(output.reportsGenerated === 1 && output.decision?.result === true &&
        output.decision.agreementId === agreementId && output.decision.checkKind === 2 &&
        output.decision.decisionNonce === '2' && output.decision.delivery === 'report-only')
      else check(output.reportsGenerated === 0 && output.decision === null)
      records.push({ scenario, reportsGenerated: output.reportsGenerated, observationTimestamp: timestamp,
        evaluationTimeSeconds: timestamp, hostStart, hostEnd, ageAtCompletionSeconds: hostEnd - timestamp,
        authorizedCREReads: scenario === 'revoked' ? 0 : 1, readerGetStatus: read.status,
        readerPutStatus: 401, writerGetStatus: 401, anonymousGetStatus: 401, anonymousPutStatus: 401,
        writerPutStatus: 204, replayPutStatus: 409, persistedObservationUnchanged: true,
        previousObservationSurvivedRestart: Boolean(previous), privacyScanPassed: true })
      transcripts.push({ scenario, text })
      previous = observation
    }
    stage = 'final-server-cleanup'
    check(cliRpcMethods.length > 0 && cliRpcMethods.every(method => method === 'eth_chainId'))
    await stopServer()
  } finally {
    reservation?.stop(true)
    await cliMetadataRpc?.stop(true)
    try { await Promise.all([...children].map(stop)) } finally {
      try { audit?.close() } finally {
        try { if (work) await rm(work, { recursive: true, force: true }) } finally {
          process.removeListener('SIGINT', interrupt)
          process.removeListener('SIGTERM', interrupt)
        }
      }
    }
  }
  // Publish nothing until all scenarios, privacy assertions and cleanup succeed.
  stage = 'save-scanned-evidence'
  const summary = JSON.stringify({ command, evidenceMode: 'REAL_PROVIDER_REAL_CRE_HTTP_SYNTHETIC_STATE_NOT_TEE_NOT_LIVE_CHAIN',
    completedAt: new Date().toISOString(), totalReports: 1, creSimulations: 3, provisionCommands: 1,
    revokeCommands: 1, serverStarts, serverRestarts: serverStarts - 1, cleanupSucceeded: true,
    cliStartupRpc: { kind: 'LOOPBACK_CHAIN_ID_STUB_NOT_AN_EVM', methods: cliRpcMethods },
    revokedCredentialSurvivedRestart: true, sourceSha256: hashes, scenarios: records }, null, 2) + '\n'
  scan(summary)
  for (const { text } of transcripts) scan(text)
  const evidence = resolve(root, 'evidence/provider-integration')
  await mkdir(evidence, { recursive: true })
  for (const { scenario, text } of transcripts) {
    await writeFile(resolve(evidence, `${scenario}.txt`),
      `REAL POSITION-FEED SERVICE + ACTUAL CRE HTTP CAPABILITY. SYNTHETIC INPUTS/AGREEMENT STATE.\n` +
      `NOT HARDWARE TEE, LIVE VENUE, CHAIN WRITE OR DEPLOYMENT EVIDENCE.\nScenario: ${scenario}\n${text}`)
  }
  await writeFile(resolve(evidence, 'summary.json'), summary)
  console.log('Provider integration passed: safe=0, breach=1, revoked=0; total reports=1; CRE simulations=3.')
  console.log('Role separation, anonymous denial, persistence, replay, revocation, privacy and cleanup passed.')
}

if (import.meta.main) {
  main().catch(() => {
    // Raw errors (including assertion diffs and compiler output) are never printed.
    console.error(`Provider integration failed at ${stage}; raw diagnostics discarded; no new success evidence saved.`)
    process.exitCode = 1
  })
}