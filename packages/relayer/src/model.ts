import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'

export class RelayError extends Error {}
// Only constant, operator-safe messages may be passed here. Never RPC errors or env values.
export function requireRelay(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RelayError(message)
}
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export const nonzero32 = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0+$/.test(v)
export const nonzeroAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0+$/.test(v)
export type Block = { number: bigint; hash: Hex }
export type Evidence = Block & { transactionHash: Hex }
export type Decision = {
  address: Address; blockNumber: bigint; blockHash: Hex; logIndex: number
  transactionHash: Hex; removed: boolean
  agreementId: Hex; decisionId: Hex; checkKind: number; result: boolean; nonce: bigint
}
export type Agreement = {
  agreementId: Hex; termsHash: Hex; principal: Address; counterparty: Address
  capital: bigint; policyCommitment: Hex; state: number
}
export type Escrow = Agreement
export type Action = 'lockAgreement' | 'unwind'
export type Plan = {
  sourceBlock: string; logIndex: number; agreementId: Hex; decisionId: Hex
  action: Action | 'ignore'; outcome: 'planned' | 'confirmed' | 'reconciled' | 'non-actionable'
  dependsOnPlannedLock?: boolean; transactionHash?: Hex
}
export type Settings = {
  sourceChain: number; destinationChain: number; sink: Address; registry: Address
  escrow: Address; token: Address; relayer: Address
  sourceStart: bigint; destinationStart: bigint; maxBlocks: bigint; confirmations: number
}
export type State = { cursor?: Block; destination?: Block }
export interface Store {
  load(): State
  save(state: State): void
  evidence(decision: Decision, action: Action, evidence: Evidence): void
}
export interface Adapter {
  preflight(): Promise<void>
  finalized(): Promise<Block>
  sourceBlock(number: bigint): Promise<Block>
  decisions(from: bigint, to: bigint): Promise<Decision[]>
  agreement(event: Decision): Promise<Agreement>
  destinationBlock(number: bigint): Promise<Block>
  confirmed(): Promise<Block>
  escrow(id: Hex, at: Block): Promise<Escrow>
  prove(action: Action, event: Decision, agreement: Agreement, at: Block): Promise<Evidence>
  send(action: Action, event: Decision, agreement: Agreement): Promise<Hex>
  wait(hash: Hex): Promise<Evidence>
}
export function deriveDecisionId(id: Hex, kind: number, nonce: bigint): Hex {
  requireRelay(nonzero32(id) && (kind === 1 || kind === 2) && nonce > 0n && nonce < 2n ** 64n,
    'Invalid agreement ID, decision kind, or nonce; inspect the source event.')
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint8,uint64'), [id, kind, nonce]))
}
export function validateAgreement(a: Agreement, e: Decision): void {
  requireRelay(same(a.agreementId, e.agreementId) && nonzero32(a.termsHash) && nonzero32(a.policyCommitment)
    && nonzeroAddress(a.principal) && nonzeroAddress(a.counterparty) && !same(a.principal, a.counterparty)
    && a.capital > 0n, 'Invalid canonical agreement tuple at the source event block.')
  // eth_call is end-of-block: later transactions in the SAME block may already mark it terminal.
  const allowed = e.checkKind === 1 ? [4, 5, 6, 7] : [5, 6, 7]
  requireRelay(allowed.includes(a.state), 'Source agreement state is incompatible with the decision.')
}
export function equalTuple(a: Agreement, b: Agreement): boolean {
  return same(a.agreementId, b.agreementId) && same(a.termsHash, b.termsHash)
    && same(a.principal, b.principal) && same(a.counterparty, b.counterparty)
    && a.capital === b.capital && same(a.policyCommitment, b.policyCommitment)
}