import { describe, it, expect } from "vitest";
import { assertActionableDecision, NonActionableDecisionError, type Decision, type ProtocolEvent } from "./types.js";
import { sampleOffer, CAPITAL } from "../test/fixtures.js";

describe("domain contracts", () => {
  it("separates address proposer from negotiation role in public events", () => {
    const offer = sampleOffer();
    const event: ProtocolEvent<typeof offer> = {
      eventId: "synthetic-1", sequence: 1, timestamp: Date.now(), runId: offer.runId,
      type: "OFFER_CREATED", payload: offer,
    };
    expect(event.payload.proposer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(event.payload.proposerRole).toBe("TREASURY");
    expect(event.payload.capital).toBe(CAPITAL);
  });

  it.each([
    [1, true, false], [1, false, false], [2, true, false], [2, false, true],
  ] as const)("checkKind %i result %s rejects=%s", (checkKind, result, rejects) => {
    const decision: Decision = { runId: "synthetic", timestamp: Date.now(), checkKind, result };
    if (rejects) expect(() => assertActionableDecision(decision)).toThrow(NonActionableDecisionError);
    else expect(() => assertActionableDecision(decision)).not.toThrow();
  });
});
