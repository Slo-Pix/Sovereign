# Workflow 2: requests to complete the real testnet demo

## Member A — Sepolia report receiver

The [receiver source](../../contracts/src/CREDecisionReceiver.sol) and [deployment script](../../deploy/DeployCREReceiver.s.sol) are integrated from upstream commit `40cd161`. The active simulation receiver is deployed and wired to the existing DecisionSink; the public address and fixed mock metadata identity are recorded in [`deployments/canonical.json`](../../deployments/canonical.json). The existing deployed DecisionSink only exposes `recordDecision`; CRE's forwarder calls `onReport(bytes metadata, bytes report)`, not arbitrary application calldata.

Use the following requirements as the receiver deployment/integration checklist (not a request to rebuild the implemented adapter):

1. `IReceiver` / ERC-165 support and `onReport(bytes,bytes)`.
2. Forwarder authorization **and** expected workflow owner/identity checks on CRE metadata. A trusted forwarder alone does not identify Sovereign's workflow.
3. An exact ABI decode of `(bytes32 agreementId, bytes32 decisionId, uint8 checkKind, bool result, uint64 nonce)` — no function selector in the report payload.
4. Validation of the derived decision ID: `keccak256(abi.encode(agreementId, checkKind, nonce))`. The existing sink only checks nonzero; the adapter should enforce the convention.
5. A call to the existing `DecisionSink.recordDecision` preserving its state and nonce guards. Reverts must propagate, not become false success.
6. Owner-controlled binding to the existing sink. Its owner must call `setForwarder(adapter)` so calls from the adapter are permitted. The adapter, not the sink, then checks the actual CRE forwarder. This approach does not require replacing AgreementRegistry just to receive reports.
7. Tests rejecting unauthorized callers/workflows, malformed reports, stale nonces, invalid check kinds, and terminal-state decisions.
8. Reject `CHECK_BREACH` with `result=false` as `NonActionableDecision` before accepting/emitting a decision or consuming a nonce. Preserve `CHECK_VALIDATION, result=false` (offer rejection). Prefer sink-level enforcement for all authorized paths; an adapter guard protects only traffic through that adapter. Sender-side suppression is already implemented and remains necessary because even rejected transaction calldata can disclose a SAFE value. Contract changes remain Member A's responsibility.

Return public adapter address, ABI, setup transaction hashes and authorization configuration. No private keys in chat.

The sink error ABI now matches `NonActionableDecision`, and the compiler-verified [receiver ABI](../core/abis/CREDecisionReceiver.json) is included. No live receiver configuration should be inferred from source availability. Keeping the existing sink preserves its nonces; the adapter enforces SAFE rejection on that path even though changed sink source does not update previously deployed bytecode. Run [the read-only receiver preflight](scripts/CHAIN_VERIFICATION.md#read-only-receiver-deployment-preflight) with actual public identity/wiring values before broadcast.

CLI simulation broadcast uses the **Sepolia mock forwarder** `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`. Mock delivery is real Sepolia transaction delivery, but it is not a cryptographic authenticity proof; never imply a simulator report proves attestation.

CRE CLI v1.33.0 simulation uses fixed mock metadata identity values: workflow ID
`0x1111111111111111111111111111111111111111111111111111111111111111`
and workflow owner `0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa`. The value printed by
`cre workflow hash` is the deploy-style identity, not the identity inserted into
mock-forwarder simulation reports. The simulation receiver binds to the fixed mock
values, which is correct for this path and must not be "corrected" to the
config-derived hash.

## Arc transport — trusted relayer available; rehearsal completed

Arc is supported; see [the capability finding](evidence/arc-write-target.md). The existing escrow authorizes an EOA relayer, so [packages/relayer](../relayer/README.md) now implements that path with finalized source reads, durable SQLite cursor/receipt state, exact escrow reconciliation and reorg aborts. Direct CRE-to-Arc remains an alternative requiring an Arc receiver, not an implemented deployment. For the available EOA path:

- Authorized acceptance mirrors the public agreement into `SovereignEscrow.lockAgreement`.
- Authorized breach invokes `unwind` with the same decision ID emitted on Sepolia.
- The escrow's authorized relayer must match the configured dedicated EOA key. Source authenticity depends on the authenticated Sepolia receiver/sink; the EOA is explicitly trusted, not a cross-chain proof.
- Replay/out-of-order protection, exact agreement binding, and idempotent recovery must survive retries.
- Transfers require the Arc principal's token balance and ERC-20 approval for the escrow. Arc native gas also needs funding; a USDC token balance does not prove gas readiness.
- Sepolia acceptance and Arc locking are not atomic. Locking and unwind stay gated on finalized source evidence and confirmation-qualified destination receipts. Those gates were satisfied, not bypassed, in the completed rehearsal recorded under `rehearsal` in [`deployments/canonical.json`](../../deployments/canonical.json). Owner reconciliation of the source registry is performed separately by [packages/protocol-ops](../protocol-ops/README.md), not by the relayer.

## Member C — public integration inputs

The frontend/agent integration issues from `4f19519` are corrected locally:

- [The agent signer](../../frontend/packages/agents/src/signing/Eip712OfferSigner.ts) consumes core's seven-field types/digest and preserves full final terms. Negotiation role is `proposerRole`; signed `proposer` is the counterparty address. Tests cover canonical vectors, mutations and both convergence branches. The agent decision guard also now correctly accepts breach `true` and suppresses SAFE `false`.
- [The monitoring UI](../../frontend/app/%28dashboard%29/monitoring/page.tsx) reads public finalized chain state through a server API, with no private feed or SAFE history. Other fixture pages are clearly labeled synthetic. Wallet connection requests actual injected-provider accounts but does not itself authorize or send protocol transactions.
- [The private position service](../position-feed/README.md) is implemented with separate agreement-bound credentials, durable quotas/observations and offline rotation/revocation. [Actual CRE/provider interoperability](evidence/provider-integration/README.md) verifies the client against that service, not just a mock provider. Deploy the HTTPS endpoint and provision real operator configuration separately.

Return:

- Actual `agreementId` and final eight-field `Terms`, including `expiresAt` and offer `nonce`. The registry does not retain these last two fields, so they are needed to reconstruct and verify `termsHash`.
- An approved HTTPS position origin serving authenticated `GET /agreements/:agreementId/position`, with lowercase agreement IDs and `Authorization: Bearer TOKEN`. Member B's client is implemented; see [the exact private-feed interface](PRIVATE_FEED.md#exact-interface-for-member-c). The response must be status 200 with JSON content type and exactly `{agreementId,currentLossBps,elapsedSeconds,timestamp}`; integers must be nonnegative and exactly representable in JS. No redirect or unauthenticated fallback is accepted.
- Provision a high-entropy, read-only, agreement-scoped bearer token through a private channel. Member B stores `{origin,agreementId,token}` inside a separate credential secret; you receive just the token in the HTTP header and must enforce its agreement/read scope independently. Return public API/setup details only, not credentials in chat or Git.
- `timestamp` in Unix seconds and elapsed time measured from activation. Hold each scripted step until commanded.
- Show receipt-confirmed activation/funding before advancing the adverse sequence `180 → 210 → 250 → 280 → 310`.
- SAFE produces no report, public SAFE verdict or transaction. This supersedes the prior proposal for five step-change decisions and the recommendation to display public SAFE results. Show receipt-confirmed lifecycle state, not per-check SAFE badges. `ACTIVE`/`NO_DECISION` is not proof of current safety; stale/unavailable input may also withhold a decision. Do not correlate heartbeat telemetry with private outcomes.
- No private policy fields, salt, distance-to-threshold, or threshold-scaled bars in the UI.

The feed is a trusted simulated-position source, not a verified real trading venue or authenticated market oracle. Its identity and accuracy remain part of the demo's trust model.

Restrict feed mutation and evaluation configuration to authorized operators. Do not add a public endpoint accepting chosen positions for evaluation. Agree durable rate limits for any future request-triggered checks; cron cadence alone is not abuse protection. Public loss values and reliable monitoring timing still permit inference even without SAFE reports; see [honest limitations](README.md#honest-limitations-private-inputs-observable-enforcement).

Quota coordination: the client makes one application-level GET per eligible scheduled execution, with a five-second timeout and no in-handler retries. Executions can overlap. Apply durable per-credential/agreement quotas with reserved capacity for scheduled protection; do not let unrelated external requests exhaust that budget. Limit feed-write permissions separately. 429/outage responses withhold a decision; restricted operational alerts and an outage policy remain required.

## Local operator prerequisites

- Fund dedicated Sepolia and Arc testnet wallets; never use a mainnet wallet for this demo.
- Configure RPC endpoints and the broadcast key locally. Never send private keys, RPC tokens or policy data in chat.
- Generate a fresh random salt for each actual demo intent. Provision the identical policy into the workflow secret store/local simulation environment; publish only the resulting commitment.
- Private policy provisioning starts at its owner, outside CRE. The invariant is no unintended disclosure during workflow execution, not a claim that the policy never existed outside a TEE.
- Label all confidential execution as **simulation**, including when broadcasting real testnet transactions. Simulation runs locally; the mock forwarder delivers genuine Sepolia transactions but proves no hardware attestation.

## ENS

No ENS implementation or permission hook exists in the current registry. It cannot be presented as live authorization. Member A must supply/approve the authorizer hook before the ENS lane can become an actual signature-acceptance path; do not add a cosmetic badge as a substitute.
