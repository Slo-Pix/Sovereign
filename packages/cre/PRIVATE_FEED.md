# Member B private position client

Implemented 2026-09-10. This document defines the feed-client configuration and privacy controls; see [honest limitations](README.md#honest-limitations-private-inputs-observable-enforcement). The compatible [position service](../position-feed/README.md) now implements authentication, durable quotas and observations. Its HTTPS deployment, credential provisioning and the receiver's public deployment remain operator requirements.

## Implemented behavior

- The monitoring handler verifies agreement/terms/policy binding before reading private position data.
- [The client](src/position.ts) retrieves a separate credential using `TeeRuntime.getSecret`, and calls the regular CRE HTTP client with the **TEE runtime**, not DON or node mode.
- Credential contents bind the bearer token to an exact approved origin and agreement. A public config-only origin/agreement substitution results in no HTTP request.
- The URL is constructed as `ORIGIN/agreements/LOWERCASE_AGREEMENT_ID/position`. No arbitrary path, query, credentials-in-URL or public-trigger position is accepted.
- HTTPS is required by default. Origins use lowercase ASCII DNS names with optional ports 1–65535, no trailing slash. Internationalized names must use an approved ASCII representation. IP literals and ambiguous numeric hosts are deliberately unsupported outside the explicit loopback test mode.
- HTTP GET uses a five-second timeout, `Accept: application/json`, `Authorization: Bearer TOKEN`, and `Cache-Control: no-store`. SDK cache reads and stores are disabled using the installed SDK fields `cacheSettings: {store:false,maxAge:'0s'}`.
- No application-level retry loop is added. Credential errors, HTTP failures, redirects, malformed/oversized bodies, non-JSON/ambiguous content types, wrong agreement IDs and stale/future observations return no usable position. They produce no SAFE or BREACHED report.
- SAFE remains silent. Only actionable breach decisions reach publication; no private data or detailed feed-error category is logged or returned publicly.

These controls bind a credential to a destination; they do not independently verify the provider's observations. An authorized malicious provider can manipulate inputs to cause a wrongful unwind or prevent a needed one. DNS/HTTPS infrastructure and the provider remain trust dependencies. Nonce protection does not make false source data truthful.

## Configuration migration

The old public `positionUrl` field is removed and rejected by the strict schema. Update existing local configurations deliberately rather than retaining an unauthenticated fallback.

| Field | Required value |
| --- | --- |
| `positionOrigin` | Approved HTTPS origin, for example `https://positions.example.com`; no trailing slash/path/query |
| `positionAuthSecretId` | Credential secret ID, default example name `SOVEREIGN_POSITION_AUTH`; must differ from `policySecretId` |
| `agreementId` | Actual agreement whose position may be read |
| `maxPositionAgeSeconds` | Existing freshness allowance, 1–300 seconds; example defaults to 30 |
| `allowInsecurePositionLoopback` | Defaults to false. True allows only `http://127.0.0.1:PORT` and is rejected with Sepolia delivery; synthetic local tests only |

See [the public example configuration](sovereign/config.example.json). It deliberately contains unusable identifiers and an invalid example host. Do not treat it as production-ready configuration.

### Secret format

The value of `SOVEREIGN_POSITION_AUTH` is a JSON object containing **exactly**:

| Secret field | Meaning |
| --- | --- |
| `origin` | Exact approved origin matching public `positionOrigin`, including any explicit port |
| `agreementId` | Authorized bytes32 agreement ID; case-insensitive hex comparison |
| `token` | The raw bearer token, without the `Bearer ` prefix |

The token must be 32–4096 characters from the supported bearer-token character set with optional trailing base64 padding and no whitespace. Provision a CSPRNG-generated token with at least 256 bits of entropy; length validation is **not** an entropy guarantee. A 32-byte random base64url token fits this format.

[The simulation secret mapping](sovereign/secrets.yaml) maps that secret ID to `SOVEREIGN_POSITION_AUTH_JSON`. Both policy and position credentials are loaded inside the confidential handler. Supply values locally without exposing them in chat, shell history, public configuration or Git. Use only synthetic policy/credential values with local simulation. Approved confidential deployment must use the sponsor's confidential secret provisioning path.

The binding JSON is read only by Member B's client. Member C receives only the token in the authorization header; C does not need to implement a new signed credential format. Member C must independently bind that token to the agreement in its authorization store.

Changing the source origin or agreement requires deliberately provisioning a matching credential binding. Editing public configuration alone must not repurpose an existing credential. Authorization to change secret IDs, secret values, source configuration and feed writers remains a privileged operational capability.

## Exact interface for Member C

1. Accept only authenticated `GET /agreements/:agreementId/position` reads, with `Authorization: Bearer TOKEN`.
2. The path contains a lowercase bytes32 hex ID. Deny missing, wrong or revoked tokens and cross-agreement reads, and keep read permissions separate from update permissions.
3. Return status 200 with `Content-Type: application/json` or `application/json; charset=utf-8`, and a JSON object containing exactly `{agreementId,currentLossBps,elapsedSeconds,timestamp}`. Extra fields are rejected to avoid unexpected private payloads entering evaluation.
4. Numeric fields must be nonnegative, safe integers. Timestamp is Unix seconds; elapsed time counts from activation. An observation older than the configured allowance or ahead of the workflow clock is rejected. Accurate timestamping and provider clock synchronization are required.
5. Serve the final HTTPS endpoint directly, without redirects, including trailing-slash canonicalization or login redirects. Return an authorization error status rather than an HTML login page.
6. Set `Cache-Control: no-store` in the response and prevent public caches, logs, traces, dashboards or websocket routes from mirroring private positions/authorization headers. The client request alone cannot enforce server-side privacy.
7. Return public integration details and provision the token privately. Do not send a real token through chat or a repository file.

If C already uses another authentication scheme, agree the interface before changing the client. Do not silently fall back to an unauthenticated request.

## Redirect safety: what was verified

The [official HTTP client reference](https://docs.chain.link/cre/reference/sdk/http-client-ts#associated-types) states that redirects are unsupported and requests to redirecting URLs fail. SDK 1.18.0 provides no per-request redirect option; no invented `redirect` flag is used.

The client independently rejects non-200 responses and any returned `Location` header. This is defense in depth, not a claim that inspecting the final response can undo an already-followed redirect.

[The CLI probe](scripts/feed-demo.ts) runs two local HTTP listeners using ephemeral synthetic credentials. The approved listener can return a same-origin or cross-origin HTTP 302. Assertions require exactly one authorized request to the approved endpoint, **zero requests to either redirect target**, zero credential delivery to a target, and no report. These checks exercise the actual CRE CLI/HTTP capability rather than a mocked `fetch` implementation. Other redirect status codes are covered in unit tests.

This verifies the tested local simulator behavior for CLI v1.33.0 / SDK 1.18.0. It is not independent verification of a deployed hardware enclave or future runtime versions. Recheck the capability's guarantees and staging behavior on upgrade/deployment; do not implement application redirect following.

## Abuse limits and outage coordination

The current interface is cron-only, with no public evaluation-request endpoint. Each admitted monitoring execution performs at most one application-level position request. This bounds per-execution fan-out, not total requests across overlapping executions or multiple workflow deployments. A five-second timeout can exceed the example three-second cadence; quotas must account for overlap.

No fake in-memory rate limiter is added: CRE executions are stateless. Durable quotas belong in an agreed operator/service authorization layer, keyed by credential/agreement and shared across service replicas. Member C must restrict feed writes and any request-triggered interfaces. Reserve capacity for scheduled protection and delivery retries so external traffic cannot exhaust their budget. Actual quota values need agreement against sponsor limits and acceptable protection latency; they are not silently guessed here.

On 429, timeout or outage, the client withholds the decision and does not retry within that execution. The next authorized scheduled execution may try again. This avoids inventing safety but may leave capital exposed while data is unavailable. Operators need restricted availability alerts and an explicit outage response. No public error stream, SAFE heartbeat or claim that `NO_DECISION` proves safety is introduced.

## Validation and evidence

| Command from repository root | Purpose |
| --- | --- |
| `bun run --cwd packages/cre test` | Domain, handler, authenticated client and SDK adapter regression tests |
| `bun run --cwd packages/cre typecheck` | Strict workflow and separate host-script checks |
| `bun run --cwd packages/cre build` | Compile the real-chain workflow to WASM |
| `bun run --cwd packages/cre demo` | Seven synthetic decision scenarios through CRE CLI |
| `bun run --cwd packages/cre demo:feed` | Nine scenarios through actual CRE HTTP and an owned local authenticated fixture |

The feed probe covers SAFE, actionable breach, exact boundary, unauthorized response, stale observation, wrong agreement, malformed response, same-origin redirect and cross-origin redirect. It first verifies anonymous access to the fixture is denied, creates temporary files with restrictive permissions, scans transcripts for the synthetic token/salt/private field names before writing evidence, closes listeners and removes temporary secrets afterward.

Evidence is saved under the package's evidence directory and labeled **actual CRE HTTP with synthetic local provider/state/clock—not hardware TEE or chain-write evidence**. The local provider is a test fixture, not Member C's implemented service. Server counters demonstrate request behavior; they are not production private telemetry.

## Still pending, not hidden by this implementation

- HTTPS deployment and actual token provisioning for the implemented position service; proxy admission controls, restricted writer access and operational monitoring remain required. Its durable per-role quotas do not provide global edge DoS protection.
- Member A's authenticated receiver deployment and actionable-only contract enforcement. The existing receiver-configured write code is retained; no receiver address or ABI is invented.
- Final agreement configuration, funded testnet accounts, Arc transport/reconciliation and live receipt evidence.
- Approved DON deployment and confidential-beta enrollment before any claim of hardware-protected processing of real sensitive data.
- Timing/absence/public-position and repeated-policy inference remains possible. Read [honest limitations](README.md#honest-limitations-private-inputs-observable-enforcement).