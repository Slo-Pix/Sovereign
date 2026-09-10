import { describe, expect, test } from 'bun:test'
import { deriveDecisionId } from '../src/model'
import { processOnce } from '../src/processor'
import { agreement, block, cfg, event, fixture, h } from './fixtures'

describe('finalized source ordering and planning', () => {
  test('sorts by block then logIndex, pins historical reads, sends ACCEPT then BREACH', async () => {
    const f = fixture([event(2, 11n, 3), event(1, 10n, 7)])
    const plans = await processOnce(cfg, f.rpc, f.store, true)
    expect(f.data.sends).toEqual(['lockAgreement', 'unwind'])
    expect(f.data.pins).toEqual([10n, 11n])
    expect(plans.map(p => p.outcome)).toEqual(['confirmed', 'confirmed'])
    expect(f.store.state.cursor).toEqual(block(12n))
    expect(f.store.receipts).toHaveLength(2)
  })
  test('orders same-block log indices despite terminal end-of-block registry state', async () => {
    const f = fixture([event(2, 10n, 8), event(1, 10n, 2)])
    f.rpc.agreement = async () => ({ ...agreement, state: 7 })
    await processOnce(cfg, f.rpc, f.store, true)
    expect(f.data.sends).toEqual(['lockAgreement', 'unwind'])
  })
  test('dry-run is default, projects sequential actions, never writes evidence/cursor or sends', async () => {
    const f = fixture([event(), event(2, 11n, 3)])
    const plans = await processOnce(cfg, f.rpc, f.store)
    expect(plans.map(p => p.action)).toEqual(['lockAgreement', 'unwind'])
    expect(plans[1]?.dependsOnPlannedLock).toBe(true)
    expect(f.data.state).toBe(0)
    expect(f.data.sends).toHaveLength(0)
    expect(f.store.writes).toBe(0)
    expect(f.store.receipts).toHaveLength(0)
  })
  test('REJECT and SAFE never cause transactions or agreement reads', async () => {
    const f = fixture([event(1, 10n, 1, false), event(2, 11n, 3, false)])
    const plans = await processOnce(cfg, f.rpc, f.store, true)
    expect(plans.map(p => p.action)).toEqual(['ignore', 'ignore'])
    expect(f.data.sends).toHaveLength(0)
    expect(f.data.pins).toHaveLength(0)
  })
  test('starts exactly at explicit origin, caps range, then resumes next unscanned block', async () => {
    const f = fixture([])
    f.data.finalized = 10000000n
    await processOnce(cfg, f.rpc, f.store, true)
    await processOnce(cfg, f.rpc, f.store, true)
    expect(f.data.ranges).toEqual([[10n, 12n], [13n, 15n]])
  })
  test('does not advance when origin is ahead of finalized head', async () => {
    const f = fixture([]); f.data.finalized = 9n
    expect(await processOnce(cfg, f.rpc, f.store, true)).toEqual([])
    expect(f.store.writes).toBe(0)
  })
})

describe('fail-closed authentication and reorgs', () => {
  const invalid = [
    ['wrong sink', { address: agreement.principal }], ['removed log', { removed: true }],
    ['not finalized', { blockNumber: 13n }], ['before origin', { blockNumber: 9n }],
    ['block mismatch', { blockHash: h(9) }], ['zero ID', { decisionId: h(0) }],
    ['wrong derivation', { decisionId: h(42) }], ['zero agreement', { agreementId: h(0) }],
    ['invalid kind', { checkKind: 3 }], ['zero nonce', { nonce: 0n }],
    ['overflow nonce', { nonce: 2n ** 64n }], ['invalid index', { logIndex: -1 }],
  ] as const
  for (const [name, override] of invalid) test(name, async () => {
    const f = fixture([{ ...event(), ...override }])
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow()
    expect(f.data.sends).toHaveLength(0); expect(f.store.writes).toBe(0)
  })
  test('duplicate log positions are not silently deduplicated', async () => {
    const f = fixture([event(), event()])
    await expect(processOnce(cfg, f.rpc, f.store)).rejects.toThrow('Duplicate')
    expect(f.store.writes).toBe(0)
  })
  test('persisted source hash checked before next range; mismatch is never reset', async () => {
    const f = fixture([]); f.store.state.cursor = { ...block(9n), hash: h(8) }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('cursor reorg')
    expect(f.data.ranges).toHaveLength(0); expect(f.store.state.cursor.hash).toBe(h(8))
  })
  test('persisted destination hash mismatch stops even an empty source batch', async () => {
    const f = fixture([]); f.store.state.destination = { ...block(9n), hash: h(8) }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('Destination checkpoint')
  })
  test('source finalized regression fails', async () => {
    const f = fixture([]); f.store.state.cursor = block(13n)
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('regressed')
  })
  test('event block change during historical read aborts before send', async () => {
    const f = fixture(); let changed = false
    f.rpc.agreement = async () => { changed = true; return agreement }
    f.rpc.sourceBlock = async n => changed && n === 10n ? { number: n, hash: h(99) } : block(n)
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('changed during')
    expect(f.data.sends).toHaveLength(0)
  })
  test('receipt reorg stops checkpoint', async () => {
    const f = fixture(); f.rpc.wait = async hash => ({ ...block(100n), hash: h(9), transactionHash: hash })
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('receipt reorg')
    expect(f.store.writes).toBe(0)
  })
  test('receipt reorg AFTER initial check is caught before commit', async () => {
    const f = fixture(); let reads = 0
    f.rpc.destinationBlock = async n => { reads++; return reads >= 3 ? { number: n, hash: h(9) } : block(n) }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('changed before checkpoint')
    expect(f.store.writes).toBe(0)
  })
})

