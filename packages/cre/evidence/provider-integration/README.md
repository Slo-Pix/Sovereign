# Real provider ↔ CRE HTTP interoperability

This evidence connects the **unchanged real Bun/SQLite position-feed service** to the **actual CRE CLI HTTP capability**, running the existing [feed simulation](../../feed-simulation/main.ts) and [private position client](../../src/position.ts). It does not use the mock position provider in the earlier feed demo.

**Not a hardware TEE, real venue feed, live agreement, deployed workflow, chain write, receiver integration, or end-to-end on-chain lifecycle.** All credentials, policy, observations and agreement state are synthetic. Missing data or revoked access produces no report, not a public SAFE verdict.

## Run

From the repository root, with the existing Bun, CRE CLI and installed dependencies:

```sh
bun --no-env-file packages/cre/scripts/provider-demo.ts
```

Typecheck (no manifest change is needed):

```sh
bun --no-env-file packages/cre/node_modules/typescript/bin/tsc --noEmit -p packages/cre/scripts/tsconfig.json
```

The driver accepts no positional arguments. `CRE_BIN` optionally selects the CRE executable; otherwise it checks PATH, then `$HOME/.cre/bin/cre`. Never supply real credentials. Always disable env-file loading on the outermost Bun command, including when adding a package script. Child environments are allowlisted; existing repository env files, RPC credentials, proxy settings and private keys are not inherited.

## Recorded result

| Scenario | Reader GET | Authorized CRE reads | Reports |
| --- | --- | --- | --- |
| Explicit safe observation | 200 | 1 | 0 |
| Explicit later breach observation | 200 | 1 | 1 |
| Reader revoked; explicit later observation | 401 | 0 | 0 |

Per complete successful run: **3 CRE simulations, 1 generated report, 1 provision command, 1 revoke command, 4 server starts and 3 server restarts**. The breach decision must have `checkKind=2`, `result=true`, nonce `2`, the synthetic agreement ID and `delivery=report-only`. Both other results must have a null decision and zero reports.

The authorized-read counts are measured using the real service's durable read-quota row immediately before and after each CLI execution, accounting for a quota-window rollover. They are not counters from an HTTP mock. A revoked request cannot consume that quota; zero authorized reads does not claim zero attempted requests or provide an unauthorized-request packet count.

Artifacts:

- [summary.json](summary.json): exact outer command, report counts, HTTP assertions, actual host/observation/evaluation times, freshness, restarts, cleanup and source SHA-256 hashes.
- [safe.txt](safe.txt), [breach.txt](breach.txt), [revoked.txt](revoked.txt): privacy-scanned actual CLI transcripts.
- [validation.json](validation.json): additional typecheck, repeatability and injected-failure cleanup checks performed during implementation.

The JSON host timestamps are captured directly from the driver clock used by the Bun provider; the simulation's injected evaluation time equals the submitted observation timestamp. CLI-rendered log timestamps are retained verbatim, not used to manufacture or refresh observations.

## What the driver verifies

