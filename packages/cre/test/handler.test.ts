import { expect, test } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import type { Hex } from 'viem'
import vectors from '../../core/fixtures/vectors.json'
import { configSchema, type Config } from '../src/config'
import example from '../sovereign/config.example.json'
import { executeCheck, registerHandlers, type WorkflowPorts } from '../src/handler'
import type { Decision, Snapshot } from '../src/domain'

const id = `0x${'bb'.repeat(32)}` as Hex
function harness() {
  const publicRequests: unknown[] = []
  const logs: string[] = []
  const config = configSchema.parse({ ...example, agreementId: id, terms: vectors.terms })
  const runtime = {
    config, now: () => new Date(1799999990000),
    getSecret: () => ({ result: () => ({ value: JSON.stringify(vectors.policy) }) }),
    log: (value: string) => logs.push(value),
  } as unknown as TeeRuntime<Config>
  const snapshot: Snapshot = { agreementId: id, intentId: config.terms.intentId,
    policyCommitment: vectors.policyCommitment as Hex, intentCommitment: vectors.policyCommitment as Hex,
    termsHash: vectors.termsHash as Hex, state: 3, lastNonce: 0n }
  const ports: WorkflowPorts = {
    readSnapshot: () => ({ ...snapshot }),
    readPosition: () => ({ agreementId: id, currentLossBps: 310, elapsedSeconds: 10, timestamp: 1799999990 }),
    publish: (decision: Decision) => { publicRequests.push(decision); return { delivery: 'report-only' } },
  }
  return { runtime, ports, snapshot, publicRequests, logs }
}

test('both checks are genuine SDK TEE handler registrations', () => {
  const { runtime, ports } = harness()
  const handlers = registerHandlers(runtime.config, () => ports)
  expect(handlers).toHaveLength(2)
  expect(handlers.every(handler => handler.requirements !== undefined)).toBe(true)
})
test('public surface contains only allowed decision fields and no secret values or logs', () => {
  const { runtime, ports, publicRequests, logs } = harness()
  const result = executeCheck(runtime, 1, ports)
  expect(JSON.parse(result).result).toBe(true)
  expect(logs).toEqual([])
  const captured = JSON.stringify([result, publicRequests], (_, value) => typeof value === 'bigint' ? value.toString() : value)
  for (const name of Object.keys(vectors.policy)) expect(captured).not.toContain(name)
  expect(captured).not.toContain(vectors.policy.salt)
  expect(Object.keys(publicRequests[0] as object).sort()).toEqual(
    ['agreementId', 'checkKind', 'decisionId', 'decisionNonce', 'result'])
})
test('nonce changes during evaluation suppress the report', () => {
  const { runtime, ports, snapshot, publicRequests } = harness()
  let reads = 0
  ports.readSnapshot = () => ({ ...snapshot, lastNonce: BigInt(reads++) })
  expect(executeCheck(runtime, 1, ports)).toBe('NO_DECISION')
  expect(publicRequests).toEqual([])
})
test('missing feed emits no decision, never SAFE', () => {
  const { runtime, ports, snapshot, publicRequests } = harness()
  snapshot.state = 4
  ports.readPosition = () => undefined
  expect(executeCheck(runtime, 2, ports)).toBe('NO_DECISION')
  expect(publicRequests).toEqual([])
})
test('SAFE and exact-boundary monitoring never publish or expose a verdict in either delivery mode', () => {
  for (const delivery of ['report-only', 'sepolia'] as const) {
    for (const currentLossBps of [180, 210, 250, 280, 300]) {
      const { runtime, ports, snapshot, publicRequests, logs } = harness()
      runtime.config.delivery = delivery
      snapshot.state = 4
      snapshot.lastNonce = 7n
      ports.readPosition = () => ({ agreementId: id, currentLossBps, elapsedSeconds: 10, timestamp: 1799999990 })
      expect(executeCheck(runtime, 2, ports)).toBe('NO_DECISION')
      expect(publicRequests).toEqual([])
      expect(logs).toEqual([])
      expect(snapshot.lastNonce).toBe(7n)
    }
  }
})
test('SAFE, stale and commitment-mismatch monitoring share the same neutral output', () => {
  const { runtime, ports, snapshot, publicRequests } = harness()
  snapshot.state = 4
  ports.readPosition = () => ({ agreementId: id, currentLossBps: 280, elapsedSeconds: 10, timestamp: 1799999990 })
  const safe = executeCheck(runtime, 2, ports)
  ports.readPosition = () => undefined
  expect(executeCheck(runtime, 2, ports)).toBe(safe)
  snapshot.policyCommitment = id
  snapshot.intentCommitment = id
  expect(executeCheck(runtime, 2, ports)).toBe(safe)
  expect(publicRequests).toEqual([])
})
test('only the actionable breach publishes during the adverse sequence; no publication after terminal state', () => {
  const { runtime, ports, snapshot, publicRequests, logs } = harness()
  snapshot.state = 4
  snapshot.lastNonce = 7n
  for (const currentLossBps of [180, 210, 250, 280]) {
    ports.readPosition = () => ({ agreementId: id, currentLossBps, elapsedSeconds: 10, timestamp: 1799999990 })
    expect(executeCheck(runtime, 2, ports)).toBe('NO_DECISION')
  }
  ports.readPosition = () => ({ agreementId: id, currentLossBps: 310, elapsedSeconds: 10, timestamp: 1799999990 })
  const result = JSON.parse(executeCheck(runtime, 2, ports))
  expect(result).toMatchObject({ checkKind: 2, result: true, decisionNonce: '8' })
  expect(publicRequests).toHaveLength(1)
  expect(Object.keys(publicRequests[0] as object).sort()).toEqual(
    ['agreementId', 'checkKind', 'decisionId', 'decisionNonce', 'result'])
  // Model the receipt-confirmed on-chain transition, not an optimistic local transition.
  snapshot.state = 5
  snapshot.lastNonce = 8n
  expect(executeCheck(runtime, 2, ports)).toBe('NO_DECISION')
  expect(publicRequests).toHaveLength(1)
  expect(logs).toEqual([])
})
test('secret and HTTP provider errors are sanitized', () => {
  const { runtime, ports, publicRequests } = harness()
  runtime.getSecret = () => { throw new Error(JSON.stringify(vectors.policy)) }
  expect(() => executeCheck(runtime, 1, ports)).toThrow('Workflow execution failed; inspect public chain state before retrying')
  expect(publicRequests).toEqual([])
})
test('configuration rejects policy input and direct writes to the incompatible sink', () => {
  expect(configSchema.safeParse({ ...example, policy: vectors.policy }).success).toBe(false)
  expect(configSchema.safeParse({ ...example, delivery: 'sepolia' }).success).toBe(false)
  expect(configSchema.safeParse({ ...example, delivery: 'sepolia', reportReceiver: example.decisionSink }).success).toBe(false)
})