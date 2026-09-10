# Sepolia → Arc trusted relayer

Operational, one-shot Bun/viem adapter for the **existing** `SovereignEscrow.onlyRelayer` EOA interface. This is an explicitly trusted relayer, **not a cryptographic bridge**, not an Arc CRE receiver, and not an atomic cross-chain transaction. The relayer does not deploy contracts, change owners/forwarders/relayers, approve tokens, settle agreements, or submit SAFE transactions.

All implementation and package scripts live here. No root script registration or changes to other packages are required. The separate CRE local two-Anvil demonstration is not this relayer's testnet evidence.

## Requirements and installation

- Bun (tested with 1.3.13); `bun:sqlite` makes the CLI Bun-only, although the RPC adapter uses standard viem APIs.
- Exact dependencies: viem 2.34.0, @types/bun 1.3.10, TypeScript 5.9.3. Transitive dependencies are not lockfile-pinned. Installation reported one moderate and one high dependency advisory; pinned versions were retained as requested, not silently upgraded.
- From the repository root, install only this package: `npm install --prefix packages/relayer --workspaces=false --no-save --package-lock=false --ignore-scripts`. This avoids changing root workspace manifests/lockfiles.
- Sepolia RPC must implement `finalized`, historical `eth_call`/code queries, block lookup, and bounded `eth_getLogs`. No fallback to `latest` exists for source finality.
- Arc RPC must support historical reads/logs, receipts, accurate pending/latest transaction counts, and block lookup. Arc's `finalized` tag is **not** assumed; destination confirmation depth defaults to two.
- Use a dedicated relayer key, one shared local database, and a trusted, consistent RPC provider. Do not run another application using that key or a second copy of the database.

## Environment

See [.env.example](.env.example); all value slots are blank. Inject variables through the process environment or a private supervisor environment file. The CLI does not read key files, accept a key argument, or print environment variables, account objects, RPC URLs, raw requests/errors, or signed transactions. Invoke Bun with `--no-env-file` to prevent automatic dotenv loading.

| Variable | Requirement |
| --- | --- |
| `SOURCE_RPC_URL` | Sepolia HTTPS RPC; HTTP permitted only on loopback for development. URL credentials are never printed. |
| `DESTINATION_RPC_URL` | Arc Testnet HTTPS RPC; same loopback exception. |
| `SOURCE_START_BLOCK` | Required, inclusive unsigned decimal origin. On the first run, scanning starts **exactly here**, never at the current head. Choose at/before the first relevant `DecisionRecorded` event. |
| `DESTINATION_START_BLOCK` | Required, at/before escrow deployment. Recovery searches escrow event proofs from this origin in bounded windows. |
| `MAX_BLOCKS` | Optional; default 500, range 1–2000. Each invocation scans at most this many source blocks. All destination proof queries use the same maximum window size. |
| `DESTINATION_CONFIRMATIONS` | Optional; default 2, range 2–10000. Includes the receipt block, matching viem semantics. More confirmations reduce, but do not remove, destination reorg risk. |
| `RELAYER_STATE_DIR` | Optional dedicated directory; default is this package's `state` directory, independent of working directory. Local filesystem only, directory mode 0700, DB/journal files 0600. |
| `RELAYER_PRIVATE_KEY` | Required **only** with the exact CLI `--broadcast` flag. Must derive the configured canonical escrow relayer address. Ignored entirely otherwise. |

Contract addresses and both chain IDs are read from [the canonical deployment manifest](../../deployments/canonical.json): Sepolia 11155111 and Arc Testnet 5042002. No environment address override exists. Preflight checks RPC chain IDs, canonical source registry/sink wiring, bytecode presence at both source contracts and destination escrow/USDC, the escrow token address, and escrow/canonical/signer relayer identity. The configured relayer must have no code (EOA, not a contract or delegated account). These are identity/presence checks, **not runtime-bytecode hash attestation**. The ABI fragments are parity-tested against shared core exports. The sink error and receiver ABIs were checked against compiler output during integration.

## CLI

After injecting the environment, from the repository root:

