# Sovereign Workflow 1

Sovereign is a protocol core for private policy enforcement around negotiated
agent agreements. A policy is committed with a 32-byte salt, the final offer is
bound by EIP-712, a confidential workflow writes only a decision, and a relayer
can move the corresponding USDC escrow on Arc.

This repository owns the canonical encoding, Sepolia registries, the forwarder-
authenticated decision sink, and the Arc escrow contract. CRE workflows and the
agent/UI packages consume the shared types and frozen vectors.

Standard security primitives are imported from the pinned OpenZeppelin Contracts
submodule at `lib/openzeppelin-contracts` (v5.7.0). The protocol-specific hashing,
state machine, decision guards, and escrow rules remain Sovereign-owned code.

## Local verification

```sh
forge fmt --check
forge test
```

The TypeScript package uses the same ABI encoding and Sepolia EIP-712 domain:

```sh
npm install
npm run build:contracts
npm run test:core
```

The Solidity and TypeScript tests both assert the known-answer vectors in
`packages/core/fixtures/vectors.json`.

## Protocol contract

`policyCommitment` is:

```text
keccak256(abi.encode(minYieldBps, maxLossBps, maxDuration, salt))
```

`termsHash` is:

```text
keccak256(abi.encode(intentId, principal, counterparty, capital, duration,
                    yieldBps, expiresAt, nonce))
```

Offers use EIP-712 domain `Sovereign`, version `1`, chain ID `11155111`, and
the deployed `AgreementRegistry` as the verifying contract. The signed offer is
the counterparty view of the final terms.

The agreement registry accepts a final offer only when the principal owns the
intent, the terms fit the intent bounds, the offer is unexpired, and the
counterparty signature recovers correctly. It then moves the agreement to
`PENDING_VALIDATION` and emits `ValidationRequested`.

`DecisionSink.recordDecision` is callable only by the configured CRE forwarder.
It rejects zero decision IDs, stale nonces, unknown check kinds, and decisions
whose kind does not match the current agreement state. Validation moves to
`ACTIVE` or `REJECTED`; an accepted breach check moves `ACTIVE` to `BREACHED`.

The Arc escrow is callable only by the configured relayer, uses safe ERC-20
transfers, and is protected against reentrancy. Each agreement can be locked
once and can finish through exactly one terminal path: `UNWOUND` or `SETTLED`.

## Deployment

Copy `.env.example`, provide the deployer and network values, and run:

```sh
forge script deploy/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify

forge script deploy/DeployArcEscrow.s.sol:DeployArcEscrow \
  --rpc-url "$ARC_RPC_URL" --broadcast
```

The deployer address must be supplied separately because the script uses the
private key for broadcasting and the address as the explicit owner. Record and
verify the resulting addresses under `deployments/` before integration freeze.

## Security boundaries and honest limitations

- Policy fields and salt never belong in an onchain event or decision payload.
- The salt prevents practical enumeration of small policy thresholds.
- A decision is accepted only from the configured forwarder and only for the
  state it is allowed to change.
- EIP-712 signatures bind the final terms to the registry address and Sepolia.
- Escrow settlement leaves any retained amount in the escrow contract; the
  relayer must use a separately specified retention policy before production.

SAFE monitoring produces no report or transaction. Only an actionable breach
is published (`checkKind=2, result=true`); initial validation ACCEPT/REJECT
outcomes remain public. Under the strictly-greater loss rule, a hypothetical
SAFE at 280 followed by a known loss-triggered BREACHED at 310 implies
**280 ≤ maxLossBps < 310**. Duration can also trigger breach.

Suppressing SAFE reduces disclosure, but observable positions, timing, absence
of enforcement and repeated agreements can still narrow or reveal a threshold.
Fresh salts protect commitment hiding, not inference about a reused policy.
There is no unconditional exact-threshold secrecy guarantee. Local CRE
simulation is not hardware-enclave execution; local EVM test receipts are not
public-testnet or DON-attestation evidence.

This is a testnet protocol core. Production deployment requires audited token
assumptions, operational key rotation, a relayer failure policy, and an audited
cross-chain message design.

## Authenticated CRE receiver

The [receiver](contracts/src/CREDecisionReceiver.sol) validates CRE forwarder,
workflow identity, report encoding and deterministic decision IDs while
preserving the existing DecisionSink nonce store. SAFE breach reports are rejected.
See [deployment and verification requirements](packages/cre/scripts/CHAIN_VERIFICATION.md).

## Integration packages

- [CRE workflows and evidence](packages/cre/README.md): confidential-handler registration, private-feed reads, breach-only reports and local two-chain verification.
- [Authenticated position provider](packages/position-feed/README.md): durable agreement-scoped read/write credentials, observations and quotas; simulated-position service, not a real venue oracle.
- [Trusted Sepolia → Arc relayer](packages/relayer/README.md): finalized source events, persistent recovery and receipt-verified escrow actions. Default is read-only; not a cryptographic bridge.
- [Frontend](frontend/README.md): canonical agent signing, real wallet account connection and public finalized-state reads. Fixture pages remain explicitly synthetic.

Public deployment still requires funded authorized accounts, the actual CRE workflow
identity/receiver configuration, HTTPS provider deployment and explicit broadcast
authorization. No public-chain deployment is implied by passing local tests.
