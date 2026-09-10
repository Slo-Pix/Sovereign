# Authenticated simulated-position provider

Production-shaped **local demo infrastructure**, not a real venue feed. This Bun service stores explicitly submitted simulated positions. It does not generate observations, refresh their timestamps on reads, evaluate policy, declare SAFE/BREACHED, contact a blockchain, sign transactions, or write on-chain. Authentication and persistence do not establish that a writer's data is truthful.

All implementation and tests live in this package. Runtime dependencies: Bun 1.3.13 or later on Linux with `bun:sqlite`; no third-party runtime packages. Development versions are pinned in [package.json](package.json). No HTTP administration interface exists.

## Exact operator interface

Run from the repository root. Always pass `--no-env-file` to the **outermost** Bun invocation: this service neither needs nor intentionally reads existing repository secrets. Plain `bun run` can load env files before a package script starts. Supply only the documented environment variables through your process supervisor or test harness.

```text
bun --no-env-file packages/position-feed/src/operator.ts provision [--db ABSOLUTE_DB_PATH] [--config ABSOLUTE_CONFIG_PATH]
bun --no-env-file packages/position-feed/src/operator.ts rotate    [--db ABSOLUTE_DB_PATH] [--config ABSOLUTE_CONFIG_PATH]
bun --no-env-file packages/position-feed/src/operator.ts revoke    [--db ABSOLUTE_DB_PATH] --agreement LOWERCASE_BYTES32 --role read|write
bun --no-env-file packages/position-feed/src/server.ts
```

The server accepts no command-line arguments. The operator accepts only the flags above, each at most once. Tokens are **never** command-line arguments. Do not place tokens in shell history, chat, public files, test output, URLs, logs, or process arguments.

| Environment variable | Meaning / default |
| --- | --- |
| `POSITION_FEED_DB` | SQLite file; default is this package's `state/position.sqlite`, independent of current working directory. `--db` overrides it for operator commands. Use an absolute path shared by all processes. |
| `POSITION_FEED_CREDENTIAL_CONFIG` | Explicit path to the private credential JSON file for provision/rotate. `--config` overrides it. No default file is searched. The server does not read this file. |
| `POSITION_FEED_HOST` | Only `127.0.0.1` is accepted; this is also the default. No bypass flag. |
| `POSITION_FEED_PORT` | Integer 1–65535, default `3001`. |

[.env.example](.env.example) has blank values, not credentials. It is a reference only; automatic env-file loading is disabled in the commands above.

### Private credential configuration

The explicitly named config must be a regular, non-symlink file owned by the process user, mode **0600**, with no hard links, at most 64 KiB. Protect its containing directory with mode 0700. Store it under this package's ignored `config/` directory or another privately managed location; never commit it. No usable credential example is shipped.

The JSON shape is exactly:

```json
{
  "credentials": [
    {
      "agreementId": "LOWERCASE_0x_PLUS_64_HEX_DIGITS",
      "role": "read",
      "token": "REPLACE_WITH_AN_INDEPENDENT_CSPRNG_TOKEN",
      "capacity": 60,
      "windowSeconds": 60
    },
    {
      "agreementId": "LOWERCASE_0x_PLUS_64_HEX_DIGITS",
      "role": "write",
      "token": "REPLACE_WITH_A_DIFFERENT_CSPRNG_TOKEN",
      "capacity": 30,
      "windowSeconds": 60
    }
  ]
}
```

These placeholders are not deployable. Generate each token privately from **at least 32 random bytes** (256 bits), e.g. base64url encoding from a CSPRNG, and write it directly to the protected file without printing it. The accepted client-compatible syntax is 32–4096 characters matching `[A-Za-z0-9._~+/-]+={0,2}`, with no whitespace. Length/character validation cannot prove entropy. SHA-256 hashes are sufficient for high-entropy tokens; this is not password authentication, and human-chosen passwords are unsuitable. No salt is required for this token design.

There must be 1–100 entries. Unknown fields, duplicate agreement/role pairs, duplicate tokens, non-lowercase IDs, or invalid values reject the entire file. `capacity` is an integer 1–10000; `windowSeconds` is an integer 1–86400. The sample quotas are illustrative, not defaults or a recommended protection cadence. Choose both capacities explicitly to allow scheduled reads, overlapping executions and authorized writers.

### Provision, rotation and revocation semantics

* `provision`: creates credentials only in empty/inactive agreement-role slots. An active slot is a conflict; it is never silently overwritten.
* `rotate`: replaces active slots listed in the file, atomically. A missing active slot is a conflict. A file containing only a `read` entry rotates only that read key; similarly, a `write` entry rotates only the writer key. Old tokens stop working immediately after commit; there is no overlap/grace period.
* `revoke`: deactivates only the specified agreement and role, idempotently, without requiring the config file. Revoke both roles with two explicit commands if needed.
* Tokens are globally unique across all agreements and both roles. A token is never reusable, even after rotation/revocation. Inactive hashes are retained as tombstones. Following revocation, use `provision` with a new token to restore that role.
* Validate the whole config before opening/creating the database. Credential changes are one `BEGIN IMMEDIATE` transaction; any conflict rolls back all entries. Only hashes enter SQLite, including WAL. Errors never print config contents, token hashes, paths or parser diagnostics.
* Success: exit **0**, stdout exactly `Operation completed\n`, empty stderr. Failure: exit **1**, stderr exactly `Operation failed\n`, empty stdout. There is deliberately no list/export/status operation.
* CLI operations can run in a separate local process while the server runs. “Offline” means direct SQLite operator access, **not** an HTTP admin call. In-flight writes recheck authorization in their final transaction. A response already committed before a revocation cannot be recalled.
* Rotation creates a new token's quota budget but preserves observations and replay history. Restarting does not reset credentials, quotas or observations. Rotation is privileged; do not rotate to evade capacity planning.

