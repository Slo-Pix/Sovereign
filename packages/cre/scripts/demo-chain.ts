import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BaseError, ContractFunctionRevertedError, concatHex, encodeFunctionData,
  keccak256, parseEventLogs, parseEther, toHex, type Abi, type Address, type Hex,
  type TransactionReceipt } from 'viem'
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { hashPolicy, hashTerms, offerDigest, type Policy, type Terms } from '../../core/src/index'
import { deriveDecisionId, encodeDecision, evaluate, type Decision, type Snapshot } from '../src/domain'
import { checkReceiver, type ReceiverConfig } from './check-receiver'
import { FOUNDRY_VERSION, LOCAL_MODE, ROOT, withLocalEvm, type Artifact, type LocalClient } from './local-evm'

// Public Anvil development mnemonic, never a user's key. Used only to fund fresh
// ephemeral accounts on the two child processes. No environment keys are read.
const DEVELOPMENT_MNEMONIC = 'test test test test test test test test test test test junk'
const EVIDENCE = resolve(ROOT, 'packages/cre/evidence/local-lifecycle/latest.json')
type Contract = { address: Address; abi: Abi }
type PublicTx = { step: string; chainId: number; transactionHash: Hex; blockHash: Hex;
  blockNumber: string; status: string; gasUsed: string; from: Address; to: Address | null }

