import { createWalletClient, http, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { abis, addresses as a, clients, emit, hash, required } from './common';
import { plan, same, type Binding, type Proof } from './policy';
import { confirmedReceipt, eventArgs } from './evidence';

export async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--broadcast')) throw new Error('Unexpected arguments');
  const broadcast = args[0] === '--broadcast';
  const id = hash('RECONCILE_AGREEMENT_ID');
  const breachHash = hash('SEPOLIA_BREACH_TX'), unwindHash = hash('ARC_UNWIND_TX');
  const depth = process.env.ARC_CONFIRMATIONS ?? '12';
  if (!/^[1-9][0-9]*$/.test(depth) || BigInt(depth) < 2n || BigInt(depth) > 10000n) throw new Error('Invalid confirmation depth');
  const { source, destination } = clients();
  if (await source.getChainId() !== 11155111 || await destination.getChainId() !== 5042002) throw new Error('Wrong network');

  async function sourceReceipt(tx: Hex, horizon: bigint) {
    const receipt = await source.getTransactionReceipt({ hash: tx });
    const block = await source.getBlock({ blockNumber: receipt.blockNumber });
    confirmedReceipt(receipt, tx, block.hash!, horizon);
    return receipt;
  }

  async function proof(): Promise<{ proof: Proof; owner: Hex; sourceBlock: bigint; arcBlock: bigint }> {
    const finalized = await source.getBlock({ blockTag: 'finalized' });
    const head = await destination.getBlockNumber({ cacheTime: 0 });
    const arcBlock = head - BigInt(depth) + 1n;
    if (finalized.number === null || arcBlock < 0n) throw new Error('Missing confirmation horizon');
    const arcSnapshot = await destination.getBlock({ blockNumber: arcBlock });
    const breach = await sourceReceipt(breachHash, finalized.number);
    const unwind = await destination.getTransactionReceipt({ hash: unwindHash });
    const unwindBlock = await destination.getBlock({ blockNumber: unwind.blockNumber });
    confirmedReceipt(unwind, unwindHash, unwindBlock.hash!, arcBlock);
    const decision = eventArgs(breach, a.sink, abis.sink, 'DecisionRecorded', id);
    const unwound = eventArgs(unwind, a.escrow, abis.escrow, 'EscrowUnwound', id);
    const read = (address: Hex, functionName: string, abi = abis.registry, args?: readonly unknown[]) =>
      source.readContract({ address, abi, functionName, args, blockNumber: finalized.number! });
    const registrySink = await read(a.registry, 'decisionSink') as Hex;
    const sinkRegistry = await read(a.sink, 'agreementRegistry', abis.sink) as Hex;
    if (!same(registrySink, a.sink) || !same(sinkRegistry, a.registry)) throw new Error('Source wiring mismatch');
    const owner = await read(a.registry, 'owner') as Hex;
    const tuple = await read(a.registry, 'agreements', abis.registry, [id]) as readonly unknown[];
    const escrow = await destination.readContract({ address: a.escrow, abi: abis.escrow,
      functionName: 'escrows', args: [id], blockNumber: arcBlock }) as readonly unknown[];
    const token = await destination.readContract({ address: a.escrow, abi: abis.escrow,
      functionName: 'token', blockNumber: arcBlock }) as Hex;
    if (!same(token, a.token)) throw new Error('Wrong escrow token');
    const lastNonce = await read(a.sink, 'lastNonce', abis.sink, [id]);
    if (lastNonce !== decision.nonce) throw new Error('Decision is not latest');
    const agreement: Binding = { agreementId: tuple[0] as Hex, principal: tuple[2] as Hex,
      counterparty: tuple[3] as Hex, capital: tuple[4] as bigint, termsHash: tuple[7] as Hex, policyCommitment: tuple[8] as Hex };
    const result: Proof = { agreement,
      escrow: { agreementId: escrow[0] as Hex, termsHash: escrow[1] as Hex, principal: escrow[2] as Hex,
        counterparty: escrow[3] as Hex, capital: escrow[4] as bigint, policyCommitment: escrow[5] as Hex },
      registryState: Number(tuple[9]), escrowState: Number(escrow[6]),
      decision: { agreementId: decision.agreementId as Hex, decisionId: decision.decisionId as Hex,
        kind: decision.checkKind as number, result: decision.result as boolean, nonce: decision.nonce as bigint },
      unwind: { agreementId: unwound.agreementId as Hex, decisionId: unwound.decisionId as Hex, returned: unwound.returned as bigint },
    };
    plan(result);
    if (result.registryState === 7) {
      // Terminal state alone does not prove the owner recorded the correct amount.
      const settled = await sourceReceipt(hash('SEPOLIA_SETTLEMENT_TX'), finalized.number);
      const event = eventArgs(settled, a.registry, abis.registry, 'AgreementSettled', id);
      if (event.returned !== agreement.capital || settled.blockNumber < breach.blockNumber) throw new Error('Settlement evidence mismatch');
    }
    if (!same((await destination.getBlock({ blockNumber: arcBlock })).hash!, arcSnapshot.hash!) ||
        !same((await source.getBlock({ blockNumber: finalized.number })).hash!, finalized.hash!)) throw new Error('Snapshot changed');
    return { proof: result, owner, sourceBlock: finalized.number, arcBlock };
  }

  const initial = await proof();
  emit({ mode: broadcast ? 'broadcast' : 'dry-run', agreementId: id, registry: a.registry, escrow: a.escrow,
    breachTx: breachHash, unwindTx: unwindHash, sourceFinalizedBlock: initial.sourceBlock,
    arcConfirmedBlock: initial.arcBlock, arcConfirmations: depth, owner: initial.owner,
    returnedBaseUnits: initial.proof.agreement.capital, actions: plan(initial.proof) });
  if (!broadcast || !plan(initial.proof).length) return;
  const account = privateKeyToAccount(required('DEPLOYER_PRIVATE_KEY') as Hex);
  if (!same(account.address, initial.owner)) throw new Error('Wrong owner signer');
  // One owner writer on this host, across repositories. A crashed process leaves a fail-closed lock.
  const lockPath = join(homedir(), `.sovereign-owner-11155111-${account.address.toLowerCase()}.lock`);
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, agreementId: id }));
    const wallet = createWalletClient({ account, chain: sepolia,
      transport: http(required('SEPOLIA_RPC_URL'), { timeout: 15000, retryCount: 0 }) });
    for (const action of plan(initial.proof)) {
      const current = await proof();
      if (!same(current.owner, account.address) || plan(current.proof)[0] !== action) throw new Error('Plan changed; rerun dry-run');
      const latestState = await source.readContract({ address: a.registry, abi: abis.registry, functionName: 'stateOf', args: [id] });
      if (Number(latestState) !== current.proof.registryState) throw new Error('Unfinalized registry transition');
      const pending = await source.getTransactionCount({ address: account.address, blockTag: 'pending' });
      const latest = await source.getTransactionCount({ address: account.address, blockTag: 'latest' });
      if (pending !== latest) throw new Error('Owner has pending transactions');
      const args = action === 'markSettled' ? [id, current.proof.agreement.capital] : [id];
      const { request } = await source.simulateContract({ account, chain: sepolia,
        address: a.registry, abi: abis.registry, functionName: action, args, nonce: latest });
      const tx = await wallet.writeContract(request);
      emit({ status: 'submitted', action, transactionHash: tx });
      const receipt = await source.waitForTransactionReceipt({ hash: tx, timeout: 180000 });
      if (receipt.status !== 'success' || !same(receipt.transactionHash, tx)) throw new Error('Owner transaction failed or replaced');
      eventArgs(receipt, a.registry, abis.registry, action === 'markSettled' ? 'AgreementSettled' : 'AgreementUnwinding', id);
      emit({ status: 'mined', action, transactionHash: tx, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash });
      // Finalization separates the two owner actions and makes restart evidence unambiguous.
      await waitFinalized(receipt);
      if (action === 'markSettled') process.env.SEPOLIA_SETTLEMENT_TX = tx;
    }
    const final = await proof();
    if (final.proof.registryState !== 7) throw new Error('Settlement not finalized');
    emit({ status: 'finalized', agreementId: id, returnedBaseUnits: final.proof.agreement.capital });
  } finally { await lock.close(); await unlink(lockPath); }

  async function waitFinalized(receipt: TransactionReceipt) {
    const deadline = Date.now() + 25 * 60 * 1000;
    while (Date.now() < deadline) {
      const block = await source.getBlock({ blockTag: 'finalized' });
      if (block.number !== null && block.number >= receipt.blockNumber) {
        await sourceReceipt(receipt.transactionHash, block.number);
        return;
      }
      await Bun.sleep(12000);
    }
    throw new Error('Finalization timed out; retain transaction hash and retry after finality');
  }
}

if (import.meta.main) main().catch(() => {
  console.error('Reconciliation stopped. Check inputs, finalized receipts, binding, owner, pending transactions and local owner lock. Raw diagnostics suppressed. Retain any submitted transaction hashes before retrying.');
  process.exitCode = 1;
});
