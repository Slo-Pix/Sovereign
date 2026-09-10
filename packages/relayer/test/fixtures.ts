import type { Hex } from 'viem'
import { readConfig } from '../src/config'
import { deriveDecisionId, type Adapter, type Agreement, type Block, type Decision, type Evidence, type State, type Store } from '../src/model'

export const h = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
export const cfg = readConfig({ SOURCE_RPC_URL: 'http://127.0.0.1:1', DESTINATION_RPC_URL: 'http://127.0.0.1:2',
  SOURCE_START_BLOCK: '10', DESTINATION_START_BLOCK: '0', MAX_BLOCKS: '3' })
export const block = (n: bigint): Block => ({ number: n, hash: h(Number(n) + 1000) })
export function event(kind = 1, number = 10n, logIndex = 1, result = true): Decision {
  const agreementId = h(1)
  const nonce = BigInt(logIndex + 1)
  return { agreementId, decisionId: deriveDecisionId(agreementId, kind, nonce), checkKind: kind, nonce, result,
    address: cfg.sink, blockNumber: number, blockHash: block(number).hash, logIndex, transactionHash: h(logIndex + 100), removed: false }
}
export const agreement: Agreement = {
  agreementId: h(1), termsHash: h(2), principal: '0x1111111111111111111111111111111111111111',
  counterparty: '0x2222222222222222222222222222222222222222', capital: 100n, policyCommitment: h(3), state: 4,
}
export class MemoryStore implements Store {
  state: State = {}
  writes = 0
  receipts: Evidence[] = []
  load() { return structuredClone(this.state) }
  save(state: State) { this.state = structuredClone(state); this.writes++ }
  evidence(_event: Decision, _action: string, proof: Evidence) { this.receipts.push(proof) }
}
export function fixture(events = [event()]) {
  const store = new MemoryStore()
  const data = {
    state: 0, tuple: { ...agreement }, events, sends: [] as string[], pins: [] as bigint[],
    ranges: [] as [bigint, bigint][], proofs: [] as string[], finalized: 12n, crash: false,
  }
  const rpc: Adapter = {
    preflight: async () => {}, finalized: async () => block(data.finalized),
    sourceBlock: async n => block(n), destinationBlock: async n => block(n), confirmed: async () => block(100n),
    decisions: async (from, to) => { data.ranges.push([from, to]); return data.events },
    agreement: async e => { data.pins.push(e.blockNumber); return { ...agreement, state: e.checkKind === 1 ? 4 : 5 } },
    escrow: async () => ({ ...data.tuple, state: data.state }),
    prove: async (action) => { data.proofs.push(action); return { ...block(100n), transactionHash: h(action === 'lockAgreement' ? 301 : 302) } },
    send: async action => {
      data.sends.push(action); data.state = action === 'lockAgreement' ? 1 : 2
      if (data.crash) throw new Error('Simulated process loss after destination accepted send')
      return h(action === 'lockAgreement' ? 301 : 302)
    },
    wait: async hash => ({ ...block(100n), transactionHash: hash }),
  }
  return { store, data, rpc }
}