export async function runLocalLifecycle() {
  const sensitive: string[] = []
  const account = () => {
    const key = generatePrivateKey()
    sensitive.push(key.slice(2).toLowerCase())
    return privateKeyToAccount(key)
  }
  const admin = account(), principal = account(), counterparty = account(), forwarder = account(), relayer = account()
  const workflowId = keccak256(toHex(LOCAL_MODE))
  const metadata62 = concatHex([workflowId, toHex('local-test', { size: 10 }), admin.address])
  const metadata = concatHex([metadata62, '0x0001'])
  const transactions: PublicTx[] = []
  const checks: string[] = []
  let step = 'compile-current-contracts'
  try {
    const report = await withLocalEvm(async ({ sepolia, arc, artifact }) => {
      const artifacts = new Map<string, Artifact>()
      for (const name of ['IntentRegistry', 'AgreementRegistry', 'DecisionSink', 'CREDecisionReceiver', 'MockUSDC', 'SovereignEscrow']) {
        artifacts.set(name, await artifact(name))
      }
      async function receipt(client: LocalClient, hash: Hex, label: string, status = 'success') {
        const result = await client.public.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 15_000 })
        assert.equal(result.status, status, `Unexpected transaction status: ${label}`)
        assert.equal(await client.public.getChainId(), client.chainId, 'Local chain changed')
        transactions.push({ step: label, chainId: client.chainId, transactionHash: result.transactionHash,
          blockHash: result.blockHash, blockNumber: result.blockNumber.toString(), status: result.status,
          gasUsed: result.gasUsed.toString(), from: result.from, to: result.to })
        return result
      }
      async function send(client: LocalClient, signer: PrivateKeyAccount, contract: Contract,
        functionName: string, args: readonly unknown[], label: string, status = 'success') {
        step = label
        const hash = await client.wallet.sendTransaction({ account: signer, to: contract.address,
          data: encodeFunctionData({ abi: contract.abi, functionName, args }), gas: 1_500_000n })
        return receipt(client, hash, label, status)
      }
      const read = (client: LocalClient, contract: Contract, functionName: string, args: readonly unknown[] = []) =>
        client.public.readContract({ address: contract.address, abi: contract.abi, functionName, args })
      async function deploy(client: LocalClient, name: string, args: readonly unknown[] = []): Promise<Contract> {
        step = `deploy-${name}`
        const compiled = artifacts.get(name)!
        const hash = await client.wallet.deployContract({ account: admin, abi: compiled.abi,
          bytecode: compiled.bytecode.object, args, gas: 6_000_000n })
        const result = await receipt(client, hash, step)
        assert.ok(result.contractAddress, 'Missing deployed address')
        assert.ok((await client.public.getBytecode({ address: result.contractAddress }))?.length! > 2,
          'Deployment missing runtime bytecode')
        return { address: result.contractAddress, abi: compiled.abi }
      }
      // Only local ETH funding uses the public development account; all role
      // accounts and all lifecycle signatures are generated fresh per run.
      for (const client of [sepolia, arc]) {
        for (const [role, target] of Object.entries({ admin, principal, counterparty, forwarder, relayer })) {
          step = `fund-local-${role}`
          await receipt(client, await client.wallet.sendTransaction({ account: mnemonicToAccount(DEVELOPMENT_MNEMONIC),
            to: target.address, value: parseEther('10'), gas: 21_000n }), step)
        }
      }
      const token = await deploy(arc, 'MockUSDC')
      const escrow = await deploy(arc, 'SovereignEscrow', [token.address, relayer.address, admin.address])
      const intents = await deploy(sepolia, 'IntentRegistry')
      const agreements = await deploy(sepolia, 'AgreementRegistry', [intents.address, admin.address])
      const sink = await deploy(sepolia, 'DecisionSink', [agreements.address, forwarder.address, admin.address])
      await send(sepolia, admin, agreements, 'setDecisionSink', [sink.address], 'wire-registry-sink')

      const nonce = (id: Hex) => read(sepolia, sink, 'lastNonce', [id]) as Promise<bigint>
      const state = (id: Hex) => read(sepolia, agreements, 'stateOf', [id]) as Promise<number>
      // Decode only selected events from the mined contract's address, never
      // dump calldata, signatures, private policy inputs or raw provider errors.
      function event(result: TransactionReceipt, contract: Contract, name: string) {
        const logs = parseEventLogs({ abi: contract.abi, logs: result.logs.filter(log =>
          log.address.toLowerCase() === contract.address.toLowerCase()), eventName: name, strict: true })
        assert.equal(logs.length, 1, `Expected exactly one ${name} event`)
        return logs[0].args as Record<string, unknown>
      }
      async function propose(label: string) {
        const salt = `0x${randomBytes(32).toString('hex')}` as Hex
        sensitive.push(salt.slice(2).toLowerCase())
        const policy: Policy = { minYieldBps: 400n, maxLossBps: 300n, maxDuration: 3600n, salt }
        const commitment = hashPolicy(policy)
        const created = await send(sepolia, principal, intents, 'createIntent',
          [token.address, 1_000_000n, 3600n, commitment], `${label}-create-intent`)
        const intentId = event(created, intents, 'IntentCreated').intentId as Hex
        const terms: Terms = { intentId, principal: principal.address, counterparty: counterparty.address,
          capital: 1_000_000n, duration: 1800n, yieldBps: 500n,
          expiresAt: (await sepolia.public.getBlock()).timestamp + 3600n, nonce: 1n }
        // Raw EIP-712 digest from core, not personal_sign nor the obsolete
        // five-financial-field frontend message. Solidity verifies this signature.
        const signature = await counterparty.sign({ hash: offerDigest(terms, agreements.address) })
        const proposed = await send(sepolia, principal, agreements, 'proposeAgreement',
          [terms, signature], `${label}-propose-seven-field-signed-offer`)
        const proposal = event(proposed, agreements, 'AgreementProposed')
        assert.equal(proposal.termsHash, hashTerms(terms), 'Canonical terms hash mismatch')
        const id = proposal.agreementId as Hex
        assert.equal(await state(id), 3)
        const snapshot = async (): Promise<Snapshot> => {
          const agreement = await read(sepolia, agreements, 'agreements', [id]) as readonly unknown[]
          const intent = await read(sepolia, intents, 'getIntent', [intentId]) as { policyCommitment: Hex }
          return { agreementId: agreement[0] as Hex, intentId: agreement[1] as Hex,
            termsHash: agreement[7] as Hex, policyCommitment: agreement[8] as Hex,
            intentCommitment: intent.policyCommitment, state: Number(agreement[9]), lastNonce: await nonce(id) }
        }
        const decision = async (kind: 1 | 2, loss = 0) => {
          const now = (await sepolia.public.getBlock()).timestamp
          const value = evaluate({ checkKind: kind, agreementId: id, snapshot: await snapshot(), policy, terms,
            nowSeconds: now, maxPositionAgeSeconds: 60,
            position: { agreementId: id, currentLossBps: loss, elapsedSeconds: 10, timestamp: Number(now) } })
          assert.ok(value, 'Domain evaluation unexpectedly produced no decision')
          return value
        }
        return { id, terms, commitment, decision }
      }

      // An auxiliary pre-cutover agreement proves NONZERO sink storage survives
      // setForwarder(receiver). The main lifecycle delivers both checks via receiver.
      const legacy = await propose('migration-fixture')
      await send(sepolia, forwarder, sink, 'recordDecision',
        [legacy.id, deriveDecisionId(legacy.id, 1, 41n), 1, true, 41n], 'migration-seed-validation-nonce-41')
      assert.equal(await nonce(legacy.id), 41n)
      const receiver = await deploy(sepolia, 'CREDecisionReceiver', [sink.address, forwarder.address, workflowId, admin.address])
      await send(sepolia, admin, sink, 'setForwarder', [receiver.address], 'cutover-sink-forwarder-to-receiver')
      assert.equal(await nonce(legacy.id), 41n)
      checks.push('nonzero_nonce_41_preserved_at_receiver_cutover')

      const receiverConfig: ReceiverConfig = { rpcUrl: sepolia.url, receiver: receiver.address,
        workflowId, workflowOwner: admin.address, forwarder: forwarder.address, sink: sink.address,
        agreementRegistry: agreements.address, intentRegistry: intents.address }
      const readiness = await checkReceiver(receiverConfig, { localTestForwarder: true })
      // Exercise preflight against actual local EVM reads, including fail-closed
      // wrong identities/wiring, no-code address, chain ID and EOA-forwarder cases.
      for (const patch of [{ workflowId: keccak256(toHex('wrong-workflow')) },
        { workflowOwner: principal.address }, { forwarder: principal.address },
        { sink: intents.address }, { agreementRegistry: intents.address },
        { intentRegistry: sink.address }, { receiver: principal.address }, { rpcUrl: arc.url }]) {
        await assert.rejects(checkReceiver({ ...receiverConfig, ...patch }, { localTestForwarder: true }))
      }
      await assert.rejects(checkReceiver(receiverConfig)) // A production forwarder cannot be this EOA.
      checks.push('receiver_preflight_matches_and_nine_bad_configurations_rejected')

      const allErrors = [...artifacts.values()].flatMap(value => value.abi.filter(item => item.type === 'error'))
      async function rejected(client: LocalClient, signer: PrivateKeyAccount, contract: Contract,
        functionName: string, args: readonly unknown[], label: string, expectedError: string) {
        step = label
        await assert.rejects(client.public.simulateContract({ account: signer.address, address: contract.address,
          abi: [...contract.abi, ...allErrors], functionName, args }), error => {
          const revert = error instanceof BaseError ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : null
          return revert instanceof ContractFunctionRevertedError && revert.data?.errorName === expectedError
        }, `Wrong revert reason: ${label}`)
        // Explicit gas bypasses estimation so this is a real MINED failed tx,
        // not merely a mocked or eth_call-only negative-path assertion.
        const result = await send(client, signer, contract, functionName, args, label, 'reverted')
        assert.equal(result.logs.length, 0, 'Reverted transaction emitted persistent logs')
        checks.push(label)
      }
      await rejected(sepolia, forwarder, sink, 'recordDecision',
        [legacy.id, deriveDecisionId(legacy.id, 2, 42n), 2, true, 42n], 'old-direct-sink-caller-blocked', 'NotForwarder')
      assert.equal(await nonce(legacy.id), 41n)
      const legacyBreach = await legacy.decision(2, 301)
      assert.equal(legacyBreach.decisionNonce, 42n)
      await send(sepolia, forwarder, receiver, 'onReport',
        [metadata, encodeDecision(legacyBreach)], 'migration-receiver-breach-nonce-42')
      assert.equal(await nonce(legacy.id), 42n)
      assert.equal(await state(legacy.id), 5)

      const main = await propose('lifecycle')
      const validation = await main.decision(1)
      assert.equal(validation.result, true)
      assert.equal(validation.decisionNonce, 1n)
      const validationReport = encodeDecision(validation)
      for (const [label, signer, meta, data, error] of [
        ['unauthorized-receiver-caller', principal, metadata, validationReport, 'UnauthorizedForwarder'],
        ['wrong-workflow-metadata', forwarder, concatHex([keccak256(toHex('wrong')), toHex('local-test', { size: 10 }), admin.address, '0x0001']), validationReport, 'UnauthorizedWorkflow'],
        ['invalid-metadata-length', forwarder, '0x', validationReport, 'InvalidMetadata'],
      ] as const) {
        await rejected(sepolia, signer, receiver, 'onReport', [meta, data], label, error)
        assert.equal(await nonce(main.id), 0n)
        assert.equal(await state(main.id), 3)
      }
      const accepted = await send(sepolia, forwarder, receiver, 'onReport',
        [metadata62, validationReport], 'receiver-validation-accepted-metadata-62')
      const recorded = event(accepted, sink, 'DecisionRecorded')
      assert.equal(recorded.decisionId, validation.decisionId)
      assert.equal(recorded.nonce, 1n)
      assert.equal(recorded.checkKind, 1)
      assert.equal(recorded.result, true)
      assert.equal(recorded.agreementId, main.id)
      assert.equal(await state(main.id), 4)
      assert.equal(await nonce(main.id), 1n)

      const balance = (address: Address) => read(arc, token, 'balanceOf', [address]) as Promise<bigint>
      const balances = async () => ({ principal: (await balance(principal.address)).toString(),
        escrow: (await balance(escrow.address)).toString(), counterparty: (await balance(counterparty.address)).toString() })
      await send(arc, admin, token, 'mint', [principal.address, main.terms.capital], 'mint-local-mock-usdc')
      const beforeLock = await balances()
      assert.deepEqual(beforeLock, { principal: '1000000', escrow: '0', counterparty: '0' })
      await send(arc, principal, token, 'approve', [escrow.address, main.terms.capital], 'approve-local-escrow')
      const lockArgs = [main.id, hashTerms(main.terms), principal.address, counterparty.address,
        main.terms.capital, main.commitment] as const
      await rejected(arc, principal, escrow, 'lockAgreement', lockArgs, 'unauthorized-escrow-lock', 'NotRelayer')
      // Application-level relay of confirmed source event/state; NOT a bridge
      // proof, production event watcher, DON write or crash-safe relayer service.
      assert.equal(await state(main.id), 4)
      const locked = await send(arc, relayer, escrow, 'lockAgreement', lockArgs, 'relay-confirmed-acceptance-lock')
      assert.equal(event(locked, escrow, 'EscrowLocked').agreementId, main.id)
      const afterLock = await balances()
      assert.deepEqual(afterLock, { principal: '0', escrow: '1000000', counterparty: '0' })
      const lockedEscrow = await read(arc, escrow, 'escrows', [main.id]) as readonly unknown[]
      assert.deepEqual(lockedEscrow, [...lockArgs, 1])
      await rejected(arc, relayer, escrow, 'lockAgreement', lockArgs, 'duplicate-escrow-lock', 'EscrowAlreadyExists')

      const safe = await main.decision(2, 300)
      assert.equal(safe.result, false)
      assert.equal(safe.decisionNonce, 2n)
      await rejected(sepolia, forwarder, receiver, 'onReport', [metadata, encodeDecision(safe)],
        'safe-report-rejected-no-nonce-consumed', 'NonActionableDecision')
      assert.equal(await nonce(main.id), 1n)
      assert.equal(await state(main.id), 4)
      const breach = await main.decision(2, 301)
      assert.equal(breach.result, true)
      assert.equal(breach.decisionNonce, 2n)
      const breached = await send(sepolia, forwarder, receiver, 'onReport',
        [metadata, encodeDecision(breach)], 'receiver-breach-accepted-metadata-64')
      const breachEvent = event(breached, sink, 'DecisionRecorded')
      assert.equal(breachEvent.decisionId, breach.decisionId)
      assert.equal(breachEvent.agreementId, main.id)
      assert.equal(breachEvent.checkKind, 2)
      assert.equal(breachEvent.result, true)
      assert.equal(breachEvent.nonce, 2n)
      assert.equal(await nonce(main.id), 2n)
      assert.equal(await state(main.id), 5)
      await rejected(sepolia, forwarder, receiver, 'onReport', [metadata, encodeDecision(breach)],
        'breach-replay-rejected', 'StaleNonce')
      const terminal: Decision = { ...breach, decisionNonce: 3n, decisionId: deriveDecisionId(main.id, 2, 3n) }
      await rejected(sepolia, forwarder, receiver, 'onReport', [metadata, encodeDecision(terminal)],
        'terminal-new-nonce-rejected', 'CheckKindStateMismatch')
      assert.equal(await nonce(main.id), 2n)
      assert.equal(await state(main.id), 5)
      await rejected(arc, principal, escrow, 'unwind', [main.id, breach.decisionId],
        'unauthorized-escrow-unwind', 'NotRelayer')
      assert.deepEqual(await balances(), afterLock)
      await send(sepolia, admin, agreements, 'markUnwinding', [main.id], 'owner-mark-unwinding')
      assert.equal(await state(main.id), 6)
      const unwound = await send(arc, relayer, escrow, 'unwind',
        [main.id, breachEvent.decisionId], 'relay-confirmed-breach-unwind')
      const unwindEvent = event(unwound, escrow, 'EscrowUnwound')
      assert.equal(unwindEvent.agreementId, main.id)
      assert.equal(unwindEvent.decisionId, breach.decisionId)
      assert.equal(unwindEvent.returned, main.terms.capital)
      const afterUnwind = await balances()
      assert.deepEqual(afterUnwind, beforeLock)
      await rejected(arc, relayer, escrow, 'unwind', [main.id, breach.decisionId],
        'duplicate-unwind-rejected', 'InvalidEscrowState')
      assert.deepEqual(await balances(), beforeLock)
      assert.equal((await read(arc, escrow, 'escrows', [main.id]) as readonly unknown[])[6], 2)
      await send(sepolia, admin, agreements, 'markSettled', [main.id, main.terms.capital], 'owner-reconcile-settled')
      assert.equal(await state(main.id), 7)
      assert.equal(await nonce(main.id), 2n)
      checks.push('canonical_core_signature_verified_by_solidity', 'confirmed_source_events_before_local_relay',
        'two_local_chain_token_balances_confirmed', 'registry_settled_escrow_unwound_nonce_2')
      return { schemaVersion: 1, evidenceMode: LOCAL_MODE, status: 'PASS', completedAt: new Date().toISOString(),
        toolchain: { forge: FOUNDRY_VERSION, anvil: FOUNDRY_VERSION, compilation: 'Current contracts and foundry.toml; temporary artifacts/cache' },
        chainScope: 'TWO_EPHEMERAL_LOOPBACK_ANVILS_NOT_PUBLIC_TESTNETS',
        chains: { sepolia: { chainId: sepolia.chainId, rpc: sepolia.url,
          contracts: { intentRegistry: intents.address, agreementRegistry: agreements.address,
            decisionSink: sink.address, receiver: receiver.address } },
        arc: { chainId: arc.chainId, rpc: arc.url, contracts: { mockUSDC: token.address, escrow: escrow.address } } },
        accounts: { admin: admin.address, principal: principal.address, counterparty: counterparty.address,
          localTestForwarder: forwarder.address, localTrustedRelayer: relayer.address },
        compiledCreationBytecodeHashes: Object.fromEntries([...artifacts].map(([name, value]) => [name, keccak256(value.bytecode.object)])),
        agreementId: main.id, migrationAgreementId: legacy.id,
        decisions: { validation: validation.decisionId, breach: breach.decisionId },
        finalState: { agreement: 'SETTLED', escrow: 'UNWOUND', decisionNonce: '2', migrationNonce: '42' },
        balances: { token: 'LOCAL_MOCK_USDC', decimals: 6, beforeLock, afterLock, afterUnwind },
        checks, readiness, transactions,
        limitations: ['No public testnet broadcast, real USDC, production receipts, DON or TEE execution',
          'Local synthetic policy/position only; no private feed integration or confidentiality attestation',
          'Authorized local EOA mimics receiver caller and packed fixture metadata, not a CRE forwarder',
          'SAFE is submitted only as an adversarial local test; production must not submit SAFE reports',
          'One-block local receipt confirmations are not public-chain finality or reorg testing',
          'Local trusted relayer and registry owner explicitly lock/unwind/reconcile; no cryptographic bridge proof',
          'No production Arc transport, durable cursor, restart/reorg recovery or DON workflow readiness proven',
          'Anvils are stopped after this run; receipt hashes cannot be looked up on public explorers'] }
    })
    const serialized = JSON.stringify(report, null, 2)
    for (const value of sensitive) assert.ok(!serialized.toLowerCase().includes(value), 'Private fixture leaked into evidence')
    assert.ok(!/"(?:salt|minYieldBps|maxLossBps|maxDuration|privateKey)"/.test(serialized), 'Sensitive evidence field')
    return report
  } catch {
    // Provider errors can include signed payloads. Only the fixed step label is public.
    throw new Error(`Local lifecycle failed at ${step}; no success report written; provider details suppressed`)
  }
}

