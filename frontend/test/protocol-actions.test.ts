import { describe, expect, it } from "vitest";
import vectors from "../../packages/core/fixtures/vectors.json";
import {
  daysToSeconds,
  offerDigest,
  parseUsdc,
  percentToBps,
  policyCommitment,
  type AgreementTerms,
} from "../lib/protocol-actions";

describe("frontend protocol encodings", () => {
  it("matches the canonical policy fixture", () => {
    expect(policyCommitment({
      minYieldBps: BigInt(vectors.policy.minYieldBps),
      maxLossBps: BigInt(vectors.policy.maxLossBps),
      maxDuration: BigInt(vectors.policy.maxDuration),
      salt: vectors.policy.salt as `0x${string}`,
    })).toBe(vectors.policyCommitment);
  });

  it("matches the canonical EIP-712 offer fixture", () => {
    const terms = Object.fromEntries(
      Object.entries(vectors.terms).map(([key, value]) =>
        [key, ["capital", "duration", "yieldBps", "expiresAt", "nonce"].includes(key) ? BigInt(value) : value],
      ),
    ) as AgreementTerms;
    expect(offerDigest(terms, vectors.offer.verifyingContract as `0x${string}`)).toBe(vectors.offer.digest);
  });

  it("uses USDC base units, seconds, and basis points", () => {
    expect(parseUsdc("100000")).toBe(100_000_000_000n);
    expect(daysToSeconds("21")).toBe(1_814_400n);
    expect(percentToBps("8.80")).toBe(880n);
  });
});
