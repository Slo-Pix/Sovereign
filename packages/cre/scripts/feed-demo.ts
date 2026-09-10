import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hashPolicy } from '../../core/src/index'
import example from '../sovereign/config.example.json'
import vectors from '../../core/fixtures/vectors.json'

// Owned local test fixture, not Member C's service. No real credentials, TEE claim or broadcast.
const root = resolve(import.meta.dir, '..')
const cli = process.env.CRE_BIN ?? Bun.which('cre') ?? `${process.env.HOME}/.cre/bin/cre`
const scenarioNames = ['safe', 'breach', 'boundary', 'unauthorized', 'stale', 'wrong-agreement',
  'malformed', 'redirect-same-origin', 'redirect-cross-origin'] as const
type Scenario = typeof scenarioNames[number]
const selected = process.argv.slice(2)
if (selected.some(name => !scenarioNames.includes(name as Scenario))) throw new Error('Unknown feed scenario')
const scenarios = selected.length ? scenarioNames.filter(name => selected.includes(name)) : scenarioNames
const agreementId = `0x${'bb'.repeat(32)}` as const
const token = randomBytes(32).toString('base64url')
const policy = { ...vectors.policy, salt: `0x${randomBytes(32).toString('hex')}` as const }
const commitment = hashPolicy({ minYieldBps: 800n, maxLossBps: 300n, maxDuration: 2592000n, salt: policy.salt })
const evaluationTimeSeconds = Math.floor(Date.now() / 1000)
let scenario: Scenario = 'safe'
let authorizedRequests = 0
let unauthorizedRequests = 0
let redirectTargetRequests = 0
let sourceTargetRequests = 0
let credentialReachedRedirectTarget = false
const target = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  redirectTargetRequests++
  credentialReachedRedirectTarget ||= request.headers.has('authorization')
  return new Response(null, { status: 403 })
} })
const source = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path !== `/agreements/${agreementId}/position`) {
    sourceTargetRequests++
    credentialReachedRedirectTarget ||= request.headers.has('authorization')
    return new Response(null, { status: 403 })
  }
  if (request.headers.get('authorization') !== `Bearer ${token}`) {
    unauthorizedRequests++
    return new Response(null, { status: 401 })
  }
  authorizedRequests++
  if (scenario === 'unauthorized') return new Response(null, { status: 401 })
  if (scenario.startsWith('redirect-')) return new Response(null, { status: 302, headers: {
    Location: scenario === 'redirect-same-origin' ? '/redirect-target' : `http://127.0.0.1:${target.port}/redirect-target`,
  } })
  if (scenario === 'malformed') return new Response('{invalid', { headers: { 'Content-Type': 'application/json' } })
  return Response.json({ agreementId: scenario === 'wrong-agreement' ? `0x${'cc'.repeat(32)}` : agreementId,
    currentLossBps: scenario === 'safe' ? 280 : scenario === 'boundary' ? 300 : 310,
    elapsedSeconds: 10, timestamp: evaluationTimeSeconds - (scenario === 'stale' ? 60 : 0),
  }, { headers: { 'Cache-Control': 'no-store' } })
} })
let work: string | undefined
try {
  work = await mkdtemp(resolve(tmpdir(), 'sovereign-private-feed-'))
  const origin = `http://127.0.0.1:${source.port}`
  const envPath = resolve(work, 'synthetic.env')
  const configPath = resolve(work, 'public.config.json')
  await writeFile(envPath, `SOVEREIGN_DEMO_POLICY_JSON='${JSON.stringify(policy)}'\n` +
    `SOVEREIGN_DEMO_POSITION_AUTH_JSON='${JSON.stringify({ origin, agreementId, token })}'\n`, { mode: 0o600 })
  await writeFile(configPath, JSON.stringify({ simulationOnly: true, policyCommitment: commitment,
    evaluationTimeSeconds, workflow: { ...example, agreementId, terms: vectors.terms,
      positionOrigin: origin, allowInsecurePositionLoopback: true,
      policySecretId: 'SOVEREIGN_DEMO_POLICY', positionAuthSecretId: 'SOVEREIGN_DEMO_POSITION_AUTH',
    },
  }), { mode: 0o600 })
  // Confirm the fixture itself does not allow anonymous access before testing the client.
  const anonymous = await fetch(`${origin}/agreements/${agreementId}/position`)
  if (anonymous.status !== 401) throw new Error('Synthetic provider allowed anonymous access')
  for (const current of scenarios) {
    scenario = current
    authorizedRequests = unauthorizedRequests = redirectTargetRequests = sourceTargetRequests = 0
    credentialReachedRedirectTarget = false
    const proc = Bun.spawn([cli, 'workflow', 'simulate', './feed-simulation', '--target', 'staging-settings',
      '--non-interactive', '--trigger-index', '0', '--config', configPath, '--env', envPath],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    const raw = `${stdout}\n${stderr}`
    if ([token, policy.salt, ...Object.keys(policy), 'currentLossBps', 'elapsedSeconds'].some(value => raw.includes(value))) {
      throw new Error('Feed simulation failed privacy scan; raw transcript discarded')
    }
    const transcript = raw.replaceAll(work, '<temporary-demo-directory>')
    if (code !== 0) {
      console.error(transcript)
      throw new Error('Feed simulation failed; no success evidence recorded')
    }
    let output: { reportsGenerated: number; decision: null | { checkKind: number; result: boolean; decisionNonce: string; delivery: string } } | undefined
    for (const line of transcript.split('\n')) {
      if (!line.trim().startsWith('"')) continue
      try {
        const candidate = JSON.parse(JSON.parse(line.trim()))
        if (candidate.evidenceMode === 'CRE_HTTP_SYNTHETIC_PROVIDER_NOT_A_TEE') output = candidate
      } catch { /* Not a result line. */ }
    }
    if (!output || authorizedRequests !== 1 || unauthorizedRequests !== 0 ||
        redirectTargetRequests !== 0 || sourceTargetRequests !== 0 || credentialReachedRedirectTarget) {
      throw new Error('Authenticated request or redirect safety assertion failed; no success evidence recorded')
    }
    if (scenario === 'breach') {
      if (output.reportsGenerated !== 1 || !output.decision?.result || output.decision.checkKind !== 2 ||
          output.decision.decisionNonce !== '2' || output.decision.delivery !== 'report-only') {
        throw new Error('Expected exactly one actionable breach report')
      }
    } else if (output.reportsGenerated !== 0 || output.decision !== null) {
      throw new Error('Expected silent monitoring with no report')
    }
    await mkdir(resolve(root, 'evidence/private-feed'), { recursive: true })
    await writeFile(resolve(root, `evidence/private-feed/${scenario}.txt`),
      `ACTUAL CRE HTTP CAPABILITY; LOCAL SYNTHETIC PROVIDER/STATE/CLOCK. NOT HARDWARE TEE OR CHAIN-WRITE EVIDENCE.\n` +
      `Scenario: ${scenario}\nAuthorized requests: ${authorizedRequests}\nUnauthorized requests: ${unauthorizedRequests}\n` +
      `Redirect target requests: ${redirectTargetRequests + sourceTargetRequests}\nCredential reached redirect target: false\n` + transcript)
    console.log(`${scenario}: CRE authenticated HTTP passed; redirect/output assertions passed`)
  }
} finally {
  source.stop(true)
  target.stop(true)
  if (work) await rm(work, { recursive: true, force: true })
}