- Read-only plan: `bun --no-env-file run --cwd packages/relayer relay`
- Equivalent direct invocation: `bun --no-env-file packages/relayer/src/cli.ts --once`
- **Authorized live submission only:** `bun --no-env-file run --cwd packages/relayer relay --broadcast`
- Help: `bun --no-env-file packages/relayer/src/cli.ts --help`
- Tests: `bun --no-env-file test --cwd packages/relayer`
- Types: `bun --no-env-file run --cwd packages/relayer typecheck`

`--once` is the default; there is no indefinite watcher or daemon. Use an existing timer/service supervisor to rerun it. Every invocation handles one bounded batch, even if a large backlog remains. Exit 0 means the batch completed (or there were no finalized blocks to scan); exit 1 means stop/retry after investigating the sanitized reason. Do not configure overlapping runs. SQLite additionally refuses a concurrent broadcaster immediately.

An environment variable named `BROADCAST` cannot enable sending; only the exact CLI flag does. Without it, no wallet is constructed, no transaction is simulated/sent, no receipt/cursor is written, and absent DB directories/files are not created. An existing DB is opened read-only. Output contains only public chain/contract identifiers and allowlisted per-event plans. A dry-run ACCEPT followed by BREACH uses in-memory state projection and labels the unwind `dependsOnPlannedLock`; it is **not** proof that funding, approval, gas, or submission will succeed. Dry-run repeatedly reports the same uncheckpointed range; it does not consume the backlog.

## Processing contract

1. Acquire `BEGIN IMMEDIATE` on the private SQLite database for the **entire** broadcast invocation, including all network awaits. Busy timeout is zero. There is no TTL lease or lease-expiry race.
2. Verify deployment identity. Verify the persisted source cursor block hash **before every batch**, and the persisted destination anchor. Abort on mismatch or source finalized-head regression; never reset or silently skip.
3. Read Sepolia `finalized`; request at most `MAX_BLOCKS` from the explicit origin or last checkpoint + 1. Sort `DecisionRecorded` by block number and block-global `logIndex`.
4. Authenticate configured sink, block bounds/hash, nonremoved log, nonzero IDs, kind and nonce. Enforce `decisionId = keccak256(abi.encode(bytes32 agreementId, uint8 checkKind, uint64 nonce))`, nonce in 1…2^64−1. Unknown kinds or malformed IDs are fatal, even on false results.
5. Only validation `(1, true)` maps to `lockAgreement`; only breach `(2, true)` maps to `unwind`. Validation false and SAFE/breach false yield `ignore`, never destination transactions. The current sink disallows SAFE breach logs; the explicit no-action guard remains defensive.
6. Read canonical agreement and source wiring at the **event block**, not latest. Recheck the event block hash after the read. End-of-block state may already be BREACHED/UNWIND/SETTLED after same-block subsequent calls; an authentic earlier ACCEPT still drives funding. The immutable escrow tuple must remain valid.
7. Read the confirmation-qualified destination escrow. Reconcile all six stored fields: agreement ID, terms hash, principal, counterparty, capital, policy commitment. For a new lock, perform the canonical token `transferFrom` via escrow. The principal must already own enough Arc USDC and approve the escrow; the relayer must have gas. The relayer never supplies these prerequisites automatically.
8. Existing ACTIVE is idempotent only with the matching full tuple and canonical `EscrowLocked` proof. Existing UNWOUND can reconcile an earlier lock with that lock proof, but a BREACH is idempotent **only when** `EscrowUnwound` proves that exact decision ID and returned capital. SETTLED, missing escrow for unwind, conflicting tuples, missing proof, or mismatched unwind decision stops the batch.
9. Before each send, recheck identity and refuse pending/unconfirmed signer nonce activity. Simulate the exact escrow call, then submit with the observed explicit nonce. Await `waitForTransactionReceipt` with configured confirmations, require success and unchanged transaction hash, verify receipt block hash, full post-state tuple/state, and expected escrow event. Replaced transactions are not silently accepted.
10. Recheck all touched source and destination proof/receipt block hashes before checkpointing. Persist public receipt evidence and end-of-batch cursor/anchor in one FULL-synchronous SQLite commit. Failure leaves the prior cursor intact; even empty finalized ranges are checkpointed in broadcast mode.

## Crash and failure operations

The SQLite transaction remains open across the entire run. Therefore receipt writes are staged and become durable **together with** the batch checkpoint; there is no separate pre-send raw-transaction journal. A crash before commit can lose every local entry for the batch while destination transactions survive. On restart the unchanged cursor replays the same source events, verifies the complete on-chain escrow tuple and historical events, and avoids resubmitting completed actions. The chain, not a local "processed" bit, is the recovery authority.

If the crashed transaction is pending or not sufficiently confirmed, a new send is refused when pending/latest/confirmation-qualified nonces differ. Wait for mining or inspect/drop/replace the outstanding transaction using an independently authorized operator procedure, then rerun. The adapter never auto-replaces transactions or retries with a new nonce. Accurate mempool visibility and exclusive key use are requirements: inconsistent providers or hidden/dropped mempool transactions can still race. Escrow's one-way state guards prevent a duplicate successful lock/unwind, but duplicate/reverted gas expenditure remains possible. There is no exactly-once cross-chain guarantee.

Recovery event searches walk newest-to-oldest bounded windows, stopping when proof is found. A very old event/missing proof can require many requests even though no individual query is unbounded. Use a suitable archive/indexed provider and the correct destination origin. Do not advance the origin to avoid an RPC error.

If source finality or a destination checkpoint hash disagrees, stop supervision and investigate both chains and all affected receipts. There is no reset/skip/force flag. Preserve the DB and evidence; only restore a independently verified backup/replay history after explicit operator reconciliation. Never erase the DB or choose a newer start block to hide a failed event. Changing origins, canonical deployment/identity, or confirmation settings on a checkpointed DB is rejected. `MAX_BLOCKS` and RPC endpoints may be changed without changing replay identity.

Use a trusted local disk, not NFS/shared distributed storage. Do not remove/rename/replace the DB while a process holds it. Permissions, ownership and symlink checks fail closed rather than chmod an arbitrary existing directory. An abrupt kill releases the OS SQLite lock; rollback-journal recovery occurs on the next writable open. A dry-run against a hot journal can fail rather than mutate it. Long receipt waits hold the write lock; supervisor termination/retry is safe via on-chain reconciliation.

## Public testing interface and evidence limits

[src/index.ts](src/index.ts) exports `processOnce(settings, adapter, store, broadcast = false)`, the `Adapter`/`Store`/model types, `createAdapter(settings, sourceClient, destinationClient, wallet?)`, `validateIdentity`, config helpers, and `SqliteStore`. Public library callers are responsible for holding the store transaction around the complete awaited batch and committing only on success. The CLI implements this contract. Do not call `processOnce` concurrently with a shared key or database.

The default suite uses dependency-injected processing state, **mocked viem RPC transports**, real temporary SQLite databases, and CLI subprocesses with loopback failure endpoints. It checks chronological/same-block replay, ABI tuple/indexed-field parity, historical reads, bounded logs, dry-run nonmutation, SAFE no-op, crash restart, single-writer locking, permissions, identity mismatch, invalid decisions, pending nonces, full tuple reconciliation, unwind proofs, and reorg aborts.

An additional opt-in [local integration test](test/local-integration.test.ts) uses the actual RPC adapter/processor/store on two Anvils, real finalized source events and confirmed destination transactions. It verifies dry-run nonmutation, lock/unwind balances, SQLite restart, lost-journal recovery, duplicate suppression and an actual source reorg. Run from the root with `RUN_LOCAL_RELAYER_TEST=1 bun --no-env-file test packages/relayer/test/local-integration.test.ts`. This is `LOCAL_EVM_TRUSTED_RELAYER_NOT_DON_TEE`, not public-testnet evidence.

These are offline tests, **not live Sepolia → Arc relayer testnet evidence**. No external broadcasts were performed during development. The existing contracts, source authorized decision producer, funded relayer, principal balance/allowance, correct origins, reliable RPC access, and operator authorization remain live prerequisites. Source decision authenticity ultimately trusts the configured sink/forwarder and its owners, destination execution trusts the EOA, and state verification trusts the RPC providers. Source/destination owner changes and reorgs can halt service; no automatic compensation or cryptographic cross-chain verification exists.