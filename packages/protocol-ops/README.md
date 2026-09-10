# Protocol operations

`readiness.ts` performs read-only checks against the canonical Sepolia and Arc deployments. It never sends a transaction.

`reconcile.ts` is the owner reconciliation path for a full, confirmed breach unwind. It is dry-run by default and requires `--broadcast` for writes. It verifies canonical wiring, finalized Sepolia `DecisionRecorded`, confirmation-qualified Arc `EscrowUnwound`, exact agreement/escrow bindings, decision ID, latest nonce, full-capital return, owner identity, and a free owner nonce before each write. It rechecks the complete proof between `markUnwinding` and `markSettled` and waits for source finality after each transaction.

Required environment for a dry run:

```text
SEPOLIA_RPC_URL ARC_RPC_URL
RECONCILE_AGREEMENT_ID
SEPOLIA_BREACH_TX ARC_UNWIND_TX
```

For an agreement already in `SETTLED`, also provide `SEPOLIA_SETTLEMENT_TX`. For broadcast, use the original owner key as `DEPLOYER_PRIVATE_KEY`; the command checks it against the registry owner. Never put those values in Git or command history.

```sh
set -a; source /home/suyashagrawal/Sovereign/.env; set +a
bun --no-env-file packages/protocol-ops/src/reconcile.ts
bun --no-env-file packages/protocol-ops/src/reconcile.ts --broadcast
```

The command intentionally does not settle arbitrary or partial escrow balances. A crash leaves a fail-closed owner lock under the operator home directory; inspect the submitted hashes and remove that lock only after confirming no process is active. This tool does not replace contract ownership review, finality assumptions, or DON authorization.