1. Generate two independent 256-bit CSPRNG tokens and a fresh synthetic policy salt. Write the operator configuration as a private 0600 file inside a 0700 temporary directory.
2. Run the actual provision CLI with `bun --no-env-file`, an explicit temporary SQLite path and the private config path. Verify the exact generic success output, then delete the credential file before starting the server. Tokens are never process arguments.
3. Reserve an OS-assigned ephemeral loopback port, release it immediately before spawning the actual server CLI, and use bounded health readiness checks. The service cannot accept port zero; the unavoidable release/bind handoff fails closed if the child cannot bind. There is no external bind or forwarding proxy.
4. In each scenario, assert reader PUT, writer GET, anonymous GET and anonymous PUT all return 401 with the generic error body and privacy headers. Only the distinct writer token can PUT (204); an immediate replay must return 409.
5. Submit exactly four observation fields. No policy, salt, threshold, SAFE/BREACHED flag or credential-binding object is sent in the position body. The three observations have explicitly different measurements and strictly increasing actual observation timestamps; elapsed duration is activation-relative and nondecreasing.
6. Run the existing CRE client with the real origin, agreement-bound **read token only**, synthetic policy commitment and existing synthetic ACTIVE agreement snapshot. The writer token never enters CRE. The config explicitly enforces report-only delivery, insecure loopback opt-in and a 30-second maximum age.
7. After safe and breach scenarios, stop and restart the server against the same DB. Before writing anything new, assert the old observation (including its original timestamp) is unchanged both over authenticated HTTP and through a read-only SQLite audit connection. Successful subsequent PUTs also demonstrate durable writer credentials.
8. Revoke the reader using the actual operator CLI while the server is running; assert immediate 401. Restart again and assert 401 still holds. The old observation remains unchanged. Submit a separately authored later observation using the still-valid writer, then require CRE to emit no report.
9. Check each observation remains unchanged after the CLI execution, and require host age at both CLI start and completion to be in 0–30 seconds. No retries, timers, GETs or restarts launder timestamps. The only timestamp wait is a bounded wait for the next real Unix second; it does not submit data. If compilation or execution exceeds freshness, the run fails rather than refreshing old data.

## CLI startup metadata is not a chain integration

CRE CLI requires an RPC entry even for this no-chain simulation binary. An empty `rpcs` list fails before compilation. To avoid using any remote RPC, the driver supplies a separate, explicitly synthetic loopback **chain-ID-only metadata stub** for the CLI startup probe.

That stub supports only `eth_chainId` and records method names, not request bodies. Any other method fails the integration. The recorded successful runs made exactly three `eth_chainId` requests, one per simulation. It cannot read agreement state or accept transactions. **The position HTTP endpoint is never mocked or routed through this stub.** The existing simulation supplies agreement state in memory as before.

The CLI may print its standard default-private-key and deployment-promotion notices. No key is supplied, no `--broadcast` flag is used, and this binary has no EVM writer. Those notices are not evidence of a transaction, deployment or hardware TEE.

## Isolation, output privacy and cleanup

The CLI compiles byte-identical temporary copies of the existing workflow/client sources with links to installed dependencies. Generated JS/WASM files stay in the private temporary tree, not the workspace. Only the new driver and this evidence directory are added; no existing source, workflow config or package manifest is edited by the driver.

All child stdout/stderr is captured, size-bounded and scanned for both tokens, their hashes, the fresh salt, policy field names and private observation field names before it can be displayed or saved. Scan failures discard the transcript. Scan-passed failure diagnostics can be displayed with the temporary path redacted; raw exception objects and assertion diffs are never printed. No token, operator config, synthetic secret env file or raw observation body is saved as evidence.

The provider runs in a child process, not as an imported in-process substitute. Child process groups are tracked, subprocess execution has a deadline, and cleanup handles success, failure, SIGINT and SIGTERM with TERM/KILL escalation. Listener reservations, the metadata listener, read-only SQLite handle, private configs, DB/WAL files and temporary build tree are removed/closed. SIGKILL or host failure cannot run application cleanup; OS/operator recovery remains outside the guarantee.

Evidence is published only after all three scenarios and cleanup succeed. A failed run leaves any earlier successful evidence unchanged; check the completion timestamp rather than mistaking old evidence for a new success.

During implementation, the full run passed twice. Injecting `CRE_BIN=/bin/false` and separately sending SIGTERM during actual CRE compilation each produced exit 1, removed the private temporary tree and left the previous successful evidence unchanged. No provider or compiler processes remained after validation.

## Boundary of the blocker fix

This closes the **local real-provider/CRE-client interoperability gap**: bearer-role separation, explicit authenticated writes, HTTP response compatibility, persistence, breach-only reporting and revocation are exercised together using the real implementations. It does not establish source truthfulness, deployed HTTPS/proxy hardening, TEE secrecy, real agreement identity/terms, receiver deployment, funded wallets or a live cross-chain lifecycle.