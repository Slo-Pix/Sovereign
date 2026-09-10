// PUBLIC SYNTHETIC TEST IDENTITIES ONLY. Never fund these accounts or use these
// deterministic keys/policy salts for an actual agreement.
import type { Hex } from "viem";
import { Eip712OfferSigner } from "../signing/Eip712OfferSigner.js";
import type { NegotiationBinding, Offer } from "../domain/types.js";
import type { TreasuryAgentConfig } from "../agents/TreasuryAgent.js";
import type { StrategyAgentConfig } from "../agents/StrategyAgent.js";

export const KEY_A = `0x${"1".padStart(64, "0")}` as Hex;
export const KEY_B = `0x${"2".padStart(64, "0")}` as Hex;
export const INTENT_ID = `0x${"aa".repeat(32)}` as Hex;
export const OTHER_INTENT_ID = `0x${"bb".repeat(32)}` as Hex;
export const DOMAIN = { verifyingContract: "0x3333333333333333333333333333333333333333" } as const;
export const treasurySigner = new Eip712OfferSigner(KEY_A, DOMAIN);
export const strategySigner = new Eip712OfferSigner(KEY_B, DOMAIN);
export const BINDING: NegotiationBinding = {
  intentId: INTENT_ID, principal: treasurySigner.address, counterparty: strategySigner.address,
};
export const DAY = 86400;
export const CAPITAL = 100_000n * 10n ** 6n;
export const SALT_A = `0x${"ab".repeat(32)}`;
export const SALT_B = `0x${"cd".repeat(32)}`;

export function sampleOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    runId: "run-synthetic", round: 1, intentId: INTENT_ID,
    proposer: BINDING.counterparty, proposerRole: "TREASURY",
    capital: CAPITAL, duration: 30 * DAY, yieldBps: 900,
    expiresAt: Math.floor(Date.now() / 1000) + DAY, nonce: 17n,
    ...overrides,
  };
}

export function treasuryConfig(overrides: Partial<TreasuryAgentConfig> = {}): TreasuryAgentConfig {
  return {
    binding: { ...BINDING },
    identity: { name: "Synthetic Treasury", address: BINDING.principal, role: "PROPOSER" },
    capital: CAPITAL,
    privatePolicy: { minYieldBps: 800, maxLossBps: 300, maxDuration: 30 * DAY, salt: SALT_A },
    targetTerms: { duration: 30 * DAY, yieldBps: 900 },
    concessionSchedule: [
      { round: 3, duration: 27 * DAY, yieldBps: 850 },
      { round: 5, duration: 25 * DAY, yieldBps: 820 },
    ],
    signer: treasurySigner,
    ...overrides,
  };
}

export function strategyConfig(overrides: Partial<StrategyAgentConfig> = {}): StrategyAgentConfig {
  return {
    binding: { ...BINDING },
    identity: { name: "Synthetic Strategy", address: BINDING.counterparty, role: "COUNTERPARTY" },
    capital: CAPITAL,
    privatePolicy: { maxYieldBps: 900, minDuration: 20 * DAY, maxLossBps: 300, salt: SALT_B },
    targetTerms: { duration: 60 * DAY, yieldBps: 700 },
    concessionSchedule: [{ round: 2, duration: 28 * DAY, yieldBps: 880 }],
    signer: strategySigner,
    ...overrides,
  };
}

export const serialize = (value: unknown) => JSON.stringify(value, (_, v: unknown) => typeof v === "bigint" ? v.toString() : v);
export const PRIVATE_MARKERS = [
  "minYieldBps", "maxLossBps", "maxDuration", "maxYieldBps", "minDuration",
  "salt", "privatePolicy", SALT_A, SALT_B, KEY_A.slice(2), KEY_B.slice(2),
];