import { type Address, type Hex, isAddress, recoverTypedDataAddress, zeroAddress } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  OFFER_DOMAIN, OFFER_TYPES, offerDigest, offerFromTerms,
  type Terms,
} from "../../../../../packages/core/src/index";
import type {
  Offer, SignedOffer, OfferSigner, CanonicalOfferTerms, NegotiationBinding,
} from "../domain/types";

export const SOVEREIGN_OFFER_PRIMARY_TYPE = "Offer" as const;
export const SOVEREIGN_OFFER_EIP712_TYPES = OFFER_TYPES;

// Overrides are accepted only if equal to core; incompatible domains fail closed.
export interface Eip712DomainConfig {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract: Address;
}

export function canonicalOfferDomain(config: Eip712DomainConfig) {
  if ((config.name !== undefined && config.name !== OFFER_DOMAIN.name) ||
      (config.version !== undefined && config.version !== OFFER_DOMAIN.version) ||
      (config.chainId !== undefined && config.chainId !== OFFER_DOMAIN.chainId) ||
      !isAddress(config.verifyingContract) || config.verifyingContract === zeroAddress) {
    throw new Error("Invalid canonical offer domain");
  }
  return { ...OFFER_DOMAIN, verifyingContract: config.verifyingContract };
}

export function assertCanonicalOffer(offer: CanonicalOfferTerms): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(offer.intentId) ||
      !isAddress(offer.proposer) || offer.proposer === zeroAddress) {
    throw new Error("Invalid offer binding");
  }
  for (const value of [offer.duration, offer.yieldBps, offer.expiresAt]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid offer integer");
  }
  const maxUint256 = (1n << 256n) - 1n;
  for (const value of [offer.capital, offer.nonce]) {
    if (typeof value !== "bigint" || value < 0n || value > maxUint256) {
      throw new Error("Invalid offer uint256");
    }
  }
  if (offer.capital === 0n || offer.duration === 0) throw new Error("Empty offer terms");
}

/** Reconstruct all eight registry fields without changing offer nonce or expiry. */
export function toRegistryTerms(offer: CanonicalOfferTerms, binding: NegotiationBinding): Terms {
  assertCanonicalOffer(offer);
  if (offer.intentId.toLowerCase() !== binding.intentId.toLowerCase() ||
      offer.proposer.toLowerCase() !== binding.counterparty.toLowerCase() ||
      !isAddress(binding.principal) || binding.principal === zeroAddress ||
      binding.principal.toLowerCase() === binding.counterparty.toLowerCase()) {
    throw new Error("Offer does not match negotiation binding");
  }
  return {
    intentId: offer.intentId,
    principal: binding.principal,
    counterparty: offer.proposer,
    capital: offer.capital,
    duration: BigInt(offer.duration),
    yieldBps: BigInt(offer.yieldBps),
    expiresAt: BigInt(offer.expiresAt),
    nonce: offer.nonce,
  };
}

// Principal is not part of the seven-field Offer signature. Only the registry
// (and the bound negotiation) authenticates it against the intent creator.
function digestTerms(offer: CanonicalOfferTerms): Terms {
  assertCanonicalOffer(offer);
  return {
    intentId: offer.intentId, principal: zeroAddress, counterparty: offer.proposer,
    capital: offer.capital, duration: BigInt(offer.duration),
    yieldBps: BigInt(offer.yieldBps), expiresAt: BigInt(offer.expiresAt), nonce: offer.nonce,
  };
}

export function toCanonicalOfferMessage(offer: CanonicalOfferTerms) {
  return offerFromTerms(digestTerms(offer));
}

export const toEip712OfferMessage = toCanonicalOfferMessage;

/** Keys are held only in private ECMAScript fields, never serialized. */
export class Eip712OfferSigner implements OfferSigner {
  readonly #account: PrivateKeyAccount;
  readonly #domain: ReturnType<typeof canonicalOfferDomain>;

  constructor(signingKey: Hex | PrivateKeyAccount, domainConfig: Eip712DomainConfig) {
    this.#account = typeof signingKey === "string" ? privateKeyToAccount(signingKey) : signingKey;
    this.#domain = canonicalOfferDomain(domainConfig);
  }

  get address(): Address { return this.#account.address; }
  get domain() { return { ...this.#domain }; }

  async signOffer(offer: Offer): Promise<SignedOffer> {
    // Snapshot only public fields before awaiting signing. Extra caller fields
    // (including private policy or signer material) must never be serialized.
    const message = toCanonicalOfferMessage(offer);
    const publicOffer: Offer = {
      runId: offer.runId, round: offer.round, proposerRole: offer.proposerRole,
      intentId: message.intentId, proposer: message.proposer, capital: message.capital,
      duration: Number(message.duration), yieldBps: Number(message.yieldBps),
      expiresAt: Number(message.expiresAt), nonce: message.nonce,
    };
    const signature = await this.#account.signTypedData({
      domain: this.#domain, types: OFFER_TYPES, primaryType: "Offer", message,
    });
    return { ...publicOffer, signature, signerAddress: this.address };
  }

  toJSON() { return { address: this.address, domain: this.domain }; }
}

/** Cryptographic verification only; session/role/participant checks are separate. */
export async function verifyOfferSignature(
  signedOffer: SignedOffer, domainConfig: Eip712DomainConfig, expectedSigner?: Address,
): Promise<boolean> {
  try {
    const target = expectedSigner ?? signedOffer.signerAddress;
    if (!isAddress(target) || signedOffer.signerAddress.toLowerCase() !== target.toLowerCase()) return false;
    const recovered = await recoverTypedDataAddress({
      domain: canonicalOfferDomain(domainConfig), types: OFFER_TYPES, primaryType: "Offer",
      message: toCanonicalOfferMessage(signedOffer), signature: signedOffer.signature,
    });
    return recovered.toLowerCase() === target.toLowerCase();
  } catch { return false; }
}

/** Full canonical EIP-712 digest (domain separator included), not a struct hash. */
export function hashOfferTypedData(offer: CanonicalOfferTerms, config: Eip712DomainConfig): Hex {
  return offerDigest(digestTerms(offer), canonicalOfferDomain(config).verifyingContract);
}
