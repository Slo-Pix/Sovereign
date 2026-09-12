# Sovereign CRE

Confidential offer validation and breach-only risk monitoring for Sovereign. Workflows consume the shared core encoders and ABIs without changing their encoding.

**Status:** decision logic, authenticated position reads, simulation tooling, and the public-testnet mock-forwarder rehearsal are implemented. The rehearsal covers Sepolia activation/breach, Arc lock/unwind, and owner reconciliation. This is not a deployed hardware TEE or real DON attestation, and remains unaudited testnet software.

## Quick start

Requirements: Bun, the CRE CLI and a configured CRE account for simulations. Verified with Bun 1.3.13, CRE CLI v1.33.0 and SDK 1.18.0. Simulation runs entirely locally and needs no deployment approval. Do not process real sensitive inputs through it; use synthetic policy and position data.

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
- Set `positionOrigin` and `positionAuthSecretId`; the old `positionUrl` is rejected. Put credentials in the secret store, not public config. The credential format and provider contract are defined under [Private position feed](#private-position-feed) below.
- Keep `delivery: report-only` until an authenticated receiver is deployed and verified. For Sepolia writes, set its actual `reportReceiver`; the existing sink is not a substitute.
- `delivery: simulation-sepolia` is the only mode that permits an explicit `http://127.0.0.1:PORT` feed while broadcasting through the mock forwarder. Production `delivery: sepolia` remains HTTPS-only.
- Trigger index 0 validates offers; index 1 monitors breaches. `NO_DECISION` is not a SAFE attestation.
- [sovereign/secrets.yaml](sovereign/secrets.yaml) maps secret IDs to local simulation variables. [The environment example](.env.example) contains empty placeholders only. Never use real sensitive policies with local simulation.
- [project.yaml](project.yaml) configures CRE's Sepolia RPC. `SEPOLIA_RPC_URL` and `ARC_RPC_URL` separately configure the read-only preflight and are never printed by it.

Demo configurations are generated temporarily and passed via CLI overrides. Their absent private default paths are intentional. Setting report delivery does not itself authorize broadcasting; none of the commands above performs deployment or broadcast.

## Simulator metadata identity

Read this before deploying or rebuilding a receiver. Getting it wrong silently rejects every report.

CRE CLI v1.33.0 simulation inserts **fixed** identity values into mock-forwarder report metadata:

```text
workflow ID     0x1111111111111111111111111111111111111111111111111111111111111111
workflow owner  0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa
mock forwarder  0x15fC6ae953E024d975e77382eEeC56A9101f9F88   (Sepolia)
```

The value printed by `cre workflow hash` is the deploy-style identity and is **not**
what the simulator puts into reports. A simulation receiver must bind to the fixed
mock values above. Substituting the config-derived hash produces a receiver that
accepts nothing — this already caused one failed deployment, recorded in
[`deployments/canonical.json`](../../deployments/canonical.json) as
`creConfigDerivedWorkflowHash`, which is kept separate from the deployed identity
for exactly this reason.

Mock delivery produces genuine Sepolia transactions, but it is not a cryptographic
authenticity proof. Never imply a simulator report proves attestation.

## Private position feed

The workflow fetches `ORIGIN/agreements/LOWERCASE_AGREEMENT_ID/position`. There is no
caller-controlled path, query or credential-in-URL.

The credential is retrieved with `TeeRuntime.getSecret` and must be a JSON object with
exactly three fields:

```json
{ "origin": "https://positions.example.com", "agreementId": "0x…", "token": "…" }
```

| Field | Rule |
| --- | --- |
| `origin` | Must equal the configured `positionOrigin` exactly. HTTPS by default; lowercase ASCII DNS host, optional port, no trailing slash, path, query or IP literal. |
| `agreementId` | Must equal the configured `agreementId`. A config-only substitution produces no HTTP request at all. |
| `token` | 32–4096 characters matching `[A-Za-z0-9._~+/-]` with optional `=` padding and no whitespace. |

Request behaviour: HTTP GET, five-second timeout, `Accept: application/json`,
`Authorization: Bearer TOKEN`, `Cache-Control: no-store`, SDK caching disabled, and
**no application-level retry**. Credential errors, HTTP failures, redirects,
malformed or oversized bodies, wrong agreement IDs and stale or future observations
all yield no usable position and therefore no SAFE or BREACHED report.

Binding a credential to a destination does not verify the provider's observations.
An authorized malicious provider can still cause a wrongful unwind or suppress a
needed one. DNS, HTTPS and the provider remain trust dependencies; nonce protection
does not make false source data truthful.

## Evidence and judging claims

| Evidence | Demonstrates | Does not demonstrate |
| --- | --- | --- |
| [Acceptance](evidence/decisions/accept.txt), [rejection](evidence/decisions/reject.txt), [mismatch](evidence/decisions/mismatch.txt) | CLI/WASM validation and confidential-handler registration | Hardware confidentiality or live agreement state |
| [SAFE suppression](evidence/decisions/safe.txt), [breach](evidence/decisions/breach.txt), [boundary](evidence/decisions/boundary.txt), [stale](evidence/decisions/stale.txt) | Silent non-actionable monitoring and an actionable breach report | A continuous on-chain lifecycle or token transfer |
| [Authenticated HTTP probes](evidence/private-feed/README.md) | Actual HTTP requests, credential handling and tested redirect refusal | Real provider authorization, deployed HTTPS behavior or hardware TEE |
| [Read-only preflight](evidence/preflight/live-contracts.json) | Timestamped RPC checks of bytecode/wiring | Current receiver deployment, wallet funding or enforcement |
| [Arc capability finding](evidence/arc-write-target.md) | Tenant network/forwarder availability at the recorded check | Successful Arc delivery or deployment approval |
| [Provider interoperability](evidence/provider-integration/README.md) | Real private service and actual CRE HTTP, restart/revocation tests | HTTPS deployment, real venue truth or TEE attestation |
| [Local chain lifecycle](scripts/CHAIN_VERIFICATION.md) | Mined local receiver/escrow transactions, replay rejection and balances | Public-testnet receipts or hardware TEE |

Scenarios are independent synthetic tests, not a fabricated live lifecycle. Retain simulator warnings and labels. Test-only scenario names/report counters are absent from the real-chain handler output.

## Honest limitations: private inputs, observable enforcement

Sovereign minimizes disclosure; it does **not** guarantee complete threshold secrecy. Under the implemented strictly-greater loss rule, SAFE at 280 followed by a known **loss-triggered** breach at 310 would imply **280 ≤ maxLossBps < 310**. Duration can also trigger breach; the loss bound requires ruling that out.

SAFE produces no report, public SAFE verdict, transaction or on-chain nonce consumption. The transport independently rejects accidental SAFE publication. Nevertheless, observable positions, known cadence, absence/timing of a breach, repeated agreements and offer ACCEPT/REJECT outcomes can narrow or reveal an integer threshold. Fresh salts protect commitment hiding, not inference about a reused threshold.

Workflow binaries, chain reads and enforcement effects remain public. Neutral outputs do not prove timing indistinguishability. `ACTIVE` means no recorded transition, not a recent successful risk check. Feed failure can leave capital exposed; private alerts and an outage response are required.

The position client requires HTTPS by default, disables caching, bounds requests and has no unauthenticated fallback. Its provider still sees—and can falsify—its own observations. Provider authorization, restricted writers, durable quotas, configuration permissions and removal of public mirrors are operational requirements. Cron is not an anti-abuse limiter. Hiding an API does not conceal positions reconstructable from public chain data.

Actionable-only contract enforcement complements sender suppression: even reverted calldata can leak. Verify actual receiver wiring; changed source does not upgrade deployed bytecode. Nonces prevent replay, not false data or all delivery failures.

Keep private values and detailed errors out of logs, UI, telemetry, reports and calldata. Output scans are regression checks, not formal side-channel audits. Randomized decisions can compromise enforcement; delayed/batched publication adds exposure and is not implemented. ZK proofs alone cannot hide public breach outcomes/transfers. Hiding those effects requires a different confidential-state architecture.

## Integration prerequisites

The provider and a [trusted EOA relayer](../relayer/README.md) are now implemented and locally tested. Public-testnet operation still requires receiver deployment/identity wiring, HTTPS provider/token provisioning, funded wallets and token allowance, correct replay origins and actual public receipt/balance evidence. The relayer verifies finalized source events and recovers using escrow state/proofs; it is not an atomic cryptographic bridge. ENS authorization requires a genuine registry hook if retained.

## Attribution

The confidential-handler integration was developed using Chainlink's `hello-confidential-workflows-ts` starter and [Confidential Workflows documentation](https://docs.chain.link/cre/concepts/confidential-workflows). The starter demonstration is not required to run this package. Third-party dependencies retain their own licenses; this README does not relicense them. Preserve any competition-required AI-use disclosure when packaging the submission.
