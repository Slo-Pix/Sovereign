import {
  getAbiItem, type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem'
import { escrowAbi, registryAbi, sinkAbi } from './abi'
import {
  equalTuple, requireRelay, same, type Action, type Adapter, type Agreement, type Block,
  type Decision, type Evidence, type Settings,
} from './model'

export type Identity = {
  sourceChain: number; destinationChain: number; registry: Address; sink: Address
  relayer: Address; token: Address; signer?: Address
  sourceCode: Hex | undefined; registryCode: Hex | undefined
  escrowCode: Hex | undefined; tokenCode: Hex | undefined; relayerCode: Hex | undefined
}
export function validateIdentity(cfg: Settings, info: Identity): void {
  requireRelay(info.sourceChain === 11155111 && info.sourceChain === cfg.sourceChain
    && info.destinationChain === 5042002 && info.destinationChain === cfg.destinationChain,
  'RPC chain mismatch: require Sepolia 11155111 and Arc Testnet 5042002.')
  requireRelay(same(info.registry, cfg.registry) && same(info.sink, cfg.sink), 'DecisionSink/AgreementRegistry wiring mismatch.')
  requireRelay(same(info.token, cfg.token), 'Escrow token differs from canonical USDC.')
  requireRelay(same(info.relayer, cfg.relayer) && (!info.signer || same(info.signer, info.relayer)),
    'Escrow relayer, canonical relayer, and signing-key address must match.')
  requireRelay([info.sourceCode, info.registryCode, info.escrowCode, info.tokenCode].every(code => code && code !== '0x'),
    'Missing bytecode at a canonical contract/token address.')
  requireRelay(!info.relayerCode || info.relayerCode === '0x', 'Configured relayer must be an EOA, not a contract/delegated account.')
}
const asBlock = (b: { number: bigint | null; hash: Hex | null }): Block => {
  requireRelay(b.number !== null && b.hash !== null, 'RPC returned a pending/missing block.')
  return { number: b.number, hash: b.hash }
}

/** Real viem transport; accepts injected clients for offline adapter tests. */
export function createAdapter(cfg: Settings, source: PublicClient, destination: PublicClient, wallet?: WalletClient): Adapter {
  const sourceBlock = async (number: bigint) => asBlock(await source.getBlock({ blockNumber: number }))
  const destinationBlock = async (number: bigint) => asBlock(await destination.getBlock({ blockNumber: number }))
  const finalized = async () => asBlock(await source.getBlock({ blockTag: 'finalized' }))
  const confirmed = async () => {
    // No Arc finalized-tag assumption. viem confirmations count includes the receipt block itself.
    const head = await destination.getBlockNumber({ cacheTime: 0 })
    requireRelay(head >= BigInt(cfg.confirmations - 1), 'Destination chain is too short for configured confirmations.')
    return destinationBlock(head - BigInt(cfg.confirmations - 1))
  }
  const preflight = async () => {
    const sourceChain = await source.getChainId()
    const destinationChain = await destination.getChainId()
    requireRelay(sourceChain === cfg.sourceChain && destinationChain === cfg.destinationChain
      && sourceChain === 11155111 && destinationChain === 5042002, 'RPC chain mismatch: expected Sepolia and Arc Testnet.')
    const at = await finalized()
    const [registry, sink, relayer, token, sourceCode, registryCode, escrowCode, tokenCode, relayerCode] = await Promise.all([
      source.readContract({ address: cfg.sink, abi: sinkAbi, functionName: 'agreementRegistry', blockNumber: at.number }),
      source.readContract({ address: cfg.registry, abi: registryAbi, functionName: 'decisionSink', blockNumber: at.number }),
      destination.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: 'relayer' }),
      destination.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: 'token' }),
      source.getCode({ address: cfg.sink, blockNumber: at.number }),
      source.getCode({ address: cfg.registry, blockNumber: at.number }),
      destination.getCode({ address: cfg.escrow }), destination.getCode({ address: cfg.token }),
      destination.getCode({ address: cfg.relayer }),
    ])
    validateIdentity(cfg, { sourceChain, destinationChain, registry, sink, relayer, token, sourceCode,
      registryCode, escrowCode, tokenCode, relayerCode, signer: wallet?.account?.address })
    requireRelay(!wallet || wallet.account, 'Broadcast wallet is missing its local account.')
  }
  const escrow = async (id: Hex, at: Block): Promise<Agreement> => {
    const a = await destination.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: 'escrows', args: [id], blockNumber: at.number })
    return { agreementId: a[0], termsHash: a[1], principal: a[2], counterparty: a[3], capital: a[4], policyCommitment: a[5], state: a[6] }
  }
  return {
    preflight, sourceBlock, destinationBlock, finalized, confirmed, escrow,
    async decisions(from, to) {
      requireRelay(to >= from && to - from < cfg.maxBlocks, 'Source log range exceeds MAX_BLOCKS.')
      const logs = await source.getLogs({ address: cfg.sink, event: getAbiItem({ abi: sinkAbi, name: 'DecisionRecorded' }),
        fromBlock: from, toBlock: to, strict: false })
      return logs.map(log => {
        requireRelay(log.blockNumber !== null && log.blockHash !== null && log.logIndex !== null && log.transactionHash !== null,
          'Source RPC returned a pending decision log.')
        const { agreementId, decisionId, checkKind, result, nonce } = log.args
        requireRelay(agreementId !== undefined && decisionId !== undefined && checkKind !== undefined
          && result !== undefined && nonce !== undefined, 'Malformed DecisionRecorded log; refusing to skip it.')
        return { agreementId, decisionId, checkKind, result, nonce, address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash,
          transactionHash: log.transactionHash, logIndex: log.logIndex, removed: log.removed }
      })
    },
    async agreement(event) {
      const blockNumber = event.blockNumber
      const registry = await source.readContract({ address: cfg.sink, abi: sinkAbi, functionName: 'agreementRegistry', blockNumber })
      const sink = await source.readContract({ address: cfg.registry, abi: registryAbi, functionName: 'decisionSink', blockNumber })
      requireRelay(same(registry, cfg.registry) && same(sink, cfg.sink), 'Historical source contract wiring mismatch.')
      const a = await source.readContract({ address: cfg.registry, abi: registryAbi, functionName: 'agreements', args: [event.agreementId], blockNumber })
      return { agreementId: a[0], principal: a[2], counterparty: a[3], capital: a[4], termsHash: a[7], policyCommitment: a[8], state: a[9] }
    },
    async prove(action, event, agreement, at) {
      let proof: Evidence | undefined
      // Bounded RPC windows, including recovery from a lost local transaction journal.
      // Search newest windows first; immutable escrow IDs can only lock/unwind once.
      for (let end = at.number; end >= cfg.destinationStart;) {
        const start = end - cfg.destinationStart + 1n > cfg.maxBlocks ? end - cfg.maxBlocks + 1n : cfg.destinationStart
        if (action === 'lockAgreement') {
          const logs = await destination.getLogs({ address: cfg.escrow, event: getAbiItem({ abi: escrowAbi, name: 'EscrowLocked' }),
            args: { agreementId: event.agreementId }, fromBlock: start, toBlock: end, strict: true })
          for (const log of logs) {
            requireRelay(!log.removed && same(log.address, cfg.escrow) && log.blockNumber !== null && log.blockHash !== null && log.transactionHash !== null,
              'Invalid destination lock proof log.')
            requireRelay(equalTuple(agreement, { ...log.args, state: 1 }), 'Historical EscrowLocked tuple mismatch.')
            requireRelay(!proof, 'Multiple destination lock proofs; investigate RPC/deployment.')
            proof = { number: log.blockNumber, hash: log.blockHash, transactionHash: log.transactionHash }
          }
        } else {
          const logs = await destination.getLogs({ address: cfg.escrow, event: getAbiItem({ abi: escrowAbi, name: 'EscrowUnwound' }),
            args: { agreementId: event.agreementId }, fromBlock: start, toBlock: end, strict: true })
          for (const log of logs) {
            requireRelay(!log.removed && same(log.address, cfg.escrow) && log.blockNumber !== null && log.blockHash !== null && log.transactionHash !== null,
              'Invalid destination unwind proof log.')
            requireRelay(same(log.args.decisionId, event.decisionId) && log.args.returned === agreement.capital,
              'UNWOUND is not idempotent: EscrowUnwound decisionId/returned capital mismatch.')
            requireRelay(!proof, 'Multiple destination unwind proofs; investigate RPC/deployment.')
            proof = { number: log.blockNumber, hash: log.blockHash, transactionHash: log.transactionHash }
          }
        }
        if (proof) {
          requireRelay(proof.number >= start && proof.number <= end
            && same((await destinationBlock(proof.number)).hash, proof.hash), 'Destination event proof is not canonical/in range.')
          const receipt = await destination.getTransactionReceipt({ hash: proof.transactionHash })
          requireRelay(receipt.status === 'success' && same(receipt.blockHash, proof.hash)
            && receipt.blockNumber === proof.number && receipt.to !== null && same(receipt.to, cfg.escrow),
          'Destination proof transaction did not successfully call the escrow.')
          return proof
        }
        if (start === cfg.destinationStart) break
        end = start - 1n
      }
      throw new Error('Required destination event proof not found')
    },
    async send(action: Action, event: Decision, agreement: Agreement) {
      requireRelay(wallet?.account, 'No broadcast wallet: read-only execution cannot send.')
      await preflight() // Recheck ownership/token/chain immediately before every send.
      const [pending, latest, at] = await Promise.all([
        destination.getTransactionCount({ address: cfg.relayer, blockTag: 'pending' }),
        destination.getTransactionCount({ address: cfg.relayer, blockTag: 'latest' }), confirmed(),
      ])
      const stable = await destination.getTransactionCount({ address: cfg.relayer, blockNumber: at.number })
      requireRelay(pending === latest && latest === stable,
        'Relayer has pending/unconfirmed nonce activity; wait or inspect it before retrying. Never use this key concurrently.')
      const common = { address: cfg.escrow, abi: escrowAbi, account: wallet.account, nonce: latest } as const
      if (action === 'lockAgreement') {
        const { request } = await destination.simulateContract({ ...common, functionName: 'lockAgreement',
          args: [agreement.agreementId, agreement.termsHash, agreement.principal, agreement.counterparty, agreement.capital, agreement.policyCommitment] })
        return wallet.writeContract({ ...request, chain: wallet.chain })
      }
      const { request } = await destination.simulateContract({ ...common, functionName: 'unwind', args: [event.agreementId, event.decisionId] })
      return wallet.writeContract({ ...request, chain: wallet.chain })
    },
    async wait(hash) {
      const receipt = await destination.waitForTransactionReceipt({ hash, confirmations: cfg.confirmations, timeout: 180_000 })
      requireRelay(receipt.status === 'success' && same(receipt.transactionHash, hash) && receipt.to !== null && same(receipt.to, cfg.escrow),
        'Destination transaction reverted or was replaced; inspect the nonce/receipt and retry without advancing the cursor.')
      requireRelay(same((await destinationBlock(receipt.blockNumber)).hash, receipt.blockHash), 'Destination receipt block is no longer canonical.')
      return { number: receipt.blockNumber, hash: receipt.blockHash, transactionHash: receipt.transactionHash }
    },
  }
}