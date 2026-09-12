import {
  encodeAbiParameters,
  hashTypedData,
  isAddress,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const ARC_CHAIN_ID = 5042002;
export const USDC_DECIMALS = 6;

export const OFFER_TYPES = {
  Offer: [
    { name: "intentId", type: "bytes32" },
    { name: "proposer", type: "address" },
    { name: "capital", type: "uint256" },
    { name: "duration", type: "uint256" },
    { name: "yieldBps", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type PrivatePolicyInput = {
  minYieldBps: bigint;
  maxLossBps: bigint;
  maxDuration: bigint;
  salt: Hex;
};

export type AgreementTerms = {
  intentId: Hex;
  principal: Address;
  counterparty: Address;
  capital: bigint;
  duration: bigint;
  yieldBps: bigint;
  expiresAt: bigint;
  nonce: bigint;
};

export function policyCommitment(policy: PrivatePolicyInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [policy.minYieldBps, policy.maxLossBps, policy.maxDuration, policy.salt],
    ),
  );
}

export function offerTypedData(terms: AgreementTerms, verifyingContract: Address) {
  return {
    domain: {
      name: "Sovereign",
      version: "1",
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract,
    },
    types: OFFER_TYPES,
    primaryType: "Offer" as const,
    message: {
      intentId: terms.intentId,
      proposer: terms.counterparty,
      capital: terms.capital,
      duration: terms.duration,
      yieldBps: terms.yieldBps,
      expiresAt: terms.expiresAt,
      nonce: terms.nonce,
    },
  };
}

export function offerDigest(terms: AgreementTerms, verifyingContract: Address): Hex {
  return hashTypedData(offerTypedData(terms, verifyingContract));
}

export function parseUsdc(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value) || Number(value) <= 0) {
    throw new Error("Enter a positive USDC amount with at most 6 decimals.");
  }
  return parseUnits(value, USDC_DECIMALS);
}

export function daysToSeconds(value: string): bigint {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new Error("Enter a positive whole-day duration.");
  return BigInt(value) * 86_400n;
}

export function percentToBps(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) < 0) {
    throw new Error("Enter a percentage with at most 2 decimals.");
  }
  return BigInt(Math.round(Number(value) * 100));
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function asAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} must be a valid EVM address.`);
  return value as Address;
}

export function asBytes32(value: string, label: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a bytes32 value.`);
  return value as Hex;
}

export function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function safeWalletError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("user rejected") || message.includes("user denied") || message.includes("rejected the request")) {
    return `${action} was rejected in the wallet.`;
  }
  if (message.includes("insufficient funds")) return `Insufficient testnet balance for ${action.toLowerCase()}.`;
  if (message.includes("invalidstate") || message.includes("execution reverted")) {
    return `${action} was rejected by the contract. Refresh the onchain state and verify the active role.`;
  }
  return `${action} failed. Verify the wallet network, role, values, and testnet balance.`;
}
