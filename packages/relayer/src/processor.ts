import {
  deriveDecisionId, equalTuple, nonzero32, requireRelay, same, validateAgreement,
  type Adapter, type Block, type Escrow, type Plan, type Settings, type Store,
} from './model'

/** One bounded batch. The caller holds an exclusive SQLite write transaction for this entire await. */
export async function processOnce(cfg: Settings, rpc: Adapter, store: Store, broadcast = false): Promise<Plan[]> {
  await rpc.preflight()
  const state = store.load()
  if (state.cursor) {
    requireRelay(same((await rpc.sourceBlock(state.cursor.number)).hash, state.cursor.hash),
      'Source cursor reorg mismatch; stop and investigate. Never reset the cursor automatically.')
  }
  if (state.destination) {
    requireRelay(same((await rpc.destinationBlock(state.destination.number)).hash, state.destination.hash),
      'Destination checkpoint reorg mismatch; stop and reconcile manually.')
  }
  const finalized = await rpc.finalized()
  requireRelay(!state.cursor || finalized.number >= state.cursor.number, 'Source finalized head regressed.')
  const from = state.cursor ? state.cursor.number + 1n : cfg.sourceStart
  if (from > finalized.number) return []
  const to = from + cfg.maxBlocks - 1n < finalized.number ? from + cfg.maxBlocks - 1n : finalized.number
  const end = await rpc.sourceBlock(to)
  const events = (await rpc.decisions(from, to)).sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex)
  const seen = new Set<string>()
  const sourceAnchors = new Map<bigint, Block>([[finalized.number, finalized], [to, end]])
  if (state.cursor) sourceAnchors.set(state.cursor.number, state.cursor)
  const destinationAnchors = new Map<bigint, Block>()
  // Dry-run projections allow ACCEPT -> BREACH planning without writing or pretending RPC state changed.
  const projected = new Map<string, Escrow>()
  const plans: Plan[] = []
  let destination = state.destination
  for (const event of events) {
    requireRelay(same(event.address, cfg.sink) && !event.removed && event.blockNumber >= from
      && event.blockNumber <= to && Number.isSafeInteger(event.logIndex) && event.logIndex >= 0
      && nonzero32(event.transactionHash), 'Unauthenticated, removed, or out-of-range source log.')
    const position = `${event.blockNumber}:${event.logIndex}`
    requireRelay(!seen.has(position), 'Duplicate source log position; refusing ambiguous RPC results.')
    seen.add(position)
    const block = await rpc.sourceBlock(event.blockNumber)
    requireRelay(same(block.hash, event.blockHash), 'Source event block hash mismatch.')
    sourceAnchors.set(block.number, block)
    requireRelay(nonzero32(event.decisionId)
      && same(event.decisionId, deriveDecisionId(event.agreementId, event.checkKind, event.nonce)),
    'Decision ID does not match keccak256(abi.encode(agreementId,uint8 checkKind,uint64 nonce)).')
    requireRelay(typeof event.result === 'boolean', 'Invalid decision result.')
    const plan: Plan = {
      sourceBlock: event.blockNumber.toString(), logIndex: event.logIndex,
      agreementId: event.agreementId, decisionId: event.decisionId,
      action: 'ignore', outcome: 'non-actionable',
    }
    if (!event.result) { plans.push(plan); continue }
    const action = event.checkKind === 1 ? 'lockAgreement' : 'unwind'
    const agreement = await rpc.agreement(event)
    validateAgreement(agreement, event)
    // Recheck after the historical read, before permitting any destination action.
    requireRelay(same((await rpc.sourceBlock(block.number)).hash, block.hash), 'Source changed during agreement read.')
    const at = await rpc.confirmed()
    destinationAnchors.set(at.number, at)
    const key = event.agreementId.toLowerCase()
    const virtual = projected.get(key)
    const escrow = virtual ?? await rpc.escrow(event.agreementId, at)
    if (escrow.state !== 0) requireRelay(equalTuple(agreement, escrow), 'Destination escrow tuple mismatch; do not retry with altered terms.')
    requireRelay([0, 1, 2].includes(escrow.state), 'Unexpected destination state (including SETTLED); manual reconciliation required.')
    if (action === 'unwind') requireRelay(escrow.state !== 0, 'Cannot unwind missing escrow; restore earlier ACCEPT history/funding first.')
    const already = action === 'lockAgreement' ? escrow.state !== 0 : escrow.state === 2
    plan.action = action
    if (already && !virtual) {
      // UNWOUND alone is insufficient: the event must bind the expected decision ID and returned capital.
      const proof = await rpc.prove(action, event, agreement, at)
      destinationAnchors.set(proof.number, proof)
      requireRelay(same((await rpc.destinationBlock(proof.number)).hash, proof.hash), 'Destination recovery proof reorg mismatch.')
      plan.outcome = 'reconciled'
      plan.transactionHash = proof.transactionHash
      if (broadcast) store.evidence(event, action, proof)
    } else if (!broadcast) {
      plan.outcome = already ? 'reconciled' : 'planned'
      if (virtual && action === 'unwind') plan.dependsOnPlannedLock = true
      projected.set(key, { ...agreement, state: action === 'lockAgreement' ? Math.max(escrow.state, 1) : 2 })
    } else {
      const hash = await rpc.send(action, event, agreement)
      const receipt = await rpc.wait(hash)
      destinationAnchors.set(receipt.number, receipt)
      requireRelay(same(receipt.transactionHash, hash), 'Unexpected replacement transaction; inspect the relayer nonce.')
      requireRelay(same((await rpc.destinationBlock(receipt.number)).hash, receipt.hash), 'Destination receipt reorg mismatch.')
      const after = await rpc.escrow(event.agreementId, receipt)
      requireRelay(equalTuple(agreement, after) && after.state === (action === 'lockAgreement' ? 1 : 2),
        'Confirmed transaction did not produce the expected complete escrow tuple/state.')
      const proof = await rpc.prove(action, event, agreement, receipt)
      requireRelay(same(proof.transactionHash, hash), 'Expected escrow event missing from the submitted transaction.')
      store.evidence(event, action, receipt)
      plan.outcome = 'confirmed'
      plan.transactionHash = hash
    }
    requireRelay(same((await rpc.destinationBlock(at.number)).hash, at.hash), 'Destination snapshot reorg mismatch.')
    // Also anchor recovery-only and no-send batches to a confirmation-qualified destination block.
    const latestConfirmed = await rpc.confirmed()
    destination = latestConfirmed
    plans.push(plan)
  }
  for (const anchor of sourceAnchors.values()) {
    requireRelay(same((await rpc.sourceBlock(anchor.number)).hash, anchor.hash), 'Source changed before checkpoint; batch not committed.')
  }
  for (const anchor of destinationAnchors.values()) {
    requireRelay(same((await rpc.destinationBlock(anchor.number)).hash, anchor.hash), 'Destination receipt/proof changed before checkpoint.')
  }
  if (destination) requireRelay(same((await rpc.destinationBlock(destination.number)).hash, destination.hash), 'Destination changed before checkpoint.')
  if (broadcast) store.save({ cursor: end, destination })
  return plans
}