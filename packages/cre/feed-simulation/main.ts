// Test-only: actual CRE HTTP capability against a local synthetic authenticated provider.
// Agreement state and clock are fixtures; there is no chain writer in this binary.
import { cre, prepareReportRequest, Runner, type TeeRuntime } from '@chainlink/cre-sdk'
import { z } from 'zod'
import { hashTerms } from '../../core/src/index'
import { configSchema, type Config } from '../src/config'
import { bytes32, encodeDecision } from '../src/domain'
import { executeCheck } from '../src/handler'
import { readPrivatePosition } from '../src/position'

const schema = z.object({
  simulationOnly: z.literal(true),
  workflow: configSchema,
  policyCommitment: bytes32,
  evaluationTimeSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()
type SimulationConfig = z.infer<typeof schema>

function onProbe(runtime: TeeRuntime<SimulationConfig>): string {
  const { workflow, policyCommitment, evaluationTimeSeconds } = runtime.config
  const tee: TeeRuntime<Config> = {
    config: workflow,
    now: () => new Date(evaluationTimeSeconds * 1000),
    getSecret: request => runtime.getSecret(request),
    getSecrets: requests => runtime.getSecrets(requests),
    callCapability: request => runtime.callCapability(request),
    log: () => { throw new Error('Probe attempted to log from private execution') },
    reportFromDon: () => { throw new Error('Probe attempted unexpected boundary crossing') },
    usingTheDons: () => { throw new Error('Private feed attempted DON execution') },
  }
  let reportsGenerated = 0
  const output = executeCheck(tee, 2, {
    readSnapshot: () => ({ agreementId: workflow.agreementId, intentId: workflow.terms.intentId,
      policyCommitment, intentCommitment: policyCommitment, termsHash: hashTerms(workflow.terms),
      state: 4, lastNonce: 1n }),
    readPosition: () => readPrivatePosition(tee),
    publish: decision => {
      runtime.usingTheDons().report(prepareReportRequest(encodeDecision(decision))).result()
      reportsGenerated++
      return { delivery: 'report-only' }
    },
  })
  return JSON.stringify({ evidenceMode: 'CRE_HTTP_SYNTHETIC_PROVIDER_NOT_A_TEE',
    reportsGenerated, decision: output === 'NO_DECISION' ? null : JSON.parse(output) })
}

export async function main() {
  const runner = await Runner.newRunner({ configSchema: schema })
  await runner.run(config => [cre.handlerInTee(
    new cre.capabilities.CronCapability().trigger({ schedule: config.workflow.schedule }),
    onProbe, [{ tee: 'nitro', regions: ['us-west-2'] }],
  )])
}
main()