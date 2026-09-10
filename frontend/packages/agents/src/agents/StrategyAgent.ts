import type { AgentIdentity, Offer, StrategyPrivatePolicy, SignedOffer, OfferSigner, NegotiationBinding } from "../domain/types.js";
import { assertBoundOffer, assertSignedOffer, bindAgent } from "../domain/binding.js";

export type StrategyConcessionSchedule = {
  round: number;
  duration: number;
  yieldBps: number;
}[];

export type StrategyAgentConfig = {
  binding: NegotiationBinding;
  initialOfferNonce?: bigint;
  identity: AgentIdentity;
  capital: bigint;
  privatePolicy: StrategyPrivatePolicy;
  targetTerms: {
    duration: number;
    yieldBps: number;
  };
  concessionSchedule: StrategyConcessionSchedule;
  signer: OfferSigner;
};

export class StrategyAgent {
  public readonly binding: Readonly<NegotiationBinding>;
  public readonly identity: AgentIdentity;
  public readonly capital: bigint;
  
  // Private fields - explicitly kept out of public serialization
  readonly #privatePolicy: StrategyPrivatePolicy;
  readonly #targetTerms: { duration: number; yieldBps: number };
  readonly #concessionSchedule: StrategyConcessionSchedule;
  readonly #signer: OfferSigner;

  // Track the current nonce for this agent's offers
  private currentNonce: bigint = 1n;

  constructor(config: StrategyAgentConfig) {
    this.binding = bindAgent(config.binding, config.identity, config.signer, "COUNTERPARTY");
    this.identity = Object.freeze({ name: config.identity.name, address: config.identity.address, role: config.identity.role });
    this.capital = config.capital;
    this.#privatePolicy = { ...config.privatePolicy };
    this.#targetTerms = { ...config.targetTerms };
    this.#concessionSchedule = config.concessionSchedule.map(c => ({ ...c }));
    this.#signer = config.signer;
    this.currentNonce = config.initialOfferNonce ?? 1n;
  }

  get signingDomain() { return this.#signer.domain; }

  /**
   * Evaluates a counter-offer from the Treasury Agent.
   * Returns "ACCEPT" if it meets the private policy, "REJECT" if it egregiously violates,
   * or "COUNTER" if we should continue negotiating.
   */
  public evaluateCounterOffer(counterOffer: Offer): "ACCEPT" | "COUNTER" | "REJECT" {
    // Evaluation is not signature verification; acceptance verifies the peer.
    assertBoundOffer(counterOffer, this.binding, "TREASURY");
    if (counterOffer.capital !== this.capital) {
      return "REJECT"; // Capital mismatch
    }

    // Check if the counter-offer satisfies our absolute minimums (Private Policy)
    // Strategy wants low yield and high duration.
    // If Treasury demands MORE yield than we can pay, or LESS duration than we can accept:
    if (
      counterOffer.yieldBps > this.#privatePolicy.maxYieldBps ||
      counterOffer.duration < this.#privatePolicy.minDuration
    ) {
      // Check if we have any concessions left that can bridge the gap.
      const nextConcession = this.#concessionSchedule.find(c => c.round === counterOffer.round + 1);
      if (!nextConcession) {
        return "REJECT";
      }
      return "COUNTER";
    }

    // If the counter offer is BETTER or EQUAL to our target terms, accept immediately.
    // Better for Strategy means: yield is LOWER or equal, duration is HIGHER or equal.
    if (
      counterOffer.yieldBps <= this.#targetTerms.yieldBps &&
      counterOffer.duration >= this.#targetTerms.duration
    ) {
      return "ACCEPT";
    }

    // If it's acceptable by private policy but not our ideal target, 
    // check if we want to accept it or counter again.
    const nextConcession = this.#concessionSchedule.find(c => c.round === counterOffer.round + 1);
    if (!nextConcession) {
      return "ACCEPT";
    }

    // If the counter-offer is already better than what we would offer in our next concession, accept it.
    if (
      counterOffer.yieldBps <= nextConcession.yieldBps &&
      counterOffer.duration >= nextConcession.duration
    ) {
      return "ACCEPT";
    }

    return "COUNTER";
  }

  /**
   * Generates a deterministic counter-offer based on the concession schedule.
   */
  public async createCounterOffer(runId: string, currentRound: number): Promise<SignedOffer> {
    const nextRound = currentRound + 1;
    const concession = this.#concessionSchedule.find(c => c.round === nextRound);

    if (!concession) {
      throw new Error("No concession available for this round");
    }

    const offer: Offer = {
      runId,
      round: nextRound,
      intentId: this.binding.intentId,
      proposer: this.binding.counterparty,
      proposerRole: "STRATEGY",
      capital: this.capital,
      duration: concession.duration,
      yieldBps: concession.yieldBps,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      nonce: this.currentNonce++,
    };

    assertBoundOffer(offer, this.binding, "STRATEGY");
    return this.#signer.signOffer(offer);
  }

  /**
   * Called to explicitly accept an offer (primarily just returns a signature of the accepted terms 
   * if needed, or simply acts as a lifecycle hook).
   */
  public async acceptOffer(offer: SignedOffer): Promise<SignedOffer> {
    const acceptedOffer = { ...offer };
    await assertSignedOffer(acceptedOffer, this.binding, "TREASURY", this.#signer);
    if (acceptedOffer.capital !== this.capital ||
        acceptedOffer.yieldBps > this.#privatePolicy.maxYieldBps ||
        acceptedOffer.duration < this.#privatePolicy.minDuration) {
      throw new Error("Offer is not acceptable");
    }
    // Both parties sign the identical counterparty-bound terms, including nonce/expiry.
    return this.#signer.signOffer(acceptedOffer);
  }

  /**
   * Serializes the public-facing state of the agent.
   * MUST NOT INCLUDE PRIVATE POLICY OR SALT.
   */
  public toJSON() {
    return {
      identity: this.identity,
      capital: this.capital.toString(),
    };
  }
}
