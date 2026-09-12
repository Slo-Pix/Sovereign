import type { TreasuryAgent } from "../agents/TreasuryAgent";
import type { StrategyAgent } from "../agents/StrategyAgent";
import type { NegotiationRun, ProtocolEvent, FinalTerms, SignedOffer } from "../domain/types";
import { assertBoundOffer } from "../domain/binding";
import { hashOfferTypedData, verifyOfferSignature } from "../signing/Eip712OfferSigner";

export type EngineConfig = {
  runId: string;
  treasuryAgent: TreasuryAgent;
  strategyAgent: StrategyAgent;
  maxRounds: number;
};

export type EventListener = (event: ProtocolEvent) => void;

export class NegotiationEngine {
  private config: EngineConfig;
  private listeners: EventListener[] = [];
  private eventSequence = 1;
  private state: NegotiationRun;

  constructor(config: EngineConfig) {
    const treasury = config.treasuryAgent;
    const strategy = config.strategyAgent;
    if (!config.runId || !Number.isSafeInteger(config.maxRounds) || config.maxRounds < 1 ||
        treasury.binding.intentId.toLowerCase() !== strategy.binding.intentId.toLowerCase() ||
        treasury.binding.principal.toLowerCase() !== strategy.binding.principal.toLowerCase() ||
        treasury.binding.counterparty.toLowerCase() !== strategy.binding.counterparty.toLowerCase() ||
        treasury.capital !== strategy.capital ||
        treasury.signingDomain.verifyingContract.toLowerCase() !== strategy.signingDomain.verifyingContract.toLowerCase()) {
      throw new Error("Incompatible negotiation agents or configuration");
    }
    this.config = { ...config };
    this.state = {
      ...treasury.binding,
      runId: config.runId,
      status: "OPEN",
      rounds: [],
    };
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(type: ProtocolEvent["type"], payload: unknown) {
    const event: ProtocolEvent = {
      eventId: `${this.config.runId}-${this.eventSequence}`,
      sequence: this.eventSequence++,
      timestamp: Date.now(),
      runId: this.config.runId,
      type,
      payload,
    };
    for (const listener of this.listeners) {
      // Observers cannot mutate the signed offer/state or abort negotiation.
      try { listener(structuredClone(event)); } catch { /* local observer failure */ }
    }
  }

  public async startNegotiation(): Promise<NegotiationRun> {
    if (this.state.status !== "OPEN") {
      throw new Error("Negotiation already started or completed");
    }

    this.state.status = "NEGOTIATING";
    this.emit("NEGOTIATION_STARTED", {
      treasury: this.config.treasuryAgent.toJSON(),
      strategy: this.config.strategyAgent.toJSON(),
    });

    let currentRound = 1;
    let currentOffer: SignedOffer | undefined;
    let lastProposer: "TREASURY" | "STRATEGY" = "TREASURY";

    try {
      // Round 1: Treasury creates initial offer
      currentOffer = await this.config.treasuryAgent.createInitialOffer(this.config.runId);
      await this.validateOffer(currentOffer, "TREASURY", currentRound);
      
      this.recordRound(currentRound, "TREASURY", "OFFER", currentOffer);
      this.emit("OFFER_CREATED", { round: currentRound, offer: currentOffer });
      
      currentRound++;
      lastProposer = "TREASURY";

      while (this.state.status === "NEGOTIATING") {
        if (currentRound > this.config.maxRounds) {
          return this.failNegotiation("Max rounds exceeded");
        }

        if (lastProposer === "TREASURY") {
          // Strategy evaluates
          const decision = this.config.strategyAgent.evaluateCounterOffer(currentOffer!);
          if (decision === "ACCEPT") {
            const acceptedOffer = await this.config.strategyAgent.acceptOffer(currentOffer!);
            await this.validateAcceptance(currentOffer!, acceptedOffer, "STRATEGY");
            this.recordRound(currentRound, "STRATEGY", "ACCEPT", acceptedOffer);
            this.emit("OFFER_ACCEPTED", { round: currentRound, by: "STRATEGY", offer: acceptedOffer });
            return this.completeNegotiation(currentOffer!, acceptedOffer);
          } else if (decision === "REJECT") {
            this.recordRound(currentRound, "STRATEGY", "REJECT");
            this.emit("OFFER_REJECTED", { round: currentRound, by: "STRATEGY" });
            return this.failNegotiation("Rejected by strategy constraints");
          } else {
            // COUNTER
            const counterOffer = await this.config.strategyAgent.createCounterOffer(this.config.runId, currentOffer!.round);
            await this.validateOffer(counterOffer, "STRATEGY", currentRound);
            this.recordRound(currentRound, "STRATEGY", "COUNTER_OFFER", counterOffer);
            this.emit("COUNTER_OFFER_CREATED", { round: currentRound, offer: counterOffer });
            currentOffer = counterOffer;
            lastProposer = "STRATEGY";
          }
        } else {
          // Treasury evaluates
          const decision = this.config.treasuryAgent.evaluateCounterOffer(currentOffer!);
          if (decision === "ACCEPT") {
            const acceptedOffer = await this.config.treasuryAgent.acceptOffer(currentOffer!);
            await this.validateAcceptance(currentOffer!, acceptedOffer, "TREASURY");
            this.recordRound(currentRound, "TREASURY", "ACCEPT", acceptedOffer);
            this.emit("OFFER_ACCEPTED", { round: currentRound, by: "TREASURY", offer: acceptedOffer });
            return this.completeNegotiation(currentOffer!, acceptedOffer);
          } else if (decision === "REJECT") {
            this.recordRound(currentRound, "TREASURY", "REJECT");
            this.emit("OFFER_REJECTED", { round: currentRound, by: "TREASURY" });
            return this.failNegotiation("Rejected by treasury constraints");
          } else {
            // COUNTER
            const counterOffer = await this.config.treasuryAgent.createCounterOffer(this.config.runId, currentOffer!.round);
            await this.validateOffer(counterOffer, "TREASURY", currentRound);
            this.recordRound(currentRound, "TREASURY", "COUNTER_OFFER", counterOffer);
            this.emit("COUNTER_OFFER_CREATED", { round: currentRound, offer: counterOffer });
            currentOffer = counterOffer;
            lastProposer = "TREASURY";
          }
        }
        currentRound++;
      }
    } catch {
      // Signer/provider exceptions may contain secrets; never publish raw text.
      return this.failNegotiation("Negotiation validation or signing failed");
    }

    return this.state;
  }

  private recordRound(round: number, actor: "TREASURY" | "STRATEGY", action: "OFFER" | "COUNTER_OFFER" | "ACCEPT" | "REJECT", offer?: SignedOffer) {
    this.state.rounds.push({
      runId: this.config.runId,
      round,
      timestamp: Date.now(),
      actor,
      action,
      offer: offer ? structuredClone(offer) : undefined
    });
  }

  private completeNegotiation(agreedTerms: SignedOffer, acceptanceSign: SignedOffer) {
    this.state.status = "CONVERGED";
    const finalTerms: FinalTerms = {
      runId: this.config.runId,
      ...this.config.treasuryAgent.binding,
      proposer: agreedTerms.proposer,
      capital: agreedTerms.capital,
      duration: agreedTerms.duration,
      yieldBps: agreedTerms.yieldBps,
      expiresAt: agreedTerms.expiresAt,
      nonce: agreedTerms.nonce,
      acceptedAt: Date.now(),
      treasurySignature: agreedTerms.proposerRole === "TREASURY" ? agreedTerms.signature : acceptanceSign.signature,
      strategySignature: agreedTerms.proposerRole === "STRATEGY" ? agreedTerms.signature : acceptanceSign.signature,
    };
    this.state.finalTerms = finalTerms;
    this.emit("NEGOTIATION_COMPLETED", finalTerms);
    return structuredClone(this.state);
  }

  private async validateOffer(offer: SignedOffer, role: SignedOffer["proposerRole"], round: number) {
    const treasury = this.config.treasuryAgent;
    assertBoundOffer(offer, treasury.binding, role);
    const expectedSigner = role === "TREASURY" ? treasury.binding.principal : treasury.binding.counterparty;
    if (offer.runId !== this.config.runId || offer.round !== round || offer.capital !== treasury.capital ||
        !await verifyOfferSignature(offer, treasury.signingDomain, expectedSigner)) {
      throw new Error("Invalid signed negotiation offer");
    }
  }

  private async validateAcceptance(offer: SignedOffer, acceptance: SignedOffer, role: SignedOffer["proposerRole"]) {
    const treasury = this.config.treasuryAgent;
    assertBoundOffer(acceptance, treasury.binding, offer.proposerRole);
    const expectedSigner = role === "TREASURY" ? treasury.binding.principal : treasury.binding.counterparty;
    if (acceptance.runId !== offer.runId || acceptance.round !== offer.round ||
        hashOfferTypedData(offer, treasury.signingDomain) !== hashOfferTypedData(acceptance, treasury.signingDomain) ||
        !await verifyOfferSignature(acceptance, treasury.signingDomain, expectedSigner)) {
      throw new Error("Acceptance changed signed terms");
    }
  }

  private failNegotiation(reason: string) {
    this.state.status = "FAILED";
    this.emit("NEGOTIATION_FAILED", { reason });
    return structuredClone(this.state);
  }
}
