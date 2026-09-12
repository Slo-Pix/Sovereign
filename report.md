# Sovereign: Outstanding Work

**Snapshot:** 2026-09-11  
**Repository:** `Slo-Pix/Sovereign-WF2`  
**Scope:** This document lists only what is still outstanding. Completed implementation and the verified public-testnet rehearsal evidence live in `deployments/canonical.json`, `packages/cre/INTEGRATION.md`, and the repository history.

## Workflow Map

1. **Workflow 1:** contracts, canonical encoding, registries, decision sink, and Arc escrow.
2. **Workflow 2:** confidential CRE evaluation, decision delivery, private position-feed consumption, and Sepolia-to-Arc relaying.
3. **Workflow 3:** agent negotiation, canonical offer signing, position simulation/provider operations, and the frontend.

# Remaining Tasks

Simulation is the delivery path. Simulation runs entirely locally and is what Chainlink judges for bounties, so no deployment access is required and nothing here waits on approval.

### Workflow 1

- Review and approve the shared ABI, privacy, frontend, and cross-team changes.
- Decide whether ENS authorization is retained. If retained, add and deploy a real registry authorization hook; a displayed ENS name alone is not permission enforcement.

**Note on rebuilding the receiver.** The deployed bytecode was compiled with `evm_version = prague`, which `foundry.toml` now pins explicitly. Current Foundry defaults to `osaka`, which produces different bytecode, so do not remove that pin.

### Workflow 2

- Final cleanup pass once all members have finished: untrack assistant tooling (`.agents/`, `.claude/`, `skills-lock.json`) and decide which of `packages/cre/evidence/` stays as published documentation. Deliberately deferred so nobody loses working files mid-effort. The audit is done: no databases, generated output, or secret values are tracked, and the three `secrets.yaml` files contain only secret-name references.
- Replace the temporary Cloudflare Quick Tunnel with a stable HTTPS origin **only if** persistent provider operations are required. A Quick Tunnel is adequate for a timed demonstration and disappears when its process stops, so the tunnel URL must be regenerated and re-frozen into the CRE config before each session.
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
- Restart and recovery rehearsal against the public run, preserving the resulting evidence bundle. Currently proven only in local integration tests.
- One timed demo rehearsal end to end, after the scripted-versus-interactive decision is made.

**Operational note on RPC selection**

The relayer requires `eth_getLogs` ranges wider than ten blocks and uses `retryCount: 0`. Free-tier Alchemy endpoints cap `eth_getLogs` at a ten-block range and can exceed the client timeout on a cold connection, which surfaces as the generic non-checkpointed failure message rather than a specific error. Use endpoints without that cap, keep `DESTINATION_START_BLOCK` close to the destination head, and wrap `main()` when a specific diagnostic is needed.

## Standing Constraints

These are not tasks, but they bound every claim made about the system.

- The relayer is a trusted EOA transport, not a trustless bridge. Finality delays, reorg handling, non-atomicity, and operator key custody remain operational risks.
- Exact threshold secrecy is not claimed. Timing, repeated observations, public inputs, the absence of decisions, and validation behavior can create residual inference.
- The workflow binary is not secret; only confidential input data and derived private policy values stay inside the enclave.
- Mock-forwarder execution is real public-testnet execution, but it is not decentralized-oracle-network consensus and not hardware TEE attestation. It must never be described as either.

## Evidence

Verified public-testnet rehearsal transaction hashes, block numbers, and final states are recorded in `deployments/canonical.json` under `rehearsal`. Deployment identities and the simulator metadata identity values are explained in `packages/cre/INTEGRATION.md`.

