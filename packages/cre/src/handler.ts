import { cre, type TeeRuntime } from '@chainlink/cre-sdk'
import { hashPolicy, hashTerms } from '../../core/src/index'
import type { Config } from './config'
import { equalHash, evaluate, parsePolicy, type CheckKind, type Decision, type Snapshot } from './domain'

export type WorkflowPorts = {
  readSnapshot(): Snapshot
  readPosition(): unknown
  publish(decision: Decision): { delivery: 'report-only' | 'sepolia'; txHash?: string }
}

export function executeCheck(runtime: Pick<TeeRuntime<Config>, 'config' | 'getSecret' | 'now'>, checkKind: CheckKind, ports: WorkflowPorts): string {
  const config = runtime.config
  try {
    const snapshot = ports.readSnapshot()
    if (snapshot.state !== (checkKind === 1 ? 3 : 4)) return 'NO_DECISION'
    // No public workflow step, trigger input, log or DON request receives this value.
    const rawPolicy = runtime.getSecret({ id: config.policySecretId }).result().value
    const policy = parsePolicy(rawPolicy)
    // Verify binding before sending even an authenticated position read for monitoring.
    if (checkKind === 2 && (!policy || !equalHash(hashPolicy(policy), snapshot.policyCommitment) ||
      !equalHash(snapshot.intentCommitment, snapshot.policyCommitment) ||
      !equalHash(snapshot.agreementId, config.agreementId) ||
      !equalHash(snapshot.intentId, config.terms.intentId) ||
      !equalHash(hashTerms(config.terms), snapshot.termsHash))) return 'NO_DECISION'
    const position = checkKind === 2 ? ports.readPosition() : undefined
    const decision = evaluate({ checkKind, agreementId: config.agreementId, snapshot, policy,
      terms: config.terms, position, nowSeconds: BigInt(Math.floor(runtime.now().getTime() / 1000)),
      maxPositionAgeSeconds: config.maxPositionAgeSeconds })
    // SAFE is an internal evaluation result, not a public oracle response.
    // Use the same neutral status as an unusable input: no report, verdict or nonce leaves here.
    if (!decision || (checkKind === 2 && !decision.result)) return 'NO_DECISION'

    // Re-read immediately before report generation: never use offer nonce or process-local counters.
    // A race after this check is still possible; the receiver's nonce/state checks remain mandatory.
    const current = ports.readSnapshot()
    if (current.lastNonce !== snapshot.lastNonce || current.state !== snapshot.state ||
        !equalHash(current.agreementId, snapshot.agreementId) ||
        !equalHash(current.intentId, snapshot.intentId) ||
        !equalHash(current.termsHash, snapshot.termsHash) ||
        !equalHash(current.policyCommitment, snapshot.policyCommitment) ||
        !equalHash(current.intentCommitment, snapshot.intentCommitment)) return 'NO_DECISION'
    const delivery = ports.publish(decision)
    // Only public identifiers, decision and transport metadata leave the confidential handler.
    return JSON.stringify({ agreementId: decision.agreementId, decisionId: decision.decisionId,
      checkKind, result: decision.result, decisionNonce: decision.decisionNonce.toString(), ...delivery })
  } catch {
    // Do not echo SDK errors: HTTP responses and secret provider diagnostics may contain inputs.
    throw new Error('Workflow execution failed; inspect public chain state before retrying')
  }
}

export function registerHandlers(config: Config, ports: (runtime: TeeRuntime<Config>) => WorkflowPorts) {
  const cron = new cre.capabilities.CronCapability()
  return ([1, 2] as const).map(checkKind => cre.handlerInTee(
    cron.trigger({ schedule: config.schedule }),
    (runtime: TeeRuntime<Config>) => executeCheck(runtime, checkKind, ports(runtime)),
    [{ tee: 'nitro', regions: ['us-west-2'] }],
  ))
}