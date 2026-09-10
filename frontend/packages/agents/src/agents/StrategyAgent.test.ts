import { describe, it, expect } from "vitest";
import { StrategyAgent } from "./StrategyAgent.js";
import { toCanonicalOfferMessage, verifyOfferSignature } from "../signing/Eip712OfferSigner.js";
import {
  strategyConfig, treasurySigner, strategySigner, sampleOffer, DAY, DOMAIN, BINDING,
  OTHER_INTENT_ID, PRIVATE_MARKERS, serialize,
} from "../test/fixtures.js";

describe("StrategyAgent", () => {
  it.each([
    [60, 700, "ACCEPT"], [10, 1000, "COUNTER"], [29, 870, "ACCEPT"], [25, 890, "COUNTER"],
  ] as const)("evaluates %i days / %i bps as %s", (days, yieldBps, expected) => {
    const agent = new StrategyAgent(strategyConfig());
    expect(agent.evaluateCounterOffer(sampleOffer({ duration: days * DAY, yieldBps }))).toBe(expected);
  });

  it("rejects exhausted concessions and capital mismatch", () => {
    const agent = new StrategyAgent(strategyConfig({ concessionSchedule: [] }));
    expect(agent.evaluateCounterOffer(sampleOffer({ yieldBps: 1000 }))).toBe("REJECT");
    expect(agent.evaluateCounterOffer(sampleOffer({ capital: 1n }))).toBe("REJECT");
  });

  it("signs a counterparty-bound concession with seconds, expiry and configured nonce", async () => {
    const agent = new StrategyAgent(strategyConfig({ initialOfferNonce: 71n }));
    const offer = await agent.createCounterOffer("run-synthetic", 1);
    expect(offer).toMatchObject({ round: 2, proposerRole: "STRATEGY", proposer: BINDING.counterparty,
      intentId: BINDING.intentId, duration: 28 * DAY, yieldBps: 880, nonce: 71n });
    expect(offer.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(offer.expiresAt).toBeLessThan(Math.floor(Date.now() / 1000) + DAY + 1);
    expect(await verifyOfferSignature(offer, DOMAIN, BINDING.counterparty)).toBe(true);
    await expect(agent.createCounterOffer("run-synthetic", 2)).rejects.toThrow("concession");
  });

  it("accepts the identical seven fields and does not consume an offer nonce", async () => {
    const agent = new StrategyAgent(strategyConfig({ initialOfferNonce: 71n }));
    const offer = await treasurySigner.signOffer(sampleOffer({ nonce: 999n }));
    const acceptance = await agent.acceptOffer(offer);
    expect(toCanonicalOfferMessage(acceptance)).toEqual(toCanonicalOfferMessage(offer));
    expect(await verifyOfferSignature(acceptance, DOMAIN, BINDING.counterparty)).toBe(true);
    expect((await agent.createCounterOffer("run-synthetic", 1)).nonce).toBe(71n);
  });

  it.each([
    { intentId: OTHER_INTENT_ID }, { proposer: BINDING.principal }, { proposerRole: "STRATEGY" as const }, { expiresAt: 1 },
  ])("rejects unbound evaluation and acceptance %j", async (mutation) => {
    const agent = new StrategyAgent(strategyConfig());
    const offer = sampleOffer(mutation);
    expect(() => agent.evaluateCounterOffer(offer)).toThrow();
    await expect(agent.acceptOffer(await treasurySigner.signOffer(offer))).rejects.toThrow();
  });

  it("rejects tampered signatures and unacceptable direct acceptance", async () => {
    const agent = new StrategyAgent(strategyConfig());
    const signed = await treasurySigner.signOffer(sampleOffer());
    await expect(agent.acceptOffer({ ...signed, expiresAt: signed.expiresAt + 1 })).rejects.toThrow("signature");
    await expect(agent.acceptOffer(await strategySigner.signOffer(sampleOffer()))).rejects.toThrow("signature");
    await expect(agent.acceptOffer(await treasurySigner.signOffer(sampleOffer({ yieldBps: 99999 })))).rejects.toThrow("acceptable");
  });

  it("requires the counterparty identity to match its signer and configured binding", () => {
    expect(() => new StrategyAgent(strategyConfig({ signer: treasurySigner }))).toThrow("binding");
    expect(() => new StrategyAgent(strategyConfig({ identity: { name: "Synthetic", role: "PROPOSER", address: BINDING.counterparty } }))).toThrow("binding");
  });

  it("does not expose policy or salt, and snapshots caller-owned binding/policy", async () => {
    const config = strategyConfig();
    const agent = new StrategyAgent(config);
    config.binding.intentId = OTHER_INTENT_ID;
    config.privatePolicy.maxYieldBps = 0;
    expect((await agent.createCounterOffer("run-synthetic", 1)).intentId).toBe(BINDING.intentId);
    expect(agent.evaluateCounterOffer(sampleOffer({ duration: 60 * DAY, yieldBps: 700 }))).toBe("ACCEPT");
    for (const marker of PRIVATE_MARKERS) expect(serialize(agent)).not.toContain(marker);
  });
});
