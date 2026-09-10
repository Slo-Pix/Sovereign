# Deployments

Deployments are environment-specific and must be recorded only after explorer
verification. Copy the addresses printed by the deploy scripts into a local
deployment record, then publish the verified record used by the demo.

Required Sepolia values:

- `IntentRegistry`
- `AgreementRegistry`
- `DecisionSink`
- CRE forwarder

Required Arc testnet values:

- `SovereignEscrow`
- USDC token
- relayer

The registry and escrow are intentionally separate deployments. The relayer
must consume `DecisionRecorded` on Sepolia and call the matching Arc escrow
method using the agreement and decision identifiers.