export async function writeLifecycleEvidence(report: Awaited<ReturnType<typeof runLocalLifecycle>>) {
  assert.equal(report.status, 'PASS')
  assert.equal(report.evidenceMode, LOCAL_MODE)
  await mkdir(resolve(EVIDENCE, '..'), { recursive: true })
  const temporary = `${EVIDENCE}.${process.pid}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, EVIDENCE)
  } finally {
    await rm(temporary, { force: true })
  }
}

if (import.meta.main) {
  try {
    const report = await runLocalLifecycle()
    await writeLifecycleEvidence(report)
    console.log(`${LOCAL_MODE}: PASS`)
    console.log(`Mined transactions: ${report.transactions.length}; reverted negative tests: ${report.transactions.filter(tx => tx.status === 'reverted').length}`)
    console.log(`Local chain IDs: ${report.chains.sepolia.chainId}, ${report.chains.arc.chainId}`)
    console.log(`Balances (principal/escrow): ${report.balances.beforeLock.principal}/${report.balances.beforeLock.escrow} -> ${report.balances.afterLock.principal}/${report.balances.afterLock.escrow} -> ${report.balances.afterUnwind.principal}/${report.balances.afterUnwind.escrow}`)
    console.log('Final state: agreement SETTLED; escrow UNWOUND; nonce 2; migration nonce 42')
    console.log('Evidence: packages/cre/evidence/local-lifecycle/latest.json')
    console.log('No public-chain writes, DON/TEE execution or production Arc transport. Local subprocesses cleaned up.')
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith('Local lifecycle failed at ') ? error.message : 'Local lifecycle evidence publication failed; details suppressed')
    process.exitCode = 1
  }
}