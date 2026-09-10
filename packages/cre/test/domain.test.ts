import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodePacked, keccak256, parseAbiParameters, type Hex } from 'viem'
import { hashPolicy, hashTerms, offerDigest } from '../../core/src/index'
import vectors from '../../core/fixtures/vectors.json'
import { deriveDecisionId, encodeDecision, evaluate, parsePolicy, policySchema, termsSchema, type Snapshot } from '../src/domain'

const policy = policySchema.parse(vectors.policy)
const terms = termsSchema.parse(vectors.terms)
const agreementId = `0x${'bb'.repeat(32)}` as Hex
const nowSeconds = 1799999990n
const snapshot: Snapshot = {
  agreementId, intentId: terms.intentId, policyCommitment: vectors.policyCommitment as Hex,
  intentCommitment: vectors.policyCommitment as Hex, termsHash: vectors.termsHash as Hex,
  state: 3, lastNonce: 0n,
}
const input = { agreementId, snapshot, policy, terms, nowSeconds, maxPositionAgeSeconds: 30 }
const position = { agreementId, currentLossBps: 180, elapsedSeconds: 10, timestamp: Number(nowSeconds) }
const breachInput = { ...input, checkKind: 2 as const, snapshot: { ...snapshot, state: 4 }, position }

describe('frozen core parity', () => {
  test('matches every canonical hash without editing or duplicating the encoder', () => {
    expect(hashPolicy(policy)).toBe(vectors.policyCommitment as Hex)
    expect(hashTerms(terms)).toBe(vectors.termsHash as Hex)
    expect(offerDigest(terms, vectors.offer.verifyingContract as Hex)).toBe(vectors.offer.digest as Hex)
  })
  test('detects mutation, field reorder, packed encoding and text salt', () => {
    expect(hashPolicy({ ...policy, maxLossBps: policy.maxLossBps + 1n })).not.toBe(vectors.policyCommitment)
    expect(hashPolicy({ ...policy, maxLossBps: policy.minYieldBps, minYieldBps: policy.maxLossBps })).not.toBe(vectors.policyCommitment)
    expect(keccak256(encodePacked(['uint64', 'uint64', 'uint64', 'bytes32'],
      [policy.minYieldBps, policy.maxLossBps, policy.maxDuration, policy.salt]))).not.toBe(vectors.policyCommitment)
    expect(keccak256(encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,string'),
      [policy.minYieldBps, policy.maxLossBps, policy.maxDuration, policy.salt]))).not.toBe(vectors.policyCommitment)
  })
  test('ABI uint widths share the same padded word for in-range values; enforce range separately', () => {
    expect(encodeAbiParameters([{ type: 'uint64' }], [300n]))
      .toBe(encodeAbiParameters([{ type: 'uint256' }], [300n]))
    expect(() => deriveDecisionId(agreementId, 1, 2n ** 64n)).toThrow()
    expect(() => deriveDecisionId(agreementId, 1, 0n)).toThrow()
  })
  test('decision derivation is exactly the agreed ABI tuple, not the offer nonce', () => {
    const decision = evaluate({ ...input, checkKind: 1, snapshot: { ...snapshot, lastNonce: 41n } })!
    expect(decision.decisionNonce).toBe(42n)
    expect(decision.decisionId).toBe(keccak256(encodeAbiParameters(
      parseAbiParameters('bytes32,uint8,uint64'), [agreementId, 1, 42n])))
    expect(encodeDecision(decision)).toHaveLength(322)
  })
})

