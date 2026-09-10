import { expect, test } from 'bun:test'
import { verifySimulationOutput } from '../scripts/verify-output'

const transcript = (scenario: string, decision: unknown, reportsGenerated: number) =>
  JSON.stringify(JSON.stringify({ evidenceMode: 'SIMULATION_SYNTHETIC_STATE_NOT_A_TEE',
    scenario, decision, reportsGenerated }))

test('simulation evidence rejects leaked SAFE reports even when no public decision is returned', () => {
  for (const scenario of ['safe', 'boundary', 'stale']) {
    expect(() => verifySimulationOutput(transcript(scenario, null, 0), scenario)).not.toThrow()
    expect(() => verifySimulationOutput(transcript(scenario, null, 1), scenario)).toThrow()
    expect(() => verifySimulationOutput(transcript(scenario,
      { checkKind: 2, result: false, delivery: 'report-only', decisionNonce: '2' }, 0), scenario)).toThrow()
  }
})