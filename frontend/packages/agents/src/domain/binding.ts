import { isAddress, zeroAddress } from "viem";
import type { AgentIdentity, NegotiationBinding, Offer, OfferSigner, SignedOffer } from "./types.js";
import { canonicalOfferDomain, toRegistryTerms, verifyOfferSignature } from "../signing/Eip712OfferSigner.js";

export function bindAgent(binding: NegotiationBinding, identity: AgentIdentity, signer: OfferSigner, role: "PROPOSER" | "COUNTERPARTY") {
  if (!/^0x[0-9a-fA-F]{64}$/.test(binding.intentId) ||
      !isAddress(binding.principal) || !isAddress(binding.counterparty) ||
      binding.principal === zeroAddress || binding.counterparty === zeroAddress ||
      binding.principal.toLowerCase() === binding.counterparty.toLowerCase() ||
      identity.role !== role || !isAddress(identity.address) ||
      identity.address.toLowerCase() !== (role === "PROPOSER" ? binding.principal : binding.counterparty).toLowerCase() ||
      identity.address.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Invalid agent identity or negotiation binding");
  }
  canonicalOfferDomain(signer.domain);
  return Object.freeze({ intentId: binding.intentId, principal: binding.principal, counterparty: binding.counterparty });
}

export function assertBoundOffer(offer: Offer, binding: NegotiationBinding, role: Offer["proposerRole"]): void {
  toRegistryTerms(offer, binding);
  if (offer.proposerRole !== role || !offer.runId || !Number.isSafeInteger(offer.round) || offer.round < 1) {
    throw new Error("Invalid negotiation offer metadata");
  }
  if (offer.expiresAt < Math.floor(Date.now() / 1000)) throw new Error("Expired offer");
}

export async function assertSignedOffer(offer: SignedOffer, binding: NegotiationBinding, role: Offer["proposerRole"], signer: OfferSigner) {
  assertBoundOffer(offer, binding, role);
  const expected = role === "TREASURY" ? binding.principal : binding.counterparty;
  if (!await verifyOfferSignature(offer, signer.domain, expected)) throw new Error("Invalid offer signature");
}