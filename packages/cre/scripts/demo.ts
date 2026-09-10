import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hashPolicy } from '../../core/src/index'
import example from '../sovereign/config.example.json'
import vectors from '../../core/fixtures/vectors.json'
import { verifySimulationOutput } from './verify-output'

// This driver creates SYNTHETIC data only. Never provide a real private policy to the simulator.
const root = resolve(import.meta.dir, '..')
const cli = process.env.CRE_BIN ?? Bun.which('cre') ?? `${process.env.HOME}/.cre/bin/cre`
const work = await mkdtemp(resolve(tmpdir(), 'sovereign-synthetic-'))
const secret = {
  minYieldBps: '800', maxLossBps: '300', maxDuration: '2592000',
  salt: `0x${randomBytes(32).toString('hex')}` as const,
}
const policyCommitment = hashPolicy({ minYieldBps: 800n, maxLossBps: 300n,
  maxDuration: 2592000n, salt: secret.salt })
const envPath = resolve(work, 'synthetic.env')
const configPath = resolve(work, 'public.config.json')
const scenarioNames = ['accept', 'reject', 'mismatch', 'safe', 'breach', 'boundary', 'stale'] as const
const selected = process.argv.slice(2)
if (selected.some(name => !scenarioNames.includes(name as typeof scenarioNames[number]))) {
  throw new Error('Unknown simulation scenario')
}
const scenarios = selected.length ? scenarioNames.filter(name => selected.includes(name)) : scenarioNames
try {
  await writeFile(envPath, `SOVEREIGN_DEMO_POLICY_JSON='${JSON.stringify(secret)}'\n`, { mode: 0o600 })
  for (const scenario of scenarios) {
    await writeFile(configPath, JSON.stringify({ simulationOnly: true, scenario, policyCommitment,
      workflow: { ...example, agreementId: `0x${'bb'.repeat(32)}`,
        policySecretId: 'SOVEREIGN_DEMO_POLICY', terms: { ...vectors.terms,
          expiresAt: (BigInt(Math.floor(Date.now() / 1000)) + 3600n).toString() },
      },
    }), { mode: 0o600 })
    const proc = Bun.spawn([cli, 'workflow', 'simulate', './simulation', '--target', 'staging-settings',
      '--non-interactive', '--trigger-index', '0', '--config', configPath, '--env', envPath],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    const transcript = `${stdout}\n${stderr}`
    // Refuse to save or display any potentially leaky raw transcript.
    const forbidden = [...Object.keys(secret), secret.salt, JSON.stringify(secret)]
    if (forbidden.some(value => transcript.includes(value))) {
      throw new Error('Simulation output failed privacy scan; transcript discarded')
    }
    const clean = transcript.replaceAll(work, '<temporary-demo-directory>')
    if (code !== 0) {
      console.error(clean)
      throw new Error(`CRE simulation failed for ${scenario}; no success evidence recorded`)
    }
    verifySimulationOutput(clean, scenario)
    await mkdir(resolve(root, 'evidence/decisions'), { recursive: true })
    await writeFile(resolve(root, `evidence/decisions/${scenario}.txt`),
      `SYNTHETIC-STATE CRE CLI SIMULATION. NOT HARDWARE TEE OR CHAIN-WRITE EVIDENCE.\nScenario: ${scenario}\n${clean}`)
    console.log(`${scenario}: CRE simulation passed; output privacy scan passed`)
  }
} finally {
  await rm(work, { recursive: true, force: true })
}