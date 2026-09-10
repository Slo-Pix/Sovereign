import vectors from "../fixtures/vectors.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { hashPolicy, hashTerms, offerDigest } from "../src/index.js";

describe("canonical Sovereign encoding", () => {
  it("matches the frozen policy vector", () => {
    expect(
      hashPolicy({
        minYieldBps: BigInt(vectors.policy.minYieldBps),
        maxLossBps: BigInt(vectors.policy.maxLossBps),
        maxDuration: BigInt(vectors.policy.maxDuration),
        salt: vectors.policy.salt as `0x${string}`
      })
    ).toBe(vectors.policyCommitment);
  });

  it("matches the frozen terms vector", () => {
    expect(
      hashTerms({
        intentId: vectors.terms.intentId as `0x${string}`,
        principal: vectors.terms.principal as `0x${string}`,
        counterparty: vectors.terms.counterparty as `0x${string}`,
        capital: BigInt(vectors.terms.capital),
        duration: BigInt(vectors.terms.duration),
        yieldBps: BigInt(vectors.terms.yieldBps),
        expiresAt: BigInt(vectors.terms.expiresAt),
        nonce: BigInt(vectors.terms.nonce)
      })
    ).toBe(vectors.termsHash);
  });

  it("produces a deterministic Sepolia EIP-712 offer digest", () => {
    expect(
      offerDigest(
        {
          intentId: vectors.terms.intentId as `0x${string}`,
          principal: vectors.terms.principal as `0x${string}`,
          counterparty: vectors.terms.counterparty as `0x${string}`,
          capital: BigInt(vectors.terms.capital),
          duration: BigInt(vectors.terms.duration),
          yieldBps: BigInt(vectors.terms.yieldBps),
          expiresAt: BigInt(vectors.terms.expiresAt),
          nonce: BigInt(vectors.terms.nonce)
        },
        "0x3333333333333333333333333333333333333333"
      )
    ).toBe(vectors.offer.digest);
  });
});
