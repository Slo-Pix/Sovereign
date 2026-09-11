# Sovereign: Outstanding Work

**Snapshot:** 2026-09-11  
**Repository:** `Slo-Pix/Sovereign-WF2`  
**Scope:** This document lists only what is still outstanding. Completed implementation and the verified public-testnet rehearsal evidence live in `deployments/canonical.json`, `packages/cre/INTEGRATION.md`, and the repository history.

## Workflow Map

1. **Workflow 1:** contracts, canonical encoding, registries, decision sink, and Arc escrow.
2. **Workflow 2:** confidential CRE evaluation, decision delivery, private position-feed consumption, and Sepolia-to-Arc relaying.
3. **Workflow 3:** agent negotiation, canonical offer signing, position simulation/provider operations, and the frontend.

# Simulation Path: Remaining Tasks

This is the selected path. Everything below must be done.

### Workflow 1

- Complete explorer verification for the deployed receiver and retain the ABI revision, wiring transactions, and receipts. Confirm `evmVersion` from the compiled artifact metadata rather than assuming a default, because `foundry.toml` does not pin `evm_version`.
- Review and approve the shared ABI, privacy, frontend, and cross-team changes.
- Decide whether ENS authorization is retained. If retained, add and deploy a real registry authorization hook; a displayed ENS name alone is not permission enforcement.

### Workflow 2

- Final cleanup pass once all members have finished: untrack assistant tooling (`.agents/`, `.claude/`, `skills-lock.json`) and decide which of `packages/cre/evidence/` stays as published documentation. Deliberately deferred so nobody loses working files mid-effort. The audit is done: no databases, generated output, or secret values are tracked, and the three `secrets.yaml` files contain only secret-name references.
- Implement ENS only if the team keeps it in scope and Workflow 1 supplies the authoritative hook.

### Workflow 3

- Review and accept the updated agent contract and canonical signing changes.
- Decide between a scripted operator-driven demo and a fully interactive browser flow.
- For a fully interactive flow, add transaction forms, chain checks, wallet rejection/disconnect handling, pending/replaced transaction handling, and receipt-driven progression.
- Submit truthful fresh observations using the exact four-field provider schema and strictly increasing timestamps.
- Keep private policy values, private loss values, threshold distance, SAFE history, and proof fiction out of all public UI and API output.
- Show funded, locked, breached, unwound, and settled states only after the corresponding destination receipts/events and agreed reconciliation succeed.
- Complete mobile/desktop UX checks, wallet failure states, unavailable-RPC states, dependency review, and cleanup of remaining nonblocking build/lint warnings.

### Cross-Workflow

- Approved code and ownership review, including the cross-team Workflow 3 changes.
- Restart and recovery rehearsal against the public run. Currently proven only in local integration tests.

**Operational note on RPC selection**

The relayer requires `eth_getLogs` ranges wider than ten blocks and uses `retryCount: 0`. Free-tier Alchemy endpoints cap `eth_getLogs` at a ten-block range and can exceed the client timeout on a cold connection, which surfaces as the generic non-checkpointed failure message rather than a specific error. Use endpoints without that cap, keep `DESTINATION_START_BLOCK` close to the destination head, and wrap `main()` when a specific diagnostic is needed.

# If DON: Additional Tasks

Not required for the demo. These apply only if approved DON deployment is later pursued, and they are gated on Chainlink approval. They are additions to the simulation tasks above, not replacements.

### Workflow 1

- Redeploy `CREDecisionReceiver` bound to the real DON forwarder, workflow ID, and workflow owner. The existing receiver is bound to the simulator's fixed metadata identity and must not be reused.
- Have the DecisionSink owner call `setForwarder` on the new receiver and run the receiver preflight.
- Execute one validation and breach rehearsal against the new receiver.

### Workflow 2

- Obtain deployment access for the organization, then link an owner key and fund it.
- Create the production configuration with `delivery: 'sepolia'` and provision secrets through the CRE secret-management flow rather than `.env`.
- Deploy and activate the workflow, then record the resulting workflow ID and owner and hand both to Workflow 1.

### Workflow 3

- Host the position feed behind a public HTTPS origin with external edge limits, no redirects, and dedicated persistent private storage. A DON cannot reach the loopback origin used by the simulation run. Scoped read/write credential provisioning is already implemented in `packages/protocol-ops/src/provision-feed.ts`; only the public origin is missing.

### Cross-Workflow

- Re-run the authenticated-position-observation gate against the hosted origin. It is met on the simulation path via credential-bound loopback observations under `delivery: 'simulation-sepolia'`, but reopens under DON.

## Standing Constraints

These are not tasks, but they bound every claim made about the system.

- The relayer is a trusted EOA transport, not a trustless bridge. Finality delays, reorg handling, non-atomicity, and operator key custody remain operational risks.
- The CRE binary is visible to the DON; only confidential input data and derived private policy values stay inside the enclave.
- Exact threshold secrecy is not claimed. Timing, repeated observations, public inputs, the absence of decisions, and validation behavior can create residual inference.
- Mock-forwarder execution is real public-testnet execution, but it is not DON consensus and not hardware TEE attestation. It must never be described as either.

## Evidence

Verified public-testnet rehearsal transaction hashes, block numbers, and final states are recorded in `deployments/canonical.json` under `rehearsal`. Deployment identities and the simulator-versus-DON identity distinction are in `packages/cre/INTEGRATION.md`.

