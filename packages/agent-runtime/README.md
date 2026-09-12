# Unattended Agent Runtime

This service runs the Treasury and Strategy agents outside the browser. It signs EIP-712 offers with two independent custody-backed accounts, persists a 0600 result file, and optionally opens, binds, and finalizes a Sepolia agreement.

The default signer backend is **Turnkey**. The runtime can use Turnkey's viem account adapter for both EIP-712 signatures and Sepolia contract transactions, so agent private keys are never placed in the process environment. The local private-key backend is opt-in and intended only for development tests.

The default is **dry-run**. Set `AGENT_BROADCAST=true` only after verifying the intent, addresses, balances, and recipient contract. Never expose these variables to Next.js or commit them.

Single-intent worker variables:

```text
SEPOLIA_RPC_URL=https://...
AGENT_INTENT_ID=0x...
AGENT_TREASURY_POLICY_SALT=0x...
AGENT_STRATEGY_POLICY_SALT=0x...

# Production custody backend (default)
AGENT_SIGNER_BACKEND=turnkey
TURNKEY_ORGANIZATION_ID=org_...
TURNKEY_API_PUBLIC_KEY=...
TURNKEY_API_PRIVATE_KEY=...
TURNKEY_TREASURY_SIGNER=0x...
TURNKEY_STRATEGY_SIGNER=0x...
```

`TURNKEY_TREASURY_SIGNER` and `TURNKEY_STRATEGY_SIGNER` are the two distinct Ethereum wallet-account addresses held by the Turnkey organization. Configure an API key policy that can sign only for those accounts and requires the intended approval quorum. Keep the API private key in the service's secret store, rotate it, and never commit it.

Optional: `AGENT_CAPITAL_USDC=100000`, `AGENT_BROADCAST=true`, `AGENT_SCHEDULE_SECONDS=300`, `AGENT_STATE_FILE=./state/agent-runtime.json`, and `TURNKEY_BASE_URL=https://api.turnkey.com`.

For local tests only:

```text
AGENT_SIGNER_BACKEND=local
AGENT_TREASURY_PRIVATE_KEY=0x...
AGENT_STRATEGY_PRIVATE_KEY=0x...
```

The Turnkey free tier is suitable for a small demo but is usage-limited. It still requires creating a Turnkey organization and API key; it does not require Chainlink deployment access. There is no claim here that custody or signing is unlimited at zero cost.

Operational sequence:

1. Create two Ethereum wallet accounts in the Turnkey organization and record their addresses.
2. Create a restricted API key and policy for the service; grant only the required signing actions.
3. Set the Turnkey variables above in the worker's secret environment.
4. Run once with `AGENT_BROADCAST` unset and inspect the persisted result.
5. Enable `AGENT_BROADCAST=true` only after funding the selected treasury wallet with testnet ETH and verifying the canonical addresses.
6. Use `AGENT_SCHEDULE_SECONDS` for unattended polling. The state file prevents replaying a completed intent.

## Dynamic orchestrator

For unattended processing of new intents, set these stable worker variables instead of `AGENT_INTENT_ID`:

```text
AGENT_ORCHESTRATOR=true
AGENT_INDEX_START_BLOCK=11600000
AGENT_INDEX_MAX_BLOCKS=2000
AGENT_ORCHESTRATOR_DB=./state/agent-orchestrator.sqlite
AGENT_STATE_DIR=./state/agent-runs
AGENT_SCHEDULE_SECONDS=300
```

The orchestrator reads finalized `IntentCreated` events from the canonical Sepolia `IntentRegistry`, inserts each `intentId` once, leases claimable jobs, and passes the on-chain capital into the existing runtime. It does not store policy thresholds or salts in SQLite. `AGENT_INTENT_ID` is not used in orchestrator mode. Run one polling cycle with `AGENT_ORCHESTRATOR_ONCE=true` before enabling the long-running scheduler.

Example:

```bash
set -a
source .env
set +a
AGENT_ORCHESTRATOR=true AGENT_ORCHESTRATOR_ONCE=true npm run run
```

The database is an operational queue, not the source of truth for agreement state. Before any future continuation, the worker must reconcile its job with finalized chain state. SQLite is appropriate for one worker; use a database with stronger multi-writer operational controls before running multiple workers.
