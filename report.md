# Sovereign: Current Project Status

**Snapshot:** 2026-09-11  
**Repository:** `Slo-Pix/Sovereign-WF2`  
**Current execution mode:** CRE CLI simulation with `--broadcast`, using Chainlink's Sepolia MockKeystoneForwarder. This produces real Sepolia and Arc testnet transactions, but it is not DON consensus or hardware TEE attestation.

## Executive Summary

Sovereign has three connected workflows:

1. **Workflow 1:** intent and agreement lifecycle, decision validation, state-machine safety, and Arc escrow.
2. **Workflow 2:** confidential CRE evaluation, private position-feed access, decision delivery, and Sepolia-to-Arc relaying.
3. **Workflow 3:** agent negotiation, canonical offer signing, provider operations, and frontend monitoring.

The core implementation is complete and locally validated. The selected simulation path has also been executed end to end on public testnets: a CRE mock-forwarder decision activated and breached an agreement on Sepolia, the trusted relayer locked and unwound Arc escrow, and owner reconciliation finalized the agreement as `SETTLED`.

The remaining work is primarily submission hardening, Workflow 3 product completion, stable operations infrastructure, and optional real-DON deployment.

## Actual Implemented Flow

### 1. Agreement creation

- A principal creates an intent through `IntentRegistry`.
- A signed seven-field canonical offer is proposed through `AgreementRegistry`.
- The agreement follows the on-chain path:

`OPEN -> NEGOTIATING -> PENDING_VALIDATION -> ACTIVE -> BREACHED -> UNWIND -> SETTLED`

- Terms, policy commitment, participants, capital, expiry, and nonce are bound to the agreement.

### 2. Confidential validation

- CRE reads the public agreement state and authenticated position data.
- Private policy values and salts are retrieved only inside the simulated CRE handler.
- Terms and policy commitments are validated without publishing private thresholds.
- Ordinary rejection and commitment failure use the same public result.
- SAFE validation decisions are rejected by the sink guard and do not consume a public decision nonce.

### 3. Decision delivery

- The CRE simulation produces a report for an actionable decision.
- The report is delivered through the Sepolia MockKeystoneForwarder to `CREDecisionReceiver`.
- The receiver verifies the fixed simulator workflow identity, owner, forwarder, report schema, decision ID, and nonce.
- The receiver calls `DecisionSink`, which applies replay, state, decision-kind, and terminal-state guards.
- SAFE monitoring results are withheld rather than published.

### 4. Cross-chain escrow handling

- The trusted relayer reads finalized Sepolia `DecisionRecorded` events.
- It verifies agreement binding, nonce, decision ID, finality, reorg safety, and source history.
- It locks Arc escrow on acceptance and unwinds it after a finalized breach.
- Owner reconciliation separately advances Sepolia registry state from `UNWIND` to `SETTLED`.
- The relayer is an explicitly trusted EOA transport, not a trustless bridge.

### 5. Position-feed boundary

- The position feed stores only scoped token hashes and exact four-field observations.
- Read and write credentials are separate, agreement-bound, rotatable, revocable, quota-limited, and never returned in responses.
- The local feed is exposed through a read-only gateway for the temporary Cloudflare Quick Tunnel.
- The gateway exposes only authenticated position reads and health; it does not expose the operator writer route.
- Public output contains no policy threshold, salt, private loss value, SAFE history, or proof fiction.

## Completed Implementation

### Workflow 1

- IntentRegistry, AgreementRegistry, DecisionSink, SovereignEscrow, and CREDecisionReceiver are implemented.
- OpenZeppelin contracts are used for standard ownership and reentrancy behavior.
- Canonical terms, policy, offer, and decision encodings are shared through `packages/core` and fixture vectors.
- OPEN and NEGOTIATING transitions are implemented and tested.
- Terminal-state, replay, nonce, decision-kind, breach-before-activation, duplicate-lock, and escrow-reuse protections are implemented.
- Foundry fuzz and invariant-handler coverage protects illegal state transitions.
- Sepolia contracts and Arc escrow are deployed and explorer-verified.
- The CRE receiver ABI and DecisionSink ABI are checked against compiled artifacts.

### Workflow 2

- CRE validation and breach-monitoring handlers are implemented.
- `handlerInTee` registrations, secret retrieval, policy commitment checks, state guards, expiry checks, and feed validation are covered.
- Breach-only publication is enforced: SAFE and neutral monitoring outcomes do not publish decisions.
- The position feed and read-only public gateway are implemented.
- The relayer has dry-run-by-default behavior, explicit broadcast mode, durable SQLite cursors, receipt checks, reorg detection, restart recovery, idempotence, and single-writer locking.
- Protocol operations provide readiness checks and owner-authorized reconciliation.
- Local two-chain lifecycle, receiver migration, replay rejection, token conservation, HTTP security, restart, and privacy tests pass.

### Workflow 3

- Agent signing uses the shared seven-field canonical offer schema and digest.
- Intent, principal, counterparty, expiry, capital, terms, and offer nonce are bound correctly.
- Strategy and treasury agent tests pass.
- The frontend has public read-only monitoring, state displays, injected-wallet connection, RPC failure handling, and privacy-correct public data boundaries.
- Synthetic/demo UI data is clearly separated from real on-chain state.
- The frontend does not claim to sign offers or submit protocol transactions where those flows are not implemented.

