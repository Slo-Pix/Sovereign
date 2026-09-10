# Sovereign CRE

Confidential offer validation and breach-only risk monitoring for Sovereign. Workflows consume the shared core encoders and ABIs without changing their encoding.

**Status:** decision logic, authenticated position reads and simulation tooling are implemented. Evidence demonstrates local CRE execution with synthetic inputs and separate read-only testnet checks—not a deployed hardware TEE or a completed two-chain lifecycle. This is unaudited testnet software.

## Quick start

Requirements: Bun, the CRE CLI and a configured CRE account for simulations. Verified with Bun 1.3.13, CRE CLI v1.33.0 and SDK 1.18.0. Approved DON deployment and confidential-beta enrollment are required before processing real sensitive inputs in deployed confidential execution.

Run from the repository root:

| Action | Command |
| --- | --- |
| Install dependencies | `bun install --cwd packages/cre --no-save --ignore-scripts` |
| Unit and SDK tests | `bun run --cwd packages/cre test` |
| Type checks | `bun run --cwd packages/cre typecheck` |
| Build the real-chain workflow to WASM | `bun run --cwd packages/cre build` |
| Seven synthetic decision simulations | `bun run --cwd packages/cre demo` |
| One decision scenario | `bun run --cwd packages/cre demo mismatch` |
| Nine authenticated HTTP simulations | `bun run --cwd packages/cre demo:feed` |
| CRE against the durable authenticated provider | `bun --no-env-file run --cwd packages/cre demo:provider` |
| Real local two-chain lifecycle | `bun --no-env-file run --cwd packages/cre demo:chain` |
| Read-only receiver identity/wiring check | `bun --no-env-file run --cwd packages/cre check:receiver` |
| Read-only testnet checks | `bun run --cwd packages/cre preflight` |

The installation command preserves shared workspace manifests/lockfiles; it is not a frozen-lockfile guarantee. Workspace dependency locking and CRE CI integration still require coordination with the repository owner.

`CRE_BIN` selects the CLI executable. Demo drivers create ephemeral synthetic credentials, scan output before saving evidence, clean up temporary secrets and never enable broadcasting. They require no real policy/feed credentials. The HTTP driver starts and closes its own local test servers.

## Package structure

| Path | Purpose |
| --- | --- |
| [src](src) | Decision engine, confidential handlers, chain transport and authenticated position client |
| [sovereign](sovereign) | Real-chain entry point, configuration template and secret-name mapping |
| [test](test) | Encoding, state, privacy and SDK tests |
| [simulation](simulation) | Synthetic-state decision workflow; no chain writer |
| [feed-simulation](feed-simulation) | Actual CRE HTTP against a synthetic provider; no chain writer |
| [scripts](scripts) | Reproducible demos, output assertions and read-only preflight |
| [evidence](evidence) | Labeled transcripts and public deployment/capability checks |

Host scripts and workflow code have separate TypeScript contexts. Filesystem access and CSPRNG generation stay in host scripts, not in the deployed workflow binary. Dependencies, generated bundles, environment files and private local configurations are ignored by Git.

## Workflow behavior

1. Read a block-pinned snapshot of public agreement, intent and sink state; verify their wiring.
2. Load policy data through the TEE secret API and verify its commitment and final terms binding.
3. For validation, evaluate the offer and publish ACCEPT/REJECT as required for activation.
4. For monitoring, fetch an origin/agreement-bound credential and retrieve the private position through the TEE HTTP client.
5. Suppress SAFE before report generation. Missing, invalid or stale positions also withhold decisions; neither case proves safety.
6. Recheck public state/nonce before publishing an actionable breach. Receiver nonce/state guards remain authoritative under races/retries.

The public decision tuple is `(agreementId, decisionId, checkKind, result, nonce)`. No private policy, salt, observed loss, elapsed time or reason-specific breach flag is added. Sepolia delivery requires transaction and receiver-execution success. Latest-block reads are not finality guarantees; cross-chain delivery is not atomic.

## Configuration

Use [sovereign/config.example.json](sovereign/config.example.json) as the public template. Its identifiers/host are deliberately unusable placeholders. Supply a local private configuration at the ignored path specified by [sovereign/workflow.yaml](sovereign/workflow.yaml).

- Set the actual agreement ID and all eight final terms, including offer expiry and nonce.
- Set `positionOrigin` and `positionAuthSecretId`; the old `positionUrl` is rejected. Put credentials in the secret store, not public config. [PRIVATE_FEED.md](PRIVATE_FEED.md) defines the exact credential format and provider contract.
- Keep `delivery: report-only` until an authenticated receiver is deployed and verified. For Sepolia writes, set its actual `reportReceiver`; the existing sink is not a substitute.
- Trigger index 0 validates offers; index 1 monitors breaches. `NO_DECISION` is not a SAFE attestation.
- [sovereign/secrets.yaml](sovereign/secrets.yaml) maps secret IDs to local simulation variables. [The environment example](.env.example) contains empty placeholders only. Never use real sensitive policies with local simulation.
- [project.yaml](project.yaml) configures CRE's Sepolia RPC. `SEPOLIA_RPC_URL` and `ARC_RPC_URL` separately configure the read-only preflight and are never printed by it.

