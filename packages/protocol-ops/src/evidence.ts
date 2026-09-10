import { decodeEventLog, type Abi, type Hex, type TransactionReceipt } from 'viem';
import { same } from './policy';

export function confirmedReceipt(receipt: TransactionReceipt, hash: Hex, canonicalHash: Hex, horizon: bigint) {
  if (receipt.status !== 'success' || !same(receipt.transactionHash, hash) ||
      !same(receipt.blockHash, canonicalHash) || receipt.blockNumber > horizon) {
    throw new Error('Receipt is failed, noncanonical or insufficiently confirmed');
  }
}

export function eventArgs(receipt: TransactionReceipt, address: Hex, abi: Abi, name: string, agreementId: Hex) {
  const matches: Record<string, unknown>[] = [];
  for (const log of receipt.logs) {
    if (!same(log.address, address)) continue;
    let decoded;
    try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); }
    catch { continue; }
    const args = decoded.args as unknown as Record<string, unknown>;
    if (decoded.eventName === name && typeof args.agreementId === 'string' && same(args.agreementId, agreementId)) {
      if (log.removed || !same(log.blockHash!, receipt.blockHash) || !same(log.transactionHash!, receipt.transactionHash)) {
        throw new Error('Inconsistent event provenance');
      }
      matches.push(args);
    }
  }
  if (matches.length !== 1) throw new Error('Expected exactly one matching event');
  return matches[0];
}
