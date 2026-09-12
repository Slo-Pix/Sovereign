# Authenticated private-feed verification

Verified 2026-09-10 with CRE CLI v1.33.0, SDK 1.18.0 and Bun 1.3.13.

**These are real CRE CLI/HTTP calls to owned local synthetic fixtures. They are not Member C service tests, hardware-TEE attestation, HTTPS deployment tests or chain-write evidence.** The agreement state and evaluation clock are synthetic. The loopback exception is enabled only for this report-only fixture.

| Scenario | Report count | Authenticated source requests | Redirect-target requests |
| --- | --- | --- | --- |
| [SAFE](safe.txt) | 0 | 1 | 0 |
| [Actionable breach](breach.txt) | 1 | 1 | 0 |
| [Exact boundary](boundary.txt) | 0 | 1 | 0 |
| [Unauthorized response](unauthorized.txt) | 0 | 1 | 0 |
| [Stale observation](stale.txt) | 0 | 1 | 0 |
| [Wrong agreement](wrong-agreement.txt) | 0 | 1 | 0 |
| [Malformed response](malformed.txt) | 0 | 1 | 0 |
| [Same-origin redirect](redirect-same-origin.txt) | 0 | 1 | 0 |
| [Cross-origin redirect](redirect-cross-origin.txt) | 0 | 1 | 0 |

The unauthorized scenario sends a valid fixture credential and the fixture deliberately responds 401, modeling revocation/server rejection. Separately, before scenarios begin, the driver confirms anonymous fixture requests receive 401. Missing/malformed credentials are covered by unit tests, which assert no HTTP request is sent.

The actual CLI redirect probes exercise HTTP 302; unit tests additionally reject 301/303/307/308 responses. Neither target received the synthetic credential. Credential/salt values are randomly generated, never written into transcripts, and removed with temporary files after execution. Output is scanned before evidence is saved. Server counters are host-side test observations, not production telemetry.

Full validation also passed: **39 unit/SDK tests, 298 assertions**, strict TypeScript checks, live-workflow WASM compilation without warnings, and all seven existing decision simulations.

Reproduce using `bun run --cwd packages/cre demo:feed` from the repository root. The command has no broadcast flag and the probe binary has no EVM writer. See [client configuration and limitations](../../README.md#private-position-feed).