## HTTP contract

Only `GET /health`, and `GET`/`PUT /agreements/:agreementId/position`, exist. The agreement segment is exactly lowercase `0x` followed by 64 hexadecimal digits. Queries, trailing slashes, alternate casing and methods are rejected. There is no static-file serving, auth config enumeration, HTTP admin, CORS, redirect, response cache or application access log.

`GET /health` returns exactly `{"status":"up"}`. This unauthenticated liveness endpoint says **nothing** about position existence, freshness, database readiness, policy evaluation, or safety.

### Writer: PUT

Headers: `Authorization: Bearer WRITER_TOKEN` and `Content-Type: application/json` (optional `charset=utf-8`). Compressed/encoded bodies are rejected. The read credential cannot write.

The JSON object must contain exactly these four fields:

| Field | Validation |
| --- | --- |
| `agreementId` | Same lowercase ID as the route and writer's credential binding. |
| `currentLossBps` | Nonnegative JSON safe integer, no policy-dependent upper bound. |
| `elapsedSeconds` | Nonnegative JSON safe integer, meaningful activation-relative duration supplied by the writer. |
| `timestamp` | Nonnegative JSON safe integer, Unix seconds of the actual submitted observation. |

All integers must be at most `Number.MAX_SAFE_INTEGER`. Fractional values, strings, booleans, nulls, missing/extra fields and mismatched IDs are rejected. The service does not receive policy, thresholds or venue credentials.

Freshness is inclusive: **0–30 seconds old**, never future-dated, measured against the server clock. Freshness is checked both after parsing and inside the write transaction. Against the persisted previous observation, `timestamp` must **strictly increase**, and `elapsedSeconds` must **not decrease**. Repeating a timestamp, even with changed data, is a replay conflict. Multiple writes within one Unix second cannot both succeed. Loss may increase or decrease; equal elapsed time with a newer timestamp is allowed. Accurate clocks and truthful observation times are writer/operator responsibilities.

The application reads at most **16 KiB** of accepted body data via a bounded stream, checking both declared and actual size. An oversized chunk is rejected immediately, not copied into an unbounded accumulator. Uploads have a two-second total read deadline and cancel on timeout, overflow, abort or early rejection. Bun's automatic body cap is disabled because its transport-generated 413 omits the application's privacy headers; the handler enforces the limit, with a five-second connection idle timeout. This is **not** an edge/global DoS defense.

Success: **204**, empty body. The server never invents or automatically renews observations.

### Reader: GET

Header: `Authorization: Bearer READ_TOKEN`. The writer credential cannot read.

Success: **200**, `Content-Type: application/json`, and exactly `{agreementId,currentLossBps,elapsedSeconds,timestamp}`. The timestamp is the persisted writer-supplied timestamp, **not the read time**. Missing, future or more-than-30-second-old observations fail closed with 503. No fresh timestamp is synthesized to launder stale state.

All application responses, including health and errors, set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. They never set `Location`, cookies, CORS, ETag or Last-Modified. HTTP parsing/connection errors occurring before Bun dispatch are outside this application response contract and must be handled by the reverse proxy.

### Generic errors

Every application error body is exactly `{"error":"Request rejected"}`; no request content, IDs, auth details, policy, timestamps or internal errors are included.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON, invalid observation, abort, stale/future write. |
| 401 | Missing/malformed/wrong/revoked token, wrong role, or unknown agreement. Identical body/headers for these cases. |
| 404 | Unknown route, unsupported method or query string. |
| 408 | Body read deadline exceeded. |
| 409 | Non-monotonic/replayed authenticated write. |
| 413 | Body exceeds 16 KiB. |
| 415 | Unsupported content type/encoding. |
| 429 | Authenticated role's durable quota exhausted. No quota metadata is disclosed. |
| 503 | No usable observation or generic internal/unavailable error. |

Authentication selects the public agreement-role slot and compares 32-byte SHA-256 digests using native `timingSafeEqual`; unknown slots use a dummy digest comparison. This is constant-time **hash comparison**, not a claim that SQLite queries or the complete network request have identical timing. Error statuses still disclose limited operational categories to authorized callers.

## Durability, quotas and deployment boundary