describe('validation', () => {
  test('accepts qualifying terms, including inclusive yield/duration/expiration boundaries', () => {
    expect(evaluate({ ...input, checkKind: 1 })?.result).toBe(true)
    const boundaryTerms = { ...terms, duration: policy.maxDuration, yieldBps: policy.minYieldBps, expiresAt: nowSeconds }
    expect(evaluate({ ...input, checkKind: 1, terms: boundaryTerms,
      snapshot: { ...snapshot, termsHash: hashTerms(boundaryTerms) } })?.result).toBe(true)
  })
  test('rejects low yield, overlong duration, expired offers', () => {
    for (const changed of [{ ...terms, yieldBps: 799n }, { ...terms, duration: 2592001n }, { ...terms, expiresAt: nowSeconds - 1n }]) {
      expect(evaluate({ ...input, checkKind: 1, terms: changed,
        snapshot: { ...snapshot, termsHash: hashTerms(changed) } })?.result).toBe(false)
    }
  })
  test('wrong commitment and ordinary rejection have exactly the same public decision', () => {
    const wrong = evaluate({ ...input, checkKind: 1, policy: { ...policy, maxLossBps: 301n } })
    const expired = evaluate({ ...input, checkKind: 1, nowSeconds: terms.expiresAt + 1n })
    expect(wrong).toEqual(expired)
    expect(evaluate({ ...input, checkKind: 1, policy: null })).toEqual(expired)
  })
  test('refuses tampered terms, wrong identities, mismatched intent commitments and terminal state', () => {
    expect(evaluate({ ...input, checkKind: 1, terms: { ...terms, yieldBps: 9999n } })).toBeNull()
    for (const changed of [
      { ...snapshot, agreementId: terms.intentId }, { ...snapshot, intentId: agreementId },
      { ...snapshot, intentCommitment: agreementId }, { ...snapshot, state: 5 },
      { ...snapshot, lastNonce: 2n ** 64n - 1n },
    ]) expect(evaluate({ ...input, checkKind: 1, snapshot: changed })).toBeNull()
  })
})

describe('monitoring', () => {
  test('demo sequence is SAFE four times, then BREACHED; exact threshold stays SAFE', () => {
    expect([180, 210, 250, 280, 310].map(currentLossBps => evaluate({
      ...breachInput, position: { ...position, currentLossBps },
    })?.result)).toEqual([false, false, false, false, true])
    expect(evaluate({ ...breachInput, position: { ...position, currentLossBps: 300 } })?.result).toBe(false)
  })
  test('duration overrun breaches; exact duration is SAFE', () => {
    expect(evaluate({ ...breachInput, position: { ...position, elapsedSeconds: 2592000 } })?.result).toBe(false)
    expect(evaluate({ ...breachInput, position: { ...position, elapsedSeconds: 2592001 } })?.result).toBe(true)
  })
  test('withholds decisions on missing/wrong policy, stale, future, wrong agreement or malformed feed', () => {
    for (const changed of [undefined, {}, { ...position, timestamp: Number(nowSeconds) - 31 },
      { ...position, timestamp: Number(nowSeconds) + 1 }, { ...position, agreementId: terms.intentId },
      { ...position, currentLossBps: -1 }, { ...position, currentLossBps: 1.5 },
      { ...position, elapsedSeconds: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(evaluate({ ...breachInput, position: changed })).toBeNull()
    }
    expect(evaluate({ ...breachInput, policy: null })).toBeNull()
    expect(evaluate({ ...breachInput, policy: { ...policy, maxLossBps: 301n } })).toBeNull()
  })
  test('only ACTIVE may be monitored', () => {
    for (const state of [0, 1, 2, 3, 5, 6, 7, 8, 9]) {
      expect(evaluate({ ...breachInput, snapshot: { ...snapshot, state } })).toBeNull()
    }
  })
})

test('secret parsing never throws or returns diagnostic text', () => {
  for (const raw of ['private malformed payload', '{}', JSON.stringify({ ...vectors.policy, minYieldBps: '-1' }),
    JSON.stringify({ ...vectors.policy, maxLossBps: 300 }),
    JSON.stringify({ ...vectors.policy, maxDuration: (2n ** 256n).toString() })]) {
    expect(parsePolicy(raw)).toBeNull()
  }
  expect(parsePolicy(JSON.stringify(vectors.policy))).toEqual(policy)
})