describe('crash recovery and exact state reconciliation', () => {
  test('crash after send replays from unchanged cursor and reconciles the full tuple', async () => {
    const f = fixture(); f.data.crash = true
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('process loss')
    expect(f.store.writes).toBe(0)
    f.data.crash = false
    const plans = await processOnce(cfg, f.rpc, f.store, true)
    expect(f.data.sends).toEqual(['lockAgreement']); expect(plans[0]?.outcome).toBe('reconciled')
    expect(f.data.proofs).toEqual(['lockAgreement'])
  })
  test('whole-batch rollback after unwind allows ACCEPT proof then expected unwind proof on restart', async () => {
    const f = fixture([event(), event(2, 11n, 3)])
    const send = f.rpc.send
    f.rpc.send = async (...args) => {
      const hash = await send(...args)
      if (args[0] === 'unwind') throw new Error('crash')
      return hash
    }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('crash')
    expect(f.store.writes).toBe(0)
    const plans = await processOnce(cfg, f.rpc, f.store, true)
    expect(plans.map(p => p.outcome)).toEqual(['reconciled', 'reconciled'])
    expect(f.data.sends).toEqual(['lockAgreement', 'unwind'])
  })
  for (const field of ['agreementId', 'termsHash', 'principal', 'counterparty', 'capital', 'policyCommitment'] as const) {
    test(`mismatched stored ${field} never counts as already processed`, async () => {
      const f = fixture(); f.data.state = 1
      if (field === 'capital') f.data.tuple.capital = 999n
      else if (field === 'principal' || field === 'counterparty') f.data.tuple[field] = cfg.escrow
      else f.data.tuple[field] = h(99)
      await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('tuple mismatch')
      expect(f.data.sends).toHaveLength(0); expect(f.store.writes).toBe(0)
    })
  }
  test('UNWOUND requires expected decision proof, not just the stored enum', async () => {
    const f = fixture([event(2)]); f.data.state = 2
    f.rpc.prove = async () => { throw new Error('decisionId mismatch') }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('decisionId mismatch')
    expect(f.store.writes).toBe(0)
  })
  test('missing escrow cannot unwind', async () => {
    const f = fixture([event(2)])
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('missing escrow')
  })
  test('SETTLED is an operational error, not idempotent success', async () => {
    const f = fixture(); f.data.state = 3
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('SETTLED')
  })
  test('invalid canonical tuple/state fails', async () => {
    const f = fixture(); f.rpc.agreement = async () => ({ ...agreement, state: 9 })
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('incompatible')
    f.rpc.agreement = async () => ({ ...agreement, capital: 0n })
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('Invalid canonical')
  })
  test('receipt success with wrong post-state fails without cursor', async () => {
    const f = fixture(); f.rpc.send = async () => h(301)
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('complete escrow tuple/state')
    expect(f.store.writes).toBe(0)
  })
  test('transaction wait failure never skips the event', async () => {
    const f = fixture(); f.rpc.wait = async () => { throw new Error('timeout') }
    await expect(processOnce(cfg, f.rpc, f.store, true)).rejects.toThrow('timeout')
    expect(f.store.writes).toBe(0)
  })
  test('decision ID uses ABI encoding, not packed encoding', () => {
    expect(deriveDecisionId(h(1), 1, 2n)).toBe(event().decisionId)
    expect(deriveDecisionId(h(1), 2, 2n)).not.toBe(event().decisionId)
  })
})