* Linux state directory: mode **0700**, owned by the service user, no symlinked path components. Newly created directories use 0700. An existing insecure directory is rejected rather than chmodding an unrelated directory. Use a dedicated service account and a dedicated state directory.
* SQLite database, WAL and SHM: mode **0600**, regular, owned files, no symlinks/hard links. Process umask is set to 0077 **before** opening SQLite. WAL mode, `synchronous=FULL`, five-second busy timeout, and immediate transactions provide durable same-host coordination. Do not import the store into a process where changing umask is inappropriate.
* Authentication, quota consumption, latest-observation comparison and update execute in one immediate transaction. Concurrent processes share the same local file and cannot overdraw a bucket or both accept a replay. Busy/IO errors fail closed. Multiple hosts with independent copies, network filesystems, root compromise and hostile processes running under the same UID are not supported security boundaries.
* Fixed quota windows are keyed by token hash, agreement, method/route and the stored window start. One counter row per credential/route is reused instead of accumulating every time window. Read and write capacities are independent. Backward clock movement cannot reset a quota window. Fixed windows permit bursts around boundaries; size edge limits accordingly.
* Unauthorized traffic never consumes a legitimate credential's quota. Every authenticated read consumes a unit, including missing/stale observations. A syntactically valid authenticated write consumes a unit once it enters the final transaction, including replay/freshness conflicts; malformed bodies rejected before that transaction do not. Invalid/slow uploads still consume resources and require external admission controls.
* **Remote TLS is mandatory.** Bind only 127.0.0.1 behind a same-host HTTPS reverse proxy with a trusted certificate and a canonical DNS origin. The service cannot verify how its local socket is exposed; preventing plaintext remote forwarding, insecure tunnels and public loopback proxies is an operator duty. There is no “secured deployment” override to bind externally.
* Configure edge **IP/global rate limits, connection/concurrency limits, header limits, request-body limits, slow-client timeouts, and restricted writer network access**. Bound proxy buffering, disable caching and redirects, and preserve JSON/no-store behavior on proxy-generated errors. Never log authorization headers, request/response bodies or private URLs at the proxy, tracing, metrics or process-supervisor layer. Do not add public safety dashboards from this data.
* The service intentionally has no access/error detail logs. Startup failure emits only `Position feed startup failed` and exits 1. A running server emits no normal stdout/stderr. SIGTERM/SIGINT stop the listener and close SQLite. Arrange private availability monitoring and outage response externally.
* Back up SQLite using a consistent SQLite-aware snapshot including WAL state; protect backups like the live database. Restoring old backups can resurrect revoked credentials and roll back replay/quota state. Stop admission, reconcile observations, and replace credentials before restoring service. Do not delete quota/tombstone rows to perform a routine rotation.
* Filesystem permissions do not provide encryption at rest. The provider and authorized writer can read/manipulate plaintext observations; root and same-UID processes remain trusted. This demo makes no claim of a TEE, source attestation, real venue integration or guaranteed policy secrecy.

## CRE / integration harness handoff

The GET contract matches [the CRE private position client](../cre/src/position.ts). A harness should create a private temporary config with two independently generated tokens, invoke `provision`, start the server with an explicit temp DB and port, explicitly PUT a simulated observation, then invoke the existing CRE client using **only the read token**. Do not reuse a policy secret as either credential.

The CRE secret is separate from the operator file and is exactly `{origin,agreementId,token}`. Its `token` is the read token, `agreementId` matches the provisioned ID, and `origin` matches `positionOrigin` exactly. The server receives the bearer token only, not this binding JSON. The writer token must never enter CRE or public workflow configuration.

For synthetic local execution only: `origin` is `http://127.0.0.1:PORT`, `allowInsecurePositionLoopback` is true, and delivery is `report-only`. Remote execution must use the canonical HTTPS DNS origin without a path or trailing slash. Configure `maxPositionAgeSeconds` at 30 or lower if the consumer needs a stricter limit. No other package's workflow/config is changed here.

Missing/stale data, 401, 429, timeout or outage means **no usable position**, never SAFE. Keep demo observations explicit; do not run a timer that merely changes timestamps on old data. The package's own tests verify the HTTP shape with synthetic local data. A separate [CRE/provider integration driver](../cre/evidence/provider-integration/README.md) now verifies this actual service with the CRE CLI, including restart and revocation. Neither suite establishes deployed hardware-TEE execution.

## Validation

From the repository root, using only the existing installed Bun and TypeScript tools:

```sh
bun --no-env-file node_modules/.bun/typescript@5.9.3/node_modules/typescript/bin/tsc --project packages/position-feed/tsconfig.json --typeRoots packages/cre/node_modules/@types
bun --no-env-file test packages/position-feed/test
```

With the pinned dev dependencies available within this package, the equivalent package scripts are:

```sh
bun --no-env-file run --cwd packages/position-feed typecheck
bun --no-env-file run --cwd packages/position-feed test
```

No root install, manifest or lockfile update is needed for the existing-tool validation. Tests generate synthetic tokens, use private temporary SQLite/config files, exercise separate Bun processes, and clean up their files/listeners. They never load existing repository secrets or write on-chain. Coverage includes authentication separation, revoke/rotation, restart durability, quota/replay races, freshness, body size/deadline/abort, generic response headers, and real loopback HTTP.