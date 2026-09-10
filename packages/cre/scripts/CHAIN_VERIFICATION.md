# Reproducible local chain verification

From the repository root:

```sh
bun --no-env-file run --cwd packages/cre demo:chain
bun --no-env-file run --cwd packages/cre test:chain
bun --no-env-file run --cwd packages/cre typecheck
```

Requires Bun, the existing workspace dependencies and Solidity libraries. The
runner obtains pinned `@foundry-rs/forge@1.7.1` and `@foundry-rs/anvil@1.7.1` via
`bun x --bun`. An uncached first run needs package/compiler download access.
Compilation uses the current repository's Foundry configuration and source,
with artifacts/cache in a temporary directory, not a saved deployment artifact.

## What passes

- Two independent ephemeral Anvils bind only `127.0.0.1` on separate dynamically
  allocated ports, with exact chain IDs **11155111** and **5042002**. These are
  local replicas of chain IDs, **not connections to the public testnets**.
- Fresh generated role accounts are funded locally using the public Anvil test
  mnemonic. No environment signing keys, existing wallet files, RPC overrides,
  external chain transactions, or fork configuration are used.
- Current `IntentRegistry`, `AgreementRegistry`, `DecisionSink`,
  `CREDecisionReceiver`, `MockUSDC` and `SovereignEscrow` are compiled/deployed.
- Fresh random synthetic policy salts remain in process memory. Core's canonical
  seven-field Offer digest signs the eight-field Terms; Solidity verifies it.
- An auxiliary agreement seeds nonce **41** before receiver migration. Changing
  `sink.forwarder` preserves it, rejects the old direct caller and permits the
  receiver to advance to **42** without replacing the sink or registries.
- The main agreement's validation and breach use `evaluate`, `deriveDecisionId`
  and `encodeDecision` from the real CRE domain implementation. Packed local
  metadata tests both accepted lengths (62 and 64 bytes).
- Unauthorized caller/metadata, SAFE, replay, terminal-state and escrow negative
  paths verify named revert reasons by simulation **and mine failed transactions**.
  SAFE consumes no decision nonce; the following breach uses that same nonce.
- Confirmed source events/state gate an explicitly trusted local EOA's escrow
  lock/unwind on the second chain. Token balances are checked before lock,
  after lock, after unwind and after duplicate-unwind rejection. Final source
  state is SETTLED, escrow UNWOUND, decision nonce **2**.
- Receiver preflight runs against the real local contracts, including wrong
  identity/wiring/chain/no-code inputs and rejection of an EOA production forwarder.

Success writes [latest.json](../evidence/local-lifecycle/latest.json) atomically
**after subprocess cleanup**. It contains public addresses, chain IDs, creation
bytecode hashes, mined transaction/block hashes, receipt statuses, balances and
explicit limitations. It excludes policy inputs, salts, keys and raw calldata.
Failure does not overwrite a previous successful report: check its `completedAt`.
The tests also verify successful-run and injected-failure process cleanup.

## Evidence boundary

Every report is labeled **LOCAL_EVM_TEST_FORWARDER_NOT_DON_OR_TEE**. The configured
caller is an EOA with fixture metadata, not an actual CRE forwarder. No DON
signatures, TEE attestation, real private feed, production USDC, public-chain
finality or production receipt is claimed. Local hashes cannot be queried on a
public explorer after the Anvils stop.

The escrow trusts its relayer. This script's receipt-gated calls are not a
cryptographic cross-chain proof or a deployed Arc transport. The separate
[operational relayer](../../relayer/README.md) now implements durable replay and
reconciliation and has its own two-Anvil integration test; this script does not
substitute for that test. Registry owner reconciliation is explicit, not automatic.
SAFE submission exists only as an adversarial local test; production code must not
publish SAFE reports.

## Read-only receiver deployment preflight

Supply these public configuration values explicitly in the shell environment:

| Variable | Required value |
| --- | --- |
| `SEPOLIA_RPC_URL` | Operator-selected Sepolia read RPC |
| `CRE_REPORT_RECEIVER` | Deployed receiver address, distinct from sink |
| `CRE_WORKFLOW_ID` | Exact nonzero 32-byte configured workflow ID |
| `CRE_WORKFLOW_OWNER` | Exact configured workflow owner address |
| `CRE_FORWARDER` | Expected deployed forwarder contract, not an EOA |
| `CRE_DECISION_SINK` | Expected existing sink address |
| `CRE_AGREEMENT_REGISTRY` | Expected agreement registry address |
| `CRE_INTENT_REGISTRY` | Expected intent registry address |

```sh
bun --no-env-file run --cwd packages/cre check:receiver
```

There are no guessed addresses or automatic environment-file loading. The check
requires chain ID 11155111, bytecode at required contracts, exact receiver
identity/getters, both directions of sink/registry wiring and ERC165 behavior.
Reads are pinned to one block. It emits only public configuration/block evidence,
never the RPC URL or raw provider diagnostics. Missing/mismatched values fail
closed with a nonzero exit code. It never signs, sends transactions, deploys,
or changes wiring, and writes no evidence file.

`CONFIGURATION_MATCHES_NOT_DEPLOYMENT_AUTHORIZATION` means getter/configuration
agreement, not audited bytecode equivalence, official DON identity, workflow
deployment/approval, confidential execution, funding or Arc delivery readiness.
Real testnet deployment/broadcast remains blocked until the operator supplies
verified inputs, funded accounts and explicit broadcast authorization.