## Verified Public-Testnet Evidence

Canonical deployment and rehearsal data is maintained in [deployments/canonical.json](deployments/canonical.json).

### Sepolia

- IntentRegistry: `0x2AB9B14995048f0A6e0A80830c2654a1d72f8deD`
- AgreementRegistry: `0x81134eF33D0C195c6c17610f40C5FF53afBD6AF4`
- DecisionSink: `0xFAf580b27CBE494adcE3F4D9F78caB42a6e3088D`
- CREDecisionReceiver: `0xA4Ce101a95DCD797690d7Ae8845ea6989D9FDb62`
- Mock forwarder: `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`
- Receiver source: verified on Sepolia Etherscan.
- Delivery mode: `simulation-broadcast-mock-forwarder`.

### Arc testnet

- SovereignEscrow: `0xB8d02CAcaa506ddE0734E8ce1EDb1441ef372b3c`
- USDC: `0x3600000000000000000000000000000000000000`
- Authorized relayer: `0x7B20767D2d22326D3a8EfFAd781Ea8557BC7A8E0`

### Rehearsal result

Agreement:

`0x08aea1ace117f14f97f852be19c3a68ad07a43be6b42099a24bba64a27ae389b`

- Sepolia activation: `0x780399f2021a73c88262c51d828935475db79e188889f0b97ee746f3932adaa6`
- Sepolia breach: `0xe2d5de804e294716501baf7ee73203c05fd12ad041ca757275262cdd5c938626`
- Arc escrow lock: `0xa451e043238c539d736195dabbbe03c687955f5d6de98aa26b53a89845864722`
- Arc escrow unwind: `0x80925167aa3639108fec481f670c2da04aed92dde2f33a0baeb7922a65cb3313`
- Sepolia markUnwinding: `0x22dd525f767a07622356124d781b208552db8c9f240d35175e38288bb469ca86`
- Sepolia markSettled: `0x7730aabb7cca24db053467a779b346f67de791906c29ea93379737b8cce161b1`
- Final Sepolia state: `SETTLED`
- Final Arc escrow state: `UNWOUND`
- Returned escrow balance: zero.

An earlier receiver attempt emitted an unsuccessful `ReportProcessed` event because it used config-derived metadata instead of the simulator's fixed identity. It did not consume a sink nonce or alter agreement state. The active receiver and later successful rehearsal supersede it.

## Validation Results

The latest validation run passed:

- Foundry contracts: passed.
- Core: 3 tests passed.
- CRE: 43 tests, 360 assertions passed.
- Position feed and gateway: 40 tests, 381 assertions passed.
- Relayer: 86 tests, 231 assertions passed; one opt-in local-EVM test skipped.
- Protocol operations: 47 tests passed.
- Agents: 78 tests passed.
- Frontend: 82 tests passed, typecheck passed, production build passed.
- Frontend lint: no errors; two existing custom-font warnings remain.
- JSON validation and whitespace checks passed.

## Remaining Work

### Selected simulation path

1. Review and approve the final cross-team code and ownership boundaries.
2. Decide whether ENS authorization remains in scope. A displayed ENS name is not authorization; retaining ENS requires a real registry permission hook and redeployment.
3. Complete the interactive Workflow 3 transaction flow if the demo requires it: intent creation, offer signing, token approval, chain checks, wallet rejection handling, pending/replaced transactions, and receipt-driven progression.
4. Complete mobile and desktop UX checks, unavailable-RPC states, and final dependency/build review.
5. Replace the temporary Quick Tunnel with stable HTTPS only if persistent or production-like provider operations are required. The Quick Tunnel is suitable for a temporary demonstration and disappears when its process stops.
6. Perform a final restart/recovery rehearsal against the public run and preserve the evidence bundle.

### Real DON path

Real DON deployment is not currently complete and is gated by Chainlink organization approval:

1. Obtain CRE deployment access.
2. Link and fund a workflow-owner key.
3. Create the production `delivery: 'sepolia'` configuration.
4. Provision secrets through CRE secret management rather than local `.env` files.
5. Deploy and activate the workflow to obtain the real workflow ID and owner.
6. Deploy a new `CREDecisionReceiver` bound to the real DON forwarder, workflow ID, and owner.
7. Update `DecisionSink` to the new receiver/forwarder wiring.
8. Re-run receiver preflight and validation/breach delivery.
9. Host the position feed on stable external HTTPS. The temporary Quick Tunnel and loopback feed are not DON-grade infrastructure.

## Honest Security and Privacy Boundaries

- Mock-forwarder execution is real public-testnet execution, but it is not DON consensus or hardware TEE attestation.
- The relayer is a trusted EOA transport. Finality delays, reorg handling, non-atomicity, and operator-key custody remain risks.
- The CRE binary is visible to the DON. Confidential inputs and derived private policy values are the protected data boundary.
- Exact threshold secrecy is not claimed. Repeated decisions, timing, public inputs, absence of decisions, and validation behavior can reveal bounded information about a hidden threshold. For example, SAFE at one value followed by BREACHED at a higher value narrows the possible threshold interval.
- A temporary HTTPS tunnel has no uptime, identity, or production availability guarantee.
- Public UI and API responses must not expose policy thresholds, salts, private loss values, threshold distance, SAFE history, private proofs, or credentials.
