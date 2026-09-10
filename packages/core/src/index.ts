import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  type Address,
  type Hex
} from "viem";

export type Policy = {
  minYieldBps: bigint;
  maxLossBps: bigint;
  maxDuration: bigint;
  salt: Hex;
};

export type Terms = {
  intentId: Hex;
  principal: Address;
  counterparty: Address;
  capital: bigint;
  duration: bigint;
  yieldBps: bigint;
  expiresAt: bigint;
  nonce: bigint;
};

export const OFFER_DOMAIN = {
  name: "Sovereign",
  version: "1",
  chainId: 11155111
} as const;

export const OFFER_TYPE =
  "Offer(bytes32 intentId,address proposer,uint256 capital,uint256 duration,uint256 yieldBps,uint256 expiresAt,uint256 nonce)";

export const OFFER_TYPES = {
  Offer: [
    { name: "intentId", type: "bytes32" },
    { name: "proposer", type: "address" },
    { name: "capital", type: "uint256" },
    { name: "duration", type: "uint256" },
    { name: "yieldBps", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

export type Offer = {
  intentId: Hex;
  proposer: Address;
  capital: bigint;
  duration: bigint;
  yieldBps: bigint;
  expiresAt: bigint;
  nonce: bigint;
};

export function hashPolicy(policy: Policy): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" }
      ],
      [policy.minYieldBps, policy.maxLossBps, policy.maxDuration, policy.salt]
    )
  );
}

export function hashTerms(terms: Terms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" }
      ],
      [
        terms.intentId,
        terms.principal,
        terms.counterparty,
        terms.capital,
        terms.duration,
        terms.yieldBps,
        terms.expiresAt,
        terms.nonce
      ]
    )
  );
}

export function offerFromTerms(terms: Terms): Offer {
  return {
    intentId: terms.intentId,
    proposer: terms.counterparty,
    capital: terms.capital,
    duration: terms.duration,
    yieldBps: terms.yieldBps,
    expiresAt: terms.expiresAt,
    nonce: terms.nonce
  };
}

export function offerDigest(terms: Terms, verifyingContract: Address): Hex {
  return hashTypedData({
    domain: { ...OFFER_DOMAIN, verifyingContract },
    types: OFFER_TYPES,
    primaryType: "Offer",
    message: offerFromTerms(terms)
  });
}
