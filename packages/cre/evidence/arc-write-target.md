# Arc write-target finding

Verified using CRE CLI v1.33.0 and the logged-in account's `cre workflow supported-chains --output json`, 2026-09-09.

**Arc Testnet is supported and enabled for this tenant.** D3 is resolved: a separate off-chain relayer is not necessary solely because of chain availability. This is a capability finding, not proof of a successful write or deployment approval.

| Network | Selector (decimal string; do not parse as JS number) | DON forwarder | Simulation mock forwarder |
| --- | --- | --- | --- |
| Arc Testnet (`arc-testnet`) | `3034092155422581607` | `0x76c9cf548b4179F8901cda1f8623568b58215E62` | `0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1` |
| Ethereum Sepolia (`ethereum-testnet-sepolia`) | `16015286601757825753` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |

The current Sepolia sink is configured with the **simulation mock forwarder**, not the tenant's DON forwarder. Its ABI lacks `onReport(bytes,bytes)`. The Arc escrow also lacks `onReport` and authorizes a specific EOA relayer. Network support alone does not make either deployed contract a CRE receiver.

Required next step: Member A supplies authenticated receiver adapters; agree on the Arc report schema and cross-chain retry behavior before implementing that transport. A reconciliation workflow must handle Sepolia success followed by Arc failure. Do not advertise atomicity or trustless bridging.

Mock-forwarder simulation broadcasts may produce real testnet transactions, but do **not** prove DON signature validation or hardware-enclave execution. Use isolated testnet/demo receivers and synthetic data, never real funds or real sensitive policies.

Sources:

- [Official supported networks](https://docs.chain.link/cre/supported-networks-ts)
- [Official EVM write flow and receiver requirement](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-ts)
- [Official confidential-workflow boundary and private beta](https://docs.chain.link/cre/concepts/confidential-workflows)
- [Live read-only contract verification](preflight/live-contracts.json)