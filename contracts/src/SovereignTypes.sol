// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library SovereignTypes {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    uint8 internal constant CHECK_VALIDATION = 1;
    uint8 internal constant CHECK_BREACH = 2;

    bytes32 internal constant OFFER_TYPEHASH = keccak256(
        "Offer(bytes32 intentId,address proposer,uint256 capital,uint256 duration,uint256 yieldBps,uint256 expiresAt,uint256 nonce)"
    );

    struct Policy {
        uint256 minYieldBps;
        uint256 maxLossBps;
        uint256 maxDuration;
        bytes32 salt;
    }

    struct Terms {
        bytes32 intentId;
        address principal;
        address counterparty;
        uint256 capital;
        uint256 duration;
        uint256 yieldBps;
        uint256 expiresAt;
        uint256 nonce;
    }

    struct Offer {
        bytes32 intentId;
        address proposer;
        uint256 capital;
        uint256 duration;
        uint256 yieldBps;
        uint256 expiresAt;
        uint256 nonce;
    }

    function hashPolicy(Policy memory policy) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(policy.minYieldBps, policy.maxLossBps, policy.maxDuration, policy.salt)
        );
    }

    function hashTerms(Terms memory terms) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                terms.intentId,
                terms.principal,
                terms.counterparty,
                terms.capital,
                terms.duration,
                terms.yieldBps,
                terms.expiresAt,
                terms.nonce
            )
        );
    }

    function hashOffer(Offer memory offer) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OFFER_TYPEHASH,
                offer.intentId,
                offer.proposer,
                offer.capital,
                offer.duration,
                offer.yieldBps,
                offer.expiresAt,
                offer.nonce
            )
        );
    }

    function hashOfferFromTerms(Terms memory terms) internal pure returns (bytes32) {
        return hashOffer(
            Offer({
                intentId: terms.intentId,
                proposer: terms.counterparty,
                capital: terms.capital,
                duration: terms.duration,
                yieldBps: terms.yieldBps,
                expiresAt: terms.expiresAt,
                nonce: terms.nonce
            })
        );
    }

    function domainSeparator(address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Sovereign")),
                keccak256(bytes("1")),
                SEPOLIA_CHAIN_ID,
                verifyingContract
            )
        );
    }

    function offerDigest(Terms memory terms, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                bytes2(0x1901), domainSeparator(verifyingContract), hashOfferFromTerms(terms)
            )
        );
    }
}
