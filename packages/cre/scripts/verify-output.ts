export function verifySimulationOutput(transcript: string, scenario: string): void {
  let output: { evidenceMode: string; scenario: string; reportsGenerated: number; decision: null | {
    checkKind: number; result: boolean; delivery: string; decisionNonce: string
  } } | undefined
  for (const line of transcript.split('\n')) {
    if (!line.trim().startsWith('"')) continue
    try {
      const candidate = JSON.parse(JSON.parse(line.trim()))
      if (candidate?.evidenceMode === 'SIMULATION_SYNTHETIC_STATE_NOT_A_TEE') output = candidate
    } catch { /* Non-result CLI output. */ }
  }
  if (!output || output.scenario !== scenario) throw new Error('Missing labeled simulation result')
  if (['safe', 'boundary', 'stale'].includes(scenario)) {
    if (output.decision !== null || output.reportsGenerated !== 0) {
      throw new Error('Non-actionable monitoring emitted a decision or report')
    }
    return
  }
  const validation = ['accept', 'reject', 'mismatch'].includes(scenario)
  if (output.reportsGenerated !== 1 || !output.decision || output.decision.result !== ['accept', 'breach'].includes(scenario) ||
      output.decision.checkKind !== (validation ? 1 : 2) ||
      output.decision.decisionNonce !== (validation ? '1' : '2') ||
      output.decision.delivery !== 'report-only') throw new Error('Unexpected simulation decision')
}