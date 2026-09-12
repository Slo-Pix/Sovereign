import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashTypedData, verifyTypedData, type Address, type Hex } from "viem";
import { OFFER_DOMAIN, OFFER_TYPES, offerDigest, offerFromTerms, hashTerms, type Terms } from "../../../../../packages/core/src/index";
import {
  Eip712OfferSigner, verifyOfferSignature, hashOfferTypedData,
  toCanonicalOfferMessage, toRegistryTerms, SOVEREIGN_OFFER_EIP712_TYPES,
} from "./Eip712OfferSigner";
import type { Offer } from "../domain/types";
import {
  BINDING, DOMAIN, KEY_A, OTHER_INTENT_ID, treasurySigner, strategySigner,
  sampleOffer, serialize, PRIVATE_MARKERS,
} from "../test/fixtures";

describe("canonical EIP-712 signing", () => {
  it("matches the actual core fixture digest, message and eight-field terms hash", () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../../packages/core/fixtures/vectors.json"), "utf8"));
    const terms: Terms = {
      intentId: fixture.terms.intentId, principal: fixture.terms.principal,
      counterparty: fixture.terms.counterparty, capital: BigInt(fixture.terms.capital),
      duration: BigInt(fixture.terms.duration), yieldBps: BigInt(fixture.terms.yieldBps),
      expiresAt: BigInt(fixture.terms.expiresAt), nonce: BigInt(fixture.terms.nonce),
    };
    const offer = sampleOffer({
      ...offerFromTerms(terms), duration: Number(terms.duration),
      yieldBps: Number(terms.yieldBps), expiresAt: Number(terms.expiresAt),
    });
    const config = { verifyingContract: fixture.offer.verifyingContract as Address };
    expect(SOVEREIGN_OFFER_EIP712_TYPES).toBe(OFFER_TYPES);
    expect(OFFER_TYPES.Offer.map(f => f.name)).toEqual([
      "intentId", "proposer", "capital", "duration", "yieldBps", "expiresAt", "nonce",
    ]);
    expect(toCanonicalOfferMessage(offer)).toEqual(offerFromTerms(terms));
    expect(toRegistryTerms(offer, terms)).toEqual(terms);
    expect(hashTerms(toRegistryTerms(offer, terms))).toBe(fixture.termsHash);
    expect(hashOfferTypedData(offer, config)).toBe(fixture.offer.digest);
    expect(hashOfferTypedData(offer, config)).toBe(offerDigest(terms, config.verifyingContract));
  });

  it("verifies using viem and the actual seven-field core envelope, not a copied schema", async () => {
    const offer = sampleOffer();
    const signed = await strategySigner.signOffer(offer);
    const terms = toRegistryTerms(offer, BINDING);
    expect(await verifyTypedData({
      address: BINDING.counterparty, domain: { ...OFFER_DOMAIN, ...DOMAIN },
      types: OFFER_TYPES, primaryType: "Offer", message: offerFromTerms(terms), signature: signed.signature,
    })).toBe(true);
    expect(hashTypedData({ domain: { ...OFFER_DOMAIN, ...DOMAIN }, types: OFFER_TYPES,
      primaryType: "Offer", message: offerFromTerms(terms) })).toBe(hashOfferTypedData(offer, DOMAIN));
    expect(await verifyOfferSignature(signed, DOMAIN, BINDING.counterparty)).toBe(true);
  });

  const mutations: [string, Partial<Offer>][] = [
    ["intentId", { intentId: OTHER_INTENT_ID }],
    ["proposer", { proposer: BINDING.principal }],
    ["capital", { capital: 1n }], ["duration", { duration: 1 }],
    ["yieldBps", { yieldBps: 1 }], ["expiresAt", { expiresAt: 1 }], ["nonce", { nonce: 99n }],
  ];
  it.each(mutations)("rejects mutation of canonical %s", async (_, mutation) => {
    const signed = await treasurySigner.signOffer(sampleOffer());
    expect(await verifyOfferSignature({ ...signed, ...mutation }, DOMAIN, BINDING.principal)).toBe(false);
  });

  it("excludes only role/run/round metadata, not the proposer address", async () => {
    const signed = await treasurySigner.signOffer(sampleOffer());
    expect(await verifyOfferSignature({ ...signed, runId: "other", round: 99, proposerRole: "STRATEGY" }, DOMAIN)).toBe(true);
  });

  it("rejects wrong signer, false signer attribution and malformed signatures", async () => {
    const signed = await treasurySigner.signOffer(sampleOffer());
    expect(await verifyOfferSignature(signed, DOMAIN, BINDING.counterparty)).toBe(false);
    expect(await verifyOfferSignature({ ...signed, signerAddress: BINDING.counterparty }, DOMAIN, BINDING.principal)).toBe(false);
    expect(await verifyOfferSignature({ ...signed, signature: "0x00" }, DOMAIN)).toBe(false);
  });

  it.each([{ chainId: 1 }, { name: "Other" }, { version: "2" }])("rejects noncanonical domain overrides %j", async (override) => {
    expect(() => new Eip712OfferSigner(KEY_A, { ...DOMAIN, ...override })).toThrow("domain");
    expect(() => hashOfferTypedData(sampleOffer(), { ...DOMAIN, ...override })).toThrow("domain");
    expect(await verifyOfferSignature(await treasurySigner.signOffer(sampleOffer()), { ...DOMAIN, ...override })).toBe(false);
  });

  it("binds the verifying contract and rejects zero/invalid addresses", async () => {
    const signed = await treasurySigner.signOffer(sampleOffer());
    expect(await verifyOfferSignature(signed, { verifyingContract: BINDING.principal })).toBe(false);
    for (const verifyingContract of ["0xalice", `0x${"0".repeat(40)}`]) {
      expect(() => new Eip712OfferSigner(KEY_A, { verifyingContract: verifyingContract as Address })).toThrow();
    }
  });

  it.each([
    { duration: 1.5 }, { duration: 0 }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    { yieldBps: -1 }, { nonce: -1n }, { nonce: 1n << 256n }, { capital: 0n },
    { intentId: "0x12" as Hex }, { proposer: "0xalice" as Address },
  ])("fails closed on invalid canonical inputs %#", async (mutation) => {
    await expect(treasurySigner.signOffer(sampleOffer(mutation))).rejects.toThrow();
  });

  it("rejects registry reconstruction with a different intent/counterparty or invalid principal", () => {
    expect(() => toRegistryTerms(sampleOffer(), { ...BINDING, intentId: OTHER_INTENT_ID })).toThrow();
    expect(() => toRegistryTerms(sampleOffer(), { ...BINDING, counterparty: BINDING.principal })).toThrow();
    expect(() => toRegistryTerms(sampleOffer(), { ...BINDING, principal: BINDING.counterparty })).toThrow();
  });

  it("allowlists signed output and never serializes keys/policy, including injected extras", async () => {
    const offer = { ...sampleOffer(), privatePolicy: { salt: "injected-private-value" }, signingKey: KEY_A };
    const signed = await treasurySigner.signOffer(offer);
    const output = serialize([signed, treasurySigner]);
    for (const marker of [...PRIVATE_MARKERS, "injected-private-value", "signingKey"]) expect(output).not.toContain(marker);
    expect(Object.keys(signed).sort()).toEqual([
      "runId", "round", "proposerRole", "intentId", "proposer", "capital", "duration",
      "yieldBps", "expiresAt", "nonce", "signature", "signerAddress",
    ].sort());
  });
});