Demo configurations are generated temporarily and passed via CLI overrides. Their absent private default paths are intentional. Setting report delivery does not itself authorize broadcasting; none of the commands above performs deployment or broadcast.

## Evidence and judging claims

| Evidence | Demonstrates | Does not demonstrate |
| --- | --- | --- |
| [Acceptance](evidence/decisions/accept.txt), [rejection](evidence/decisions/reject.txt), [mismatch](evidence/decisions/mismatch.txt) | CLI/WASM validation and confidential-handler registration | Hardware confidentiality, live agreement state or DON attestation |
| [SAFE suppression](evidence/decisions/safe.txt), [breach](evidence/decisions/breach.txt), [boundary](evidence/decisions/boundary.txt), [stale](evidence/decisions/stale.txt) | Silent non-actionable monitoring and an actionable breach report | A continuous on-chain lifecycle or token transfer |
| [Authenticated HTTP probes](evidence/private-feed/README.md) | Actual HTTP requests, credential handling and tested redirect refusal | Real provider authorization, deployed HTTPS behavior or hardware TEE |
| [Read-only preflight](evidence/preflight/live-contracts.json) | Timestamped RPC checks of bytecode/wiring | Current receiver deployment, wallet funding or enforcement |
| [Arc capability finding](evidence/arc-write-target.md) | Tenant network/forwarder availability at the recorded check | Successful Arc delivery or deployment approval |
| [Provider interoperability](evidence/provider-integration/README.md) | Real private service and actual CRE HTTP, restart/revocation tests | HTTPS deployment, real venue truth or TEE attestation |
| [Local chain lifecycle](scripts/CHAIN_VERIFICATION.md) | Mined local receiver/escrow transactions, replay rejection and balances | Public-testnet receipts, actual DON forwarder or hardware TEE |

Scenarios are independent synthetic tests, not a fabricated live lifecycle. Retain simulator warnings and labels. Test-only scenario names/report counters are absent from the real-chain handler output.

## Honest limitations: private inputs, observable enforcement

Sovereign minimizes disclosure; it does **not** guarantee complete threshold secrecy. Under the implemented strictly-greater loss rule, SAFE at 280 followed by a known **loss-triggered** breach at 310 would imply **280 ≤ maxLossBps < 310**. Duration can also trigger breach; the loss bound requires ruling that out.

SAFE produces no report, public SAFE verdict, transaction or on-chain nonce consumption. The transport independently rejects accidental SAFE publication. Nevertheless, observable positions, known cadence, absence/timing of a breach, repeated agreements and offer ACCEPT/REJECT outcomes can narrow or reveal an integer threshold. Fresh salts protect commitment hiding, not inference about a reused threshold.

Workflow binaries, chain reads and enforcement effects remain public. Neutral outputs do not prove timing indistinguishability. `ACTIVE` means no recorded transition, not a recent successful risk check. Feed failure can leave capital exposed; private alerts and an outage response are required.

The position client requires HTTPS by default, disables caching, bounds requests and has no unauthenticated fallback. Its provider still sees—and can falsify—its own observations. Provider authorization, restricted writers, durable quotas, configuration permissions and removal of public mirrors are operational requirements. Cron is not an anti-abuse limiter. Hiding an API does not conceal positions reconstructable from public chain data.

Actionable-only contract enforcement complements sender suppression: even reverted calldata can leak. Verify actual receiver wiring; changed source does not upgrade deployed bytecode. Nonces prevent replay, not false data or all delivery failures.

Keep private values and detailed errors out of logs, UI, telemetry, reports and calldata. Output scans are regression checks, not formal side-channel audits. Randomized decisions can compromise enforcement; delayed/batched publication adds exposure and is not implemented. ZK proofs alone cannot hide public breach outcomes/transfers. Hiding those effects requires a different confidential-state architecture.

## Integration prerequisites

The provider and a [trusted EOA relayer](../relayer/README.md) are now implemented and locally tested. Public-testnet operation still requires receiver deployment/identity wiring, HTTPS provider/token provisioning, funded wallets and token allowance, correct replay origins and actual public receipt/balance evidence. The relayer verifies finalized source events and recovers using escrow state/proofs; it is not an atomic cryptographic bridge. ENS authorization requires a genuine registry hook if retained. See [INTEGRATION.md](INTEGRATION.md) for responsibilities and [PRIVATE_FEED.md](PRIVATE_FEED.md) for feed setup/limits.

## Attribution

The confidential-handler integration was developed using Chainlink's `hello-confidential-workflows-ts` starter and [Confidential Workflows documentation](https://docs.chain.link/cre/concepts/confidential-workflows). The starter demonstration is not required to run this package. Third-party dependencies retain their own licenses; this README does not relicense them. Preserve any competition-required AI-use disclosure when packaging the submission.

----x----x----x----x----x----