import { afterEach, describe, it, expect, vi } from "vitest";
import { verifyTypedData } from "viem";
import { OFFER_DOMAIN, OFFER_TYPES, offerFromTerms, offerDigest, hashTerms } from "../../../../../packages/core/src/index";
import { NegotiationEngine } from "./NegotiationEngine";
import { TreasuryAgent } from "../agents/TreasuryAgent";
import { StrategyAgent } from "../agents/StrategyAgent";
import { Eip712OfferSigner, hashOfferTypedData, toRegistryTerms } from "../signing/Eip712OfferSigner";
import type { Offer, ProtocolEvent } from "../domain/types";
import {
  treasuryConfig, strategyConfig, treasurySigner, strategySigner, sampleOffer,
  DAY, CAPITAL, DOMAIN, BINDING, KEY_B, OTHER_INTENT_ID, PRIVATE_MARKERS, serialize, SALT_A,
} from "../test/fixtures";

function makeEngine(maxRounds = 20) {
  const treasury = new TreasuryAgent(treasuryConfig({ initialOfferNonce: 41n }));
  const strategy = new StrategyAgent(strategyConfig({ initialOfferNonce: 71n }));
  const engine = new NegotiationEngine({ runId: "run-synthetic", treasuryAgent: treasury, strategyAgent: strategy, maxRounds });
  return { treasury, strategy, engine };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("NegotiationEngine", () => {
  it.each(["TREASURY", "STRATEGY"] as const)("preserves full registry terms when %s authored the accepted offer", async (author) => {
    const { engine, treasury } = makeEngine();
    if (author === "STRATEGY") vi.spyOn(treasury, "evaluateCounterOffer").mockReturnValue("ACCEPT");
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    const run = await engine.startNegotiation();
    expect(run.status).toBe("CONVERGED");
    expect(run).toMatchObject(BINDING);
    const final = run.finalTerms!;
    const agreed = run.rounds.at(-2)!.offer!;
    const acceptance = run.rounds.at(-1)!.offer!;
    expect(agreed.proposerRole).toBe(author);
    expect(final).toMatchObject({
      ...BINDING, proposer: BINDING.counterparty, capital: CAPITAL,
      duration: author === "TREASURY" ? 27 * DAY : 28 * DAY,
      yieldBps: author === "TREASURY" ? 850 : 880,
      nonce: author === "TREASURY" ? 42n : 71n,
      expiresAt: agreed.expiresAt,
    });
    const terms = toRegistryTerms(final, final);
    expect(Object.keys(terms)).toHaveLength(8);
    expect(hashTerms(terms)).toBe(hashTerms(toRegistryTerms(agreed, BINDING)));
    expect(hashOfferTypedData(final, DOMAIN)).toBe(offerDigest(terms, DOMAIN.verifyingContract));
    expect(hashOfferTypedData(acceptance, DOMAIN)).toBe(hashOfferTypedData(agreed, DOMAIN));
    for (const [address, signature] of [
      [BINDING.principal, final.treasurySignature], [BINDING.counterparty, final.strategySignature],
    ] as const) {
      expect(await verifyTypedData({
        address, signature, domain: { ...OFFER_DOMAIN, ...DOMAIN }, types: OFFER_TYPES,
        primaryType: "Offer", message: offerFromTerms(terms),
      })).toBe(true);
    }
    expect(events.at(-1)).toMatchObject({ type: "NEGOTIATION_COMPLETED", payload: final });
  });

  it("is deterministic across 100 synthetic runs including full terms and signatures", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_789_000_000_123);
    const first = await makeEngine().engine.startNegotiation();
    for (let i = 1; i < 100; i++) expect(await makeEngine().engine.startNegotiation()).toEqual(first);
  }, 30_000);

  it("records all rounds, acceptance signatures and contiguous ordered events", async () => {
    const { engine } = makeEngine();
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    const run = await engine.startNegotiation();
    expect(run.rounds.map(r => [r.round, r.actor, r.action])).toEqual([
      [1, "TREASURY", "OFFER"], [2, "STRATEGY", "COUNTER_OFFER"],
      [3, "TREASURY", "COUNTER_OFFER"], [4, "STRATEGY", "ACCEPT"],
    ]);
    expect(events[0].type).toBe("NEGOTIATION_STARTED");
    expect(events.at(-1)!.type).toBe("NEGOTIATION_COMPLETED");
    expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1));
    await expect(engine.startNegotiation()).rejects.toThrow("already started");
  });

  it("fails on incompatible policies without emitting convergence", async () => {
    const treasury = new TreasuryAgent(treasuryConfig({ targetTerms: { duration: 10 * DAY, yieldBps: 1000 }, concessionSchedule: [] }));
    const strategy = new StrategyAgent(strategyConfig({ concessionSchedule: [] }));
    const engine = new NegotiationEngine({ runId: "run-synthetic", treasuryAgent: treasury, strategyAgent: strategy, maxRounds: 20 });
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    expect((await engine.startNegotiation()).status).toBe("FAILED");
    expect(events.at(-1)!.type).toBe("NEGOTIATION_FAILED");
    expect(events.some(e => e.type === "NEGOTIATION_COMPLETED")).toBe(false);
  });

  it("stops at the round limit", async () => {
    const run = await makeEngine(3).engine.startNegotiation();
    expect(run.status).toBe("FAILED");
    expect(run.rounds).toHaveLength(3);
    expect(run.finalTerms).toBeUndefined();
  });

  it("rejects agents with different intent, participants, capital or registry", () => {
    const { treasury } = makeEngine();
    const foreignSigner = new Eip712OfferSigner(KEY_B, { verifyingContract: BINDING.principal });
    for (const config of [
      strategyConfig({ binding: { ...BINDING, intentId: OTHER_INTENT_ID } }),
      strategyConfig({ binding: { ...BINDING, principal: DOMAIN.verifyingContract } }),
      strategyConfig({ capital: 1n }), strategyConfig({ signer: foreignSigner }),
    ]) {
      expect(() => new NegotiationEngine({ runId: "run", treasuryAgent: treasury,
        strategyAgent: new StrategyAgent(config), maxRounds: 20 })).toThrow("Incompatible");
    }
  });

  const mutations: [string, Partial<Offer>][] = [
    ["intent", { intentId: OTHER_INTENT_ID }], ["proposer", { proposer: BINDING.principal }],
    ["role", { proposerRole: "STRATEGY" }], ["run", { runId: "foreign" }],
    ["round", { round: 99 }], ["expiry", { expiresAt: 1 }],
  ];
  it.each(mutations)("rejects even a valid signature with mismatched %s binding before public offer emission", async (_, mutation) => {
    const { engine, treasury } = makeEngine();
    vi.spyOn(treasury, "createInitialOffer").mockResolvedValue(await treasurySigner.signOffer(sampleOffer(mutation)));
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    const run = await engine.startNegotiation();
    expect(run.status).toBe("FAILED");
    expect(run.rounds).toHaveLength(0);
    expect(events.map(e => e.type)).toEqual(["NEGOTIATION_STARTED", "NEGOTIATION_FAILED"]);
  });

  it("rejects a counter-offer signed by the wrong participant", async () => {
    const { engine, strategy } = makeEngine();
    vi.spyOn(strategy, "createCounterOffer").mockResolvedValue(await treasurySigner.signOffer(sampleOffer({ round: 2, proposerRole: "STRATEGY" })));
    expect((await engine.startNegotiation()).status).toBe("FAILED");
  });

  it.each(["nonce", "expiresAt"] as const)("rejects acceptance that re-signs a different %s", async (field) => {
    const { engine, strategy } = makeEngine();
    vi.spyOn(strategy, "acceptOffer").mockImplementation(offer => strategySigner.signOffer({
      ...offer, ...(field === "nonce" ? { nonce: offer.nonce + 1n } : { expiresAt: offer.expiresAt + 1 }),
    }));
    const run = await engine.startNegotiation();
    expect(run.status).toBe("FAILED");
    expect(run.finalTerms).toBeUndefined();
    expect(run.rounds.some(r => r.action === "ACCEPT")).toBe(false);
  });

  it("isolates subscribers from each other and from signed state", async () => {
    const { engine } = makeEngine();
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => {
      const payload = e.payload as { offer?: Offer };
      if (payload.offer) payload.offer.nonce = 999999n;
      throw new Error("synthetic observer failure");
    });
    engine.subscribe(e => events.push(e));
    const removed = vi.fn();
    const unsubscribe = engine.subscribe(removed); unsubscribe();
    const run = await engine.startNegotiation();
    expect(run.status).toBe("CONVERGED");
    expect(run.finalTerms!.nonce).toBe(42n);
    expect(serialize(events)).not.toContain("999999");
    expect(removed).not.toHaveBeenCalled();
  });

  it("never leaks agent policy/key material in successful events or final state", async () => {
    const { engine } = makeEngine();
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    const output = serialize([await engine.startNegotiation(), events]);
    for (const marker of PRIVATE_MARKERS) expect(output).not.toContain(marker);
  });

  it("does not forward potentially secret signer/provider exception text", async () => {
    const { engine, treasury } = makeEngine();
    vi.spyOn(treasury, "createInitialOffer").mockRejectedValue(new Error(`privatePolicy salt=${SALT_A}`));
    const events: ProtocolEvent[] = [];
    engine.subscribe(e => events.push(e));
    expect((await engine.startNegotiation()).status).toBe("FAILED");
    for (const marker of PRIVATE_MARKERS) expect(serialize(events)).not.toContain(marker);
  });
});
