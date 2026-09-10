// SIMULATION-ONLY entry point. Snapshots and positions here are synthetic, never chain evidence.
// No EVMClient and no writeReport exist in this binary: --broadcast cannot turn it into a live writer.
import { cre, prepareReportRequest, Runner, type TeeRuntime } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { hashTerms } from '../../core/src/index'
import { configSchema } from '../src/config'
import { bytes32, encodeDecision, type Snapshot } from '../src/domain'
import { executeCheck, type WorkflowPorts } from '../src/handler'

const demoSchema = z.object({
  simulationOnly: z.literal(true),
  scenario: z.enum(['accept', 'reject', 'mismatch', 'safe', 'breach', 'boundary', 'stale']),
  workflow: configSchema,
  policyCommitment: bytes32,
}).strict()
type DemoConfig = z.infer<typeof demoSchema>

function onDemo(runtime: TeeRuntime<DemoConfig>): string {
  const { workflow, scenario, policyCommitment } = runtime.config
  const validation = ['accept', 'reject', 'mismatch'].includes(scenario)
  const terms = scenario === 'reject' ? { ...workflow.terms, yieldBps: 0n } : workflow.terms
  const commitment = scenario === 'mismatch' ? `0x${'00'.repeat(32)}` as const : policyCommitment
  const snapshot: Snapshot = {
    agreementId: workflow.agreementId, intentId: terms.intentId, termsHash: hashTerms(terms),
    policyCommitment: commitment, intentCommitment: commitment, state: validation ? 3 : 4,
    lastNonce: validation ? 0n : 1n,
  }
  // Test-only evidence counter; the live entry point exposes no per-check monitoring telemetry.
  let reportsGenerated = 0
  const ports: WorkflowPorts = {
    readSnapshot: () => snapshot,
    readPosition: () => ({ agreementId: workflow.agreementId,
      currentLossBps: scenario === 'breach' ? 310 : scenario === 'boundary' ? 300 : 280,
      elapsedSeconds: 10,
      timestamp: Math.floor(runtime.now().getTime() / 1000) - (scenario === 'stale' ? 60 : 0),
    }),
    publish: decision => {
      runtime.usingTheDons().report(prepareReportRequest(encodeDecision(decision))).result()
      reportsGenerated++
      return { delivery: 'report-only' }
    },
  }
  const output = executeCheck({ config: { ...workflow, terms },
    now: () => runtime.now(), getSecret: request => runtime.getSecret(request),
  }, validation ? 1 : 2, ports)
  return JSON.stringify({ evidenceMode: 'SIMULATION_SYNTHETIC_STATE_NOT_A_TEE', scenario,
    reportsGenerated, decision: output === 'NO_DECISION' ? null : JSON.parse(output) })
}

export async function main() {
  const runner = await Runner.newRunner({ configSchema: demoSchema })
  await runner.run(config => [cre.handlerInTee(
    new cre.capabilities.CronCapability().trigger({ schedule: config.workflow.schedule }),
    onDemo, [{ tee: 'nitro', regions: ['us-west-2'] }],
  )])
}
main()