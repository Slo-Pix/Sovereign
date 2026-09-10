import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { test } from 'bun:test'
import {
  concatHex, createTestClient, createWalletClient, encodeFunctionData, http,
  keccak256, parseEther, parseEventLogs, toHex, type Abi, type Address, type Hex,
  type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { hashPolicy, hashTerms, offerDigest, type Terms } from '../../core/src/index'
import { encodeDecision } from '../../cre/src/domain'
import { withLocalEvm, type LocalClient } from '../../cre/scripts/local-evm'
import { storageScope } from '../src/config'
import { deriveDecisionId, type Settings, type State } from '../src/model'
import { processOnce } from '../src/processor'
import { createAdapter } from '../src/rpc'
import { SqliteStore } from '../src/store'

// From repository root:
// RUN_LOCAL_RELAYER_TEST=1 bun --no-env-file test packages/relayer/test/local-integration.test.ts
// LOCAL ONLY: generated accounts, synthetic receiver metadata/policy and MockUSDC.
// No CLI/canonical deployment overrides, environment keys, forks, public RPCs or DON/TEE claims.
// The shared helper builds current Foundry artifacts and finally kills both Anvil process groups.
const MODE = 'LOCAL_EVM_TRUSTED_RELAYER_NOT_DON_TEE'
type Contract = { address: Address; abi: Abi }

test.skipIf(process.env.RUN_LOCAL_RELAYER_TEST !== '1')(
  `${MODE}: real adapter, finalized events, durable SQLite, lock/unwind and reorg guard`,
  async () => {
    const started = Date.now()
    const directory = mkdtempSync(join(tmpdir(), 'sovereign-relayer-local-'))
    try {
      await withLocalEvm(async ({ sepolia, arc, artifact }) => {
        const account = () => privateKeyToAccount(generatePrivateKey())
        const admin = account(), principal = account(), counterparty = account()
        const forwarder = account(), relayer = account()
        const control = (client: LocalClient) => createTestClient({
          chain: client.public.chain, mode: 'anvil', transport: http(client.url, { retryCount: 0, timeout: 5000 }),
        })
        const sourceControl = control(sepolia), destinationControl = control(arc)
        for (const client of [sepolia, arc]) {
          assert.equal(new URL(client.url).hostname, '127.0.0.1')
          for (const signer of [admin, principal, counterparty, forwarder, relayer]) {
            await control(client).setBalance({ address: signer.address, value: parseEther('10') })
          }
        }
        assert.notEqual(sepolia.url, arc.url)

        async function receipt(client: LocalClient, hash: Hex) {
          const result = await client.public.waitForTransactionReceipt({ hash, timeout: 10_000 })
          assert.equal(result.status, 'success')
          return result
        }
        async function deploy(client: LocalClient, name: string, args: readonly unknown[] = []): Promise<Contract> {
          const compiled = await artifact(name)
          const result = await receipt(client, await client.wallet.deployContract({
            account: admin, abi: compiled.abi, bytecode: compiled.bytecode.object, args, gas: 6_000_000n,
          }))
          assert.ok(result.contractAddress)
          return { address: result.contractAddress, abi: compiled.abi }
        }
        const send = async (client: LocalClient, signer: PrivateKeyAccount, contract: Contract,
          functionName: string, args: readonly unknown[]) => receipt(client, await client.wallet.sendTransaction({
          account: signer, to: contract.address, data: encodeFunctionData({ abi: contract.abi, functionName, args }),
          gas: 1_500_000n,
        }))
        const read = (client: LocalClient, contract: Contract, functionName: string, args: readonly unknown[] = []) =>
          client.public.readContract({ address: contract.address, abi: contract.abi, functionName, args })
        function event(result: TransactionReceipt, contract: Contract, name: string) {
          const logs = parseEventLogs({ abi: contract.abi, eventName: name, strict: true,
            logs: result.logs.filter(log => log.address.toLowerCase() === contract.address.toLowerCase()) })
          assert.equal(logs.length, 1)
          return logs[0]!.args as Record<string, unknown>
        }

        const token = await deploy(arc, 'MockUSDC')
        const escrow = await deploy(arc, 'SovereignEscrow', [token.address, relayer.address, admin.address])
        const intents = await deploy(sepolia, 'IntentRegistry')
        const agreements = await deploy(sepolia, 'AgreementRegistry', [intents.address, admin.address])
        const sink = await deploy(sepolia, 'DecisionSink', [agreements.address, forwarder.address, admin.address])
        const workflowId = keccak256(toHex(MODE))
        const receiver = await deploy(sepolia, 'CREDecisionReceiver', [sink.address, forwarder.address, workflowId, admin.address])
        await send(sepolia, admin, agreements, 'setDecisionSink', [sink.address])
        await send(sepolia, admin, sink, 'setForwarder', [receiver.address])
        const commitment = hashPolicy({ minYieldBps: 400n, maxLossBps: 300n, maxDuration: 3600n,
          salt: keccak256(toHex('public synthetic local relayer policy')) })
        const created = await send(sepolia, principal, intents, 'createIntent', [token.address, 1_000_000n, 3600n, commitment])
        const intentId = event(created, intents, 'IntentCreated').intentId as Hex
        const terms: Terms = { intentId, principal: principal.address, counterparty: counterparty.address,
          capital: 1_000_000n, duration: 1800n, yieldBps: 500n,
          expiresAt: (await sepolia.public.getBlock()).timestamp + 3600n, nonce: 1n }
        const signature = await counterparty.sign({ hash: offerDigest(terms, agreements.address) })
        const proposal = await send(sepolia, principal, agreements, 'proposeAgreement', [terms, signature])
        const agreementId = event(proposal, agreements, 'AgreementProposed').agreementId as Hex
        assert.equal(await read(sepolia, agreements, 'stateOf', [agreementId]), 3)
        await send(arc, admin, token, 'mint', [principal.address, terms.capital])
        await send(arc, principal, token, 'approve', [escrow.address, terms.capital])
        await destinationControl.mine({ blocks: 2 })
        // Finalize deployment/wiring before preflight, without making later events final.
        await sourceControl.mine({ blocks: 64 })
        const snapshot = await sourceControl.snapshot()
        const metadata = concatHex([workflowId, toHex('local-test', { size: 10 }), admin.address, '0x0001'])
        async function decide(checkKind: 1 | 2) {
          const decisionNonce = BigInt(checkKind)
          const decisionId = deriveDecisionId(agreementId, checkKind, decisionNonce)
          const result = await send(sepolia, forwarder, receiver, 'onReport', [metadata,
            encodeDecision({ agreementId, decisionId, checkKind, result: true, decisionNonce })])
          assert.deepEqual(event(result, sink, 'DecisionRecorded'), {
            agreementId, decisionId, checkKind, result: true, nonce: decisionNonce,
          })
          return { result, decisionId }
        }
        const validation = await decide(1)
        assert.equal(await read(sepolia, agreements, 'stateOf', [agreementId]), 4)

        // Explicit programmatic LOCAL fixture settings, not readConfig or a production bypass.
        // createAdapter always requests source 'finalized'; there is no latest fallback.
        const cfg: Settings = { sourceChain: sepolia.chainId, destinationChain: arc.chainId,
          registry: agreements.address, sink: sink.address, escrow: escrow.address,
          token: token.address, relayer: relayer.address, sourceStart: validation.result.blockNumber,
          destinationStart: 0n, maxBlocks: 500n, confirmations: 2 }
        const wallet = createWalletClient({ account: relayer, chain: arc.public.chain,
          transport: http(arc.url, { retryCount: 0, timeout: 5000 }) })
        const rpc = createAdapter(cfg, sepolia.public, arc.public, wallet)
        const readOnlyRpc = createAdapter(cfg, sepolia.public, arc.public)
        const stateDir = join(directory, 'state'), scope = storageScope(cfg)
        const dbPath = join(stateDir, 'relayer.sqlite')
        async function batch(broadcast: boolean, dir = stateDir) {
          const store = new SqliteStore(dir, scope, broadcast)
          try {
            const plans = await processOnce(cfg, broadcast ? rpc : readOnlyRpc, store, broadcast)
            const state = store.load()
            store.commit()
            return { plans, state }
          } finally { store.close() }
        }
        function persisted(): State {
          const store = new SqliteStore(stateDir, scope, false)
          try { return store.load() } finally { store.close() }
        }
        function evidenceRows(dir = stateDir) {
          const db = new Database(join(dir, 'relayer.sqlite'), { readonly: true })
          try {
            return db.query('SELECT decision_id, action, evidence FROM receipts ORDER BY action').all() as {
              decision_id: string; action: string; evidence: string
            }[]
          } finally { db.close() }
        }
        const balances = async () => Promise.all([principal.address, escrow.address, counterparty.address]
          .map(address => read(arc, token, 'balanceOf', [address])))
        const relayerNonce = () => arc.public.getTransactionCount({ address: relayer.address, blockTag: 'latest' })
        const tuple = [agreementId, hashTerms(terms), principal.address, counterparty.address, terms.capital, commitment]
        async function checkReceipt(hash: Hex | undefined, name: string, decisionId?: Hex) {
          assert.ok(hash)
          const mined = await arc.public.getTransactionReceipt({ hash })
          assert.equal(mined.status, 'success')
          assert.equal(mined.from.toLowerCase(), relayer.address.toLowerCase())
          assert.equal(mined.to?.toLowerCase(), escrow.address.toLowerCase())
          assert.ok((await arc.public.getBlockNumber({ cacheTime: 0 })) >= mined.blockNumber + 1n)
          const args = event(mined, escrow, name)
          assert.equal(args.agreementId, agreementId)
          if (decisionId) {
            assert.equal(args.decisionId, decisionId)
            assert.equal(args.returned, terms.capital)
          }
          return { number: mined.blockNumber.toString(), hash: mined.blockHash, transactionHash: mined.transactionHash }
        }

        await rpc.preflight()
        assert.ok((await rpc.finalized()).number < validation.result.blockNumber, 'Fixture must exercise actual finality lag')
        assert.deepEqual(await batch(false), { plans: [], state: {} })
        assert.equal(existsSync(stateDir), false)
        await sourceControl.mine({ blocks: 64 })
        const validationFinalized = await rpc.finalized()
        assert.ok(validationFinalized.number >= validation.result.blockNumber)
        const dry = await batch(false)
        assert.deepEqual(dry.plans.map(p => [p.action, p.outcome, p.transactionHash]), [['lockAgreement', 'planned', undefined]])
        assert.deepEqual(dry.state, {})
        assert.equal(existsSync(stateDir), false, 'Dry-run must not even create a database directory')
        assert.equal(await relayerNonce(), 0)
        assert.deepEqual(await balances(), [terms.capital, 0n, 0n])
        assert.equal((await rpc.escrow(agreementId, await rpc.confirmed())).state, 0)

        // Empty destination blocks provide real two-block receipt confirmations.
        // Only the destination uses interval mining; source finality remains explicitly controlled.
        await destinationControl.setIntervalMining({ interval: 1 })
        try {
          const locked = await batch(true)
          assert.deepEqual(locked.plans.map(p => [p.action, p.outcome]), [['lockAgreement', 'confirmed']])
          const lockProof = await checkReceipt(locked.plans[0]?.transactionHash, 'EscrowLocked')
          assert.deepEqual(locked.state.cursor, validationFinalized)
          assert.deepEqual(persisted(), locked.state, 'Close/reopen must preserve both checkpoints')
          assert.deepEqual(evidenceRows().map(row => [row.decision_id, row.action, JSON.parse(row.evidence)]),
            [[validation.decisionId, 'lockAgreement', lockProof]])
          assert.deepEqual(await read(arc, escrow, 'escrows', [agreementId]), [...tuple, 1])
          assert.deepEqual(await balances(), [0n, terms.capital, 0n])
          assert.equal(await relayerNonce(), 1)
          assert.deepEqual((await batch(true)).plans, [])
          assert.deepEqual(persisted(), locked.state)

          const breach = await decide(2)
          assert.equal(await read(sepolia, agreements, 'stateOf', [agreementId]), 5)
          assert.equal(await read(sepolia, sink, 'lastNonce', [agreementId]), 2n)
          assert.ok((await rpc.finalized()).number < breach.result.blockNumber)
          assert.deepEqual((await batch(true)).plans, [], 'Unfinalized breach must not unwind')
          assert.equal(await relayerNonce(), 1)
          assert.deepEqual(await balances(), [0n, terms.capital, 0n])
          await sourceControl.mine({ blocks: 64 })
          const breachFinalized = await rpc.finalized()
          assert.ok(breachFinalized.number >= breach.result.blockNumber)
          const beforeDry = readFileSync(dbPath), beforeDryState = persisted()
          const plannedUnwind = await batch(false)
          assert.deepEqual(plannedUnwind.plans.map(p => [p.action, p.outcome]), [['unwind', 'planned']])
          assert.deepEqual(persisted(), beforeDryState)
          assert.deepEqual(readFileSync(dbPath), beforeDry, 'Existing SQLite file must remain byte-for-byte unchanged')
          assert.equal(evidenceRows().length, 1)
          assert.equal(await relayerNonce(), 1)
          assert.deepEqual(await balances(), [0n, terms.capital, 0n])

          const unwound = await batch(true)
          assert.deepEqual(unwound.plans.map(p => [p.action, p.outcome]), [['unwind', 'confirmed']])
          const unwindProof = await checkReceipt(unwound.plans[0]?.transactionHash, 'EscrowUnwound', breach.decisionId)
          assert.deepEqual(unwound.state.cursor, breachFinalized)
          assert.deepEqual(persisted(), unwound.state)
          assert.deepEqual(evidenceRows().map(row => [row.decision_id, row.action, JSON.parse(row.evidence)]), [
            [validation.decisionId, 'lockAgreement', lockProof], [breach.decisionId, 'unwind', unwindProof],
          ])
          assert.deepEqual(await read(arc, escrow, 'escrows', [agreementId]), [...tuple, 2])
          assert.deepEqual(await balances(), [terms.capital, 0n, 0n])
          assert.equal(await relayerNonce(), 2)
          assert.deepEqual((await batch(true)).plans, [])
          assert.deepEqual(persisted(), unwound.state)
          assert.equal(evidenceRows().length, 2)

          // Test-only lost-journal recovery: replay the same real source history against
          // the existing escrow. Production must never run concurrent databases/keys.
          const recoveryDir = join(directory, 'isolated-recovery')
          const recovered = await batch(true, recoveryDir)
          assert.deepEqual(recovered.plans.map(p => [p.action, p.outcome, p.transactionHash]), [
            ['lockAgreement', 'reconciled', lockProof.transactionHash],
            ['unwind', 'reconciled', unwindProof.transactionHash],
          ])
          assert.deepEqual(evidenceRows(recoveryDir), evidenceRows())
          assert.equal(await relayerNonce(), 2, 'Reconciliation must verify real logs/receipts, not resubmit')

          // Replace actual source blocks, not adapter responses or a fabricated DB hash.
          // This deliberately violates local finality to exercise the fail-closed guard.
          const beforeReorg = readFileSync(dbPath)
          await sourceControl.revert({ id: snapshot })
          await sourceControl.setNextBlockTimestamp({ timestamp: (await sepolia.public.getBlock()).timestamp + 3600n })
          const head = await sepolia.public.getBlockNumber({ cacheTime: 0 })
          await sourceControl.mine({ blocks: Number(breachFinalized.number + 64n - head) })
          assert.ok((await rpc.finalized()).number >= breachFinalized.number)
          assert.notEqual((await rpc.sourceBlock(breachFinalized.number)).hash, breachFinalized.hash)
          await assert.rejects(batch(true), /Source cursor reorg mismatch/)
          assert.deepEqual(persisted(), unwound.state)
          assert.deepEqual(readFileSync(dbPath), beforeReorg, 'Failed batch must roll back SQLite')
          assert.equal(evidenceRows().length, 2)
          assert.equal(await relayerNonce(), 2)
          assert.deepEqual(await balances(), [terms.capital, 0n, 0n])
        } finally {
          await destinationControl.setIntervalMining({ interval: 0 })
        }
      })
      assert.ok(Date.now() - started < 60_000, 'Local integration exceeded the 60-second runtime target')
      console.log(`${MODE}: PASS; finalized source; confirmed lock/unwind; SQLite reopen/recovery; real source reorg rejected`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  60_000,
)