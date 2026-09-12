import { afterEach, describe, it, expect, vi } from "vitest";
import { TreasuryAgent } from "./TreasuryAgent";
import { toCanonicalOfferMessage, verifyOfferSignature } from "../signing/Eip712OfferSigner";
import {
  treasuryConfig, treasurySigner, strategySigner, sampleOffer, DAY, DOMAIN, BINDING,
  OTHER_INTENT_ID, PRIVATE_MARKERS, serialize, CAPITAL,
} from "../test/fixtures";

afterEach(() => vi.useRealTimers());
describe("TreasuryAgent", () => {
  it("generates deterministic intent-bound initial offers with Unix-second expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_789_000_000_123);
    const offer = await new TreasuryAgent(treasuryConfig()).createInitialOffer("run-synthetic");
    expect(offer).toEqual(await new TreasuryAgent(treasuryConfig()).createInitialOffer("run-synthetic"));
    expect(offer).toMatchObject({ intentId: BINDING.intentId, proposer: BINDING.counterparty,
      proposerRole: "TREASURY", capital: CAPITAL, duration: 30 * DAY, nonce: 1n, expiresAt: 1_789_000_000 + DAY });
    expect(await verifyOfferSignature(offer, DOMAIN, BINDING.principal)).toBe(true);
  });

  it.each([
    [30, 900, "ACCEPT"], [60, 700, "COUNTER"], [26, 880, "ACCEPT"], [28, 830, "COUNTER"],
  ] as const)("evaluates %i days / %i bps as %s", (days, yieldBps, expected) => {
    const agent = new TreasuryAgent(treasuryConfig());
    expect(agent.evaluateCounterOffer(sampleOffer({ proposerRole: "STRATEGY", round: 2, duration: days * DAY, yieldBps }))).toBe(expected);
  });

  it("rejects exhausted concessions and capital mismatch", () => {
    const agent = new TreasuryAgent(treasuryConfig({ concessionSchedule: [] }));
    expect(agent.evaluateCounterOffer(sampleOffer({ proposerRole: "STRATEGY", yieldBps: 700 }))).toBe("REJECT");
    expect(agent.evaluateCounterOffer(sampleOffer({ proposerRole: "STRATEGY", capital: 1n }))).toBe("REJECT");
  });

  it("keeps the configured nonce on a concession and never consumes a nonce for acceptance", async () => {
    const agent = new TreasuryAgent(treasuryConfig({ initialOfferNonce: 42n }));
    const offer = await strategySigner.signOffer(sampleOffer({ proposerRole: "STRATEGY", round: 2, nonce: 999n }));
    const acceptance = await agent.acceptOffer(offer);
    expect(toCanonicalOfferMessage(acceptance)).toEqual(toCanonicalOfferMessage(offer));
    expect(await verifyOfferSignature(acceptance, DOMAIN, BINDING.principal)).toBe(true);
    const counter = await agent.createCounterOffer("run-synthetic", 2);
    expect(counter).toMatchObject({ duration: 27 * DAY, yieldBps: 850, nonce: 42n });
    await expect(agent.createCounterOffer("run-synthetic", 3)).rejects.toThrow("concession");
  });

  it.each([
    { intentId: OTHER_INTENT_ID }, { proposer: BINDING.principal }, { proposerRole: "TREASURY" as const }, { expiresAt: 1 },
  ])("rejects unbound evaluation and acceptance %j", async (mutation) => {
    const agent = new TreasuryAgent(treasuryConfig());
    const offer = sampleOffer({ proposerRole: "STRATEGY", ...mutation });
    expect(() => agent.evaluateCounterOffer(offer)).toThrow();
    await expect(agent.acceptOffer(await strategySigner.signOffer(offer))).rejects.toThrow();
  });

  it("rejects tampered signatures and unacceptable direct acceptance", async () => {
    const agent = new TreasuryAgent(treasuryConfig());
    const signed = await strategySigner.signOffer(sampleOffer({ proposerRole: "STRATEGY" }));
    await expect(agent.acceptOffer({ ...signed, nonce: signed.nonce + 1n })).rejects.toThrow("signature");
    await expect(agent.acceptOffer(await treasurySigner.signOffer(sampleOffer({ proposerRole: "STRATEGY" })))).rejects.toThrow("signature");
    await expect(agent.acceptOffer(await strategySigner.signOffer(sampleOffer({ proposerRole: "STRATEGY", yieldBps: 1 })))).rejects.toThrow("acceptable");
  });

  it("requires the principal identity to match its signer and configured binding", () => {
    expect(() => new TreasuryAgent(treasuryConfig({ signer: strategySigner }))).toThrow("binding");
    expect(() => new TreasuryAgent(treasuryConfig({ binding: { ...BINDING, principal: BINDING.counterparty } }))).toThrow("binding");
  });

  it("does not expose policy or salt, and snapshots caller-owned binding/policy", async () => {
    const config = treasuryConfig();
    const agent = new TreasuryAgent(config);
    config.binding.intentId = OTHER_INTENT_ID;
    config.privatePolicy.minYieldBps = 99999;
    expect((await agent.createInitialOffer("run-synthetic")).intentId).toBe(BINDING.intentId);
    expect(agent.evaluateCounterOffer(sampleOffer({ proposerRole: "STRATEGY" }))).toBe("ACCEPT");
    for (const marker of PRIVATE_MARKERS) expect(serialize(agent)).not.toContain(marker);
  });
});
