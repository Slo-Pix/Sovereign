// ============================================================
// W3 DOMAIN TYPES
// Canonical public identifiers and registry terms come from protocol core.
// ============================================================
import type { Address, Hex } from "viem";
import type { Offer as CoreOffer, OFFER_DOMAIN } from "../../../../../packages/core/src/index";

// ─── PRIVACY MODEL ────────────────────────────────────────────
//
// BREACH-ONLY PUBLICATION
//
// Intended CRE integration: eligible monitoring evaluations stay private.
// While the position is SAFE, nothing is submitted to DecisionSink.
// Only a breached private condition is actionable for submission:
//   CHECK_BREACH, result = true (BREACHED)
//
// This reduces explicit public SAFE observations, not all inference:
//   Observer watching 280→SAFE, 290→SAFE, 310→BREACHED
//   assuming a loss-triggered strict-greater breach, learns
//   290 <= maxLossBps < 310 and can narrow the interval.
//
// Breach-only publication removes explicit SAFE reports, leaving:
//   310→BREACHED
// Without knowing the cause (loss OR elapsed duration), this alone does not
// establish a loss-threshold bound. There is no public SAFE-result history.
//
// RESIDUAL LEAKAGE (documented, not a bug):
//   When the contract transitions ACTIVE→BREACHED, observers learn
//   the private condition was reported true. Timing, absent reports,
//   public position data and validation probing can still leak information.
//   Confidential CRE execution is not a ZK proof or a guarantee of secrecy.
// ──────────────────────────────────────────────────────────────

export type AgentIdentity = {
  name: string;
  address: Address;
  role: "PROPOSER" | "COUNTERPARTY";
};

export type PrivatePolicy = {
  minYieldBps: number;
  maxLossBps: number;
  maxDuration: number; // seconds
  salt: string;
};

export type StrategyPrivatePolicy = {
  maxYieldBps: number;
  minDuration: number; // seconds
  maxLossBps: number;
  salt: string;
};

export type Agent = {
  identity: AgentIdentity;
  capital: bigint;
};

export type NegotiationBinding = {
  intentId: Hex;
  principal: Address;
  counterparty: Address;
};

// Numbers at the agent boundary must be nonnegative safe integers.
export type CanonicalOfferTerms = Omit<CoreOffer, "duration" | "yieldBps" | "expiresAt"> & {
  duration: number; // seconds, never days
  yieldBps: number;
  expiresAt: number; // Unix seconds, never milliseconds
};

export type Offer = CanonicalOfferTerms & {
  runId: string;
  round: number;
  proposerRole: "TREASURY" | "STRATEGY"; // unsigned negotiation metadata
};

export type SignedOffer = Offer & {
  signature: Hex;
  signerAddress: Address;
};

export type OfferSigningDomain = typeof OFFER_DOMAIN & { verifyingContract: Address };

// Shared signer interface used by both TreasuryAgent and StrategyAgent
export interface OfferSigner {
  readonly address: Address;
  readonly domain: OfferSigningDomain;
  signOffer(offer: Offer): Promise<SignedOffer>;
}

export type NegotiationRound = {
  runId: string;
  round: number;
  timestamp: number;
  actor: "TREASURY" | "STRATEGY";
  action: "OFFER" | "COUNTER_OFFER" | "ACCEPT" | "REJECT";
  offer?: SignedOffer;
};

export type FinalTerms = CanonicalOfferTerms & NegotiationBinding & {
  runId: string;
  acceptedAt: number; // local event timestamp in milliseconds
  treasurySignature: Hex;
  strategySignature: Hex;
};

export type NegotiationRun = NegotiationBinding & {
  runId: string;
  status: "OPEN" | "NEGOTIATING" | "CONVERGED" | "FAILED";
  rounds: NegotiationRound[];
  finalTerms?: FinalTerms;
};

// RiskUpdate models PRIVATE monitoring state, not proof of CRE/TEE execution.
// It must NEVER be submitted to a public event log or on-chain sink while the
// position is safe. The observed risk value is not included because publishing
// it would let observers correlate subsequent SAFE results with the threshold.
export type RiskUpdate = {
  runId: string;
  timestamp: number;
  // The verdict alone is not a full on-chain Decision report envelope.
  // Do not emit currentRiskScore in any public event — it enables threshold inference.
  isBreached: boolean;
};

// Decision is a local decision view, NOT the full DecisionSink calldata schema.
// The transport must also bind agreementId, decisionId and decision nonce.
//
// IMPORTANT — Breach-only invariant:
//   checkKind=2 (Breach) decisions MUST only be submitted when result=true
//   (i.e., the threshold was crossed). Submitting a SAFE breach check
//   (result=false) reveals that the current observed value was at or below the
//   threshold, forming one data point in a binary-search oracle.
//
//   Use NonActionableDecisionError to reject SAFE breach submissions at
//   the application layer before they reach the chain.
export type Decision = {
  runId: string;
  timestamp: number;
  checkKind: 1 | 2; // 1 = Validation, 2 = Breach
  // Validation (checkKind=1): true=ACCEPT, false=REJECT
  // Breach    (checkKind=2): ONLY true=BREACHED is submitted on-chain.
  //                          false (SAFE) is evaluated privately and DISCARDED.
  result: boolean;
};

/**
 * Thrown when a caller attempts to submit a non-actionable breach decision
 * (i.e., checkKind=BREACH with result=SAFE) to a public sink.
 *
 * Enforcement pattern:
 *   if (decision.checkKind === 2 && decision.result === false) {
 *     throw new NonActionableDecisionError(decision.runId);
 *   }
 */
export class NonActionableDecisionError extends Error {
  constructor(runId: string) {
    super(
      `NonActionableDecision: Breach check with result=SAFE for run "${runId}" ` +
      `must not be submitted publicly. Evaluate privately and discard.`
    );
    this.name = "NonActionableDecisionError";
  }
}

/**
 * Guards against submitting a SAFE breach check to a public sink.
 * Call this before any DecisionSink submission.
 */
export function assertActionableDecision(decision: Decision): void {
  if (decision.checkKind === 2 && decision.result === false) {
    throw new NonActionableDecisionError(decision.runId);
  }
}

export type ProtocolEventType =
  | "NEGOTIATION_STARTED"
  | "OFFER_CREATED"
  | "COUNTER_OFFER_CREATED"
  | "OFFER_ACCEPTED"
  | "OFFER_REJECTED"
  | "NEGOTIATION_COMPLETED"
  | "NEGOTIATION_FAILED"
  // RISK_EVALUATED is a LOCAL/PRIVATE event — never emitted to a public sink.
  // It represents a single CRE/TEE monitoring tick. The observed value MUST
  // NOT be included in the event payload (threshold inference risk).
  | "RISK_EVALUATED"
  // BREACH_DETECTED is the ONLY breach-related event that may be submitted
  // on-chain. It represents an actionable private condition reported by CRE.
  // This type does not prove TEE execution or implement report transport.
  | "BREACH_DETECTED"
  // DECISION_RECEIVED covers Validation decisions (checkKind=1).
  // For Breach decisions (checkKind=2), only BREACH_DETECTED is emitted.
  | "DECISION_RECEIVED";

export type ProtocolEvent<T = unknown> = {
  eventId: string;
  sequence: number;
  timestamp: number;
  runId: string;
  type: ProtocolEventType;
  payload: T;
};
