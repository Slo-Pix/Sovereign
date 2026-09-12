import { hashPolicy, hashTerms, type Policy, type Terms } from '../../core/src/index'
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from 'viem'
import { z } from 'zod'

export const uint256 = z.string().regex(/^(0|[1-9][0-9]*)$/)
  .transform(BigInt).refine(value => value < 2n ** 256n)
export const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value as Hex)
// ABI encoding is case-insensitive, while viem rejects mixed-case addresses with
// an invalid EIP-55 checksum. Canonicalize casing at the config/chain boundary.
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
  .transform(value => value.toLowerCase() as Hex)
export const policySchema = z.object({
  minYieldBps: uint256,
  maxLossBps: uint256,
  maxDuration: uint256,
  salt: bytes32,
}).strict()
export const termsSchema = z.object({
  intentId: bytes32,
  principal: address,
  counterparty: address,
  capital: uint256,
  duration: uint256,
  yieldBps: uint256,
  expiresAt: uint256,
  nonce: uint256,
}).strict()
const safeUint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const positionSchema = z.object({
  agreementId: bytes32,
  currentLossBps: safeUint,
  elapsedSeconds: safeUint,
  timestamp: safeUint,
}).strict()
export type Position = z.infer<typeof positionSchema>
export type CheckKind = 1 | 2
export type Decision = {
  agreementId: Hex
  decisionId: Hex
  checkKind: CheckKind
  result: boolean
  decisionNonce: bigint
}
export type Snapshot = {
  agreementId: Hex
  intentId: Hex
  policyCommitment: Hex
  intentCommitment: Hex
  termsHash: Hex
  state: number
  lastNonce: bigint
}

// Fixed-iteration byte comparison; JavaScript does not guarantee constant-time execution.
export function equalHash(a: Hex, b: Hex): boolean {
  if (!/^0x[0-9a-f]{64}$/i.test(a) || !/^0x[0-9a-f]{64}$/i.test(b)) return false
  let difference = 0
  for (let i = 2; i < 66; i += 2) {
    difference |= Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16)
  }
  return difference === 0
}

// Never allow parser diagnostics (which can include secret values) to escape.
export function parsePolicy(raw: string): Policy | null {
  try {
    const parsed = policySchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export const decisionIdParameters = parseAbiParameters('bytes32 agreementId, uint8 checkKind, uint64 nonce')
export const decisionParameters = parseAbiParameters('bytes32 agreementId, bytes32 decisionId, uint8 checkKind, bool result, uint64 nonce')
export function deriveDecisionId(agreementId: Hex, checkKind: CheckKind, decisionNonce: bigint): Hex {
  if (decisionNonce <= 0n || decisionNonce >= 2n ** 64n) throw new Error('Invalid decision nonce')
  return keccak256(encodeAbiParameters(decisionIdParameters, [agreementId, checkKind, decisionNonce]))
}
export function encodeDecision(decision: Decision): Hex {
  return encodeAbiParameters(decisionParameters, [decision.agreementId, decision.decisionId,
    decision.checkKind, decision.result, decision.decisionNonce])
}

export function evaluate(input: {
  checkKind: CheckKind
  agreementId: Hex
  snapshot: Snapshot
  policy: Policy | null
  terms: Terms
  position?: unknown
  nowSeconds: bigint
  maxPositionAgeSeconds: number
}): Decision | null {
  try {
    const { checkKind, agreementId, snapshot, policy, terms, nowSeconds } = input
    if (!equalHash(agreementId, snapshot.agreementId) ||
        snapshot.state !== (checkKind === 1 ? 3 : 4) ||
        snapshot.lastNonce < 0n || snapshot.lastNonce >= 2n ** 64n - 1n ||
        nowSeconds < 0n || !equalHash(terms.intentId, snapshot.intentId) ||
        !equalHash(hashTerms(terms), snapshot.termsHash) ||
        !equalHash(snapshot.policyCommitment, snapshot.intentCommitment)) return null

    const matches = policy !== null && equalHash(hashPolicy(policy), snapshot.policyCommitment)
    let result: boolean
    if (checkKind === 1) {
      // Expiration is inclusive, matching AgreementRegistry's block.timestamp > expiresAt guard.
      result = matches && policy !== null && terms.capital > 0n && terms.duration > 0n &&
        terms.yieldBps >= policy.minYieldBps && terms.duration <= policy.maxDuration &&
        nowSeconds <= terms.expiresAt
    } else {
      // Missing/wrong policy or unusable feed must never masquerade as SAFE or BREACHED.
      if (!matches || policy === null) return null
      const parsed = positionSchema.safeParse(input.position)
      if (!parsed.success || !Number.isSafeInteger(input.maxPositionAgeSeconds) ||
          input.maxPositionAgeSeconds < 0) return null
      const position = parsed.data
      const age = nowSeconds - BigInt(position.timestamp)
      if (!equalHash(position.agreementId, agreementId) || age < 0n ||
          age > BigInt(input.maxPositionAgeSeconds)) return null
      result = BigInt(position.currentLossBps) > policy.maxLossBps ||
        BigInt(position.elapsedSeconds) > policy.maxDuration
    }
    const decisionNonce = snapshot.lastNonce + 1n
    return { agreementId, decisionId: deriveDecisionId(agreementId, checkKind, decisionNonce),
      checkKind, result, decisionNonce }
  } catch {
    // Chain/provider values are an untrusted boundary; malformed values fail closed.
    return null
  }
}
