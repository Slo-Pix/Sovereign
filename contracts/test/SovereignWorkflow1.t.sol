// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { AgreementRegistry } from "../src/AgreementRegistry.sol";
import { DecisionSink } from "../src/DecisionSink.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";
import { SovereignEscrow } from "../src/SovereignEscrow.sol";
import { SovereignTypes } from "../src/SovereignTypes.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

contract Actor {
    function createIntent(
        IntentRegistry registry,
        address asset,
        uint256 capital,
        uint256 maxDuration,
        bytes32 policyCommitment
    ) external returns (bytes32) {
        return registry.createIntent(asset, capital, maxDuration, policyCommitment);
    }

    function propose(
        AgreementRegistry registry,
        SovereignTypes.Terms calldata terms,
        bytes calldata signature
    ) external returns (bytes32) {
        return registry.proposeAgreement(terms, signature);
    }

    function open(AgreementRegistry registry, bytes32 intentId) external returns (bytes32) {
        return registry.openAgreement(intentId);
    }

    function negotiate(AgreementRegistry registry, bytes32 agreementId, address counterparty)
        external
    {
        registry.beginNegotiation(agreementId, counterparty);
    }

    function finalize(
        AgreementRegistry registry,
        bytes32 agreementId,
        SovereignTypes.Terms calldata terms,
        bytes calldata signature
    ) external {
        registry.finalizeAgreement(agreementId, terms, signature);
    }

    function approve(MockUSDC token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function recordDecision(
        DecisionSink sink,
        bytes32 agreementId,
        bytes32 decisionId,
        uint8 checkKind,
        bool result,
        uint64 nonce
    ) external {
        sink.recordDecision(agreementId, decisionId, checkKind, result, nonce);
    }

    function acceptOwnership(AgreementRegistry registry) external {
        registry.acceptOwnership();
    }
}

contract MockERC1271Wallet {
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;
    bytes32 public approvedDigest;

    function approveDigest(bytes32 digest) external {
        approvedDigest = digest;
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        return digest == approvedDigest ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

contract SovereignWorkflow1Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant COUNTERPARTY_PK = 0xB0B;
    uint256 internal constant CAPITAL = 100_000e6;
    uint256 internal constant MAX_DURATION = 30 days;
    uint256 internal constant DURATION = 21 days;
    uint256 internal constant YIELD_BPS = 880;
    uint256 internal constant EXPIRES_AT = 1_800_000_000;

    bytes32 internal constant POLICY_SALT =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant POLICY_VECTOR =
        0x1915bf97fe0c977a0b489c3d45f36350c8d8615322efeb520b4c4141b65c9a52;
    bytes32 internal constant TERMS_INTENT_ID =
        0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
    bytes32 internal constant TERMS_VECTOR =
        0x6e6cb528d3b35f064aa6bd7846569e3d1b33cda81eb113fd1a21e727dca9c7b0;

    IntentRegistry internal intents;
    AgreementRegistry internal agreements;
    DecisionSink internal sink;
    SovereignEscrow internal escrow;
    MockUSDC internal usdc;
    Actor internal principal;
    Actor internal outsider;
    address internal counterparty;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_790_000_000);

        counterparty = vm.addr(COUNTERPARTY_PK);
        principal = new Actor();
        outsider = new Actor();

        usdc = new MockUSDC();
        intents = new IntentRegistry();
        agreements = new AgreementRegistry(intents, address(this));
        sink = new DecisionSink(agreements, address(this), address(this));
        agreements.setDecisionSink(address(sink));
        escrow = new SovereignEscrow(address(usdc), address(this), address(this));
    }

    function testPolicyHashMatchesFrozenVector() public pure {
        bytes32 actual = SovereignTypes.hashPolicy(
            SovereignTypes.Policy({
                minYieldBps: 800, maxLossBps: 300, maxDuration: MAX_DURATION, salt: POLICY_SALT
            })
        );
        assertEq(actual, POLICY_VECTOR, "policy commitment mismatch");
    }

    function testTermsHashMatchesFrozenVector() public pure {
        bytes32 actual = SovereignTypes.hashTerms(
            SovereignTypes.Terms({
                intentId: TERMS_INTENT_ID,
                principal: 0x1111111111111111111111111111111111111111,
                counterparty: 0x2222222222222222222222222222222222222222,
                capital: CAPITAL,
                duration: DURATION,
                yieldBps: YIELD_BPS,
                expiresAt: EXPIRES_AT,
                nonce: 1
            })
        );
        assertEq(actual, TERMS_VECTOR, "terms hash mismatch");
    }

    function testFuzzPolicySaltChangesCommitment(bytes32 firstSalt, bytes32 secondSalt)
        public
        pure
    {
        if (firstSalt == secondSalt) return;
        bytes32 first = SovereignTypes.hashPolicy(
            SovereignTypes.Policy({
                minYieldBps: 800, maxLossBps: 300, maxDuration: MAX_DURATION, salt: firstSalt
            })
        );
        bytes32 second = SovereignTypes.hashPolicy(
            SovereignTypes.Policy({
                minYieldBps: 800, maxLossBps: 300, maxDuration: MAX_DURATION, salt: secondSalt
            })
        );
        assertFalse(first == second, "distinct salted policies collided");
    }

    function testFuzzTermsHashChangesNonce(uint256 firstNonce, uint256 secondNonce) public pure {
        if (firstNonce == secondNonce) return;
        SovereignTypes.Terms memory first = _fixtureTerms(firstNonce);
        SovereignTypes.Terms memory second = _fixtureTerms(secondNonce);
        assertFalse(
            SovereignTypes.hashTerms(first) == SovereignTypes.hashTerms(second),
            "distinct terms collided"
        );
    }

    function testAgreementLifecycleRecordsValidationAndBreach() public {
        bytes32 agreementId = _proposeAgreement();

        assertState(agreementId, AgreementRegistry.AgreementState.PENDING_VALIDATION);

        sink.recordDecision(
            agreementId, keccak256("validation-accepted"), SovereignTypes.CHECK_VALIDATION, true, 1
        );
        assertState(agreementId, AgreementRegistry.AgreementState.ACTIVE);

        bool staleNonceRejected = _tryRecord(
            agreementId, keccak256("stale-safe"), SovereignTypes.CHECK_BREACH, false, 1
        );
        assertFalse(staleNonceRejected, "stale nonce accepted");

        sink.recordDecision(
            agreementId, keccak256("breach-detected"), SovereignTypes.CHECK_BREACH, true, 2
        );
        assertState(agreementId, AgreementRegistry.AgreementState.BREACHED);

        agreements.markUnwinding(agreementId);
        assertState(agreementId, AgreementRegistry.AgreementState.UNWIND);
        agreements.markSettled(agreementId, 0);
        assertState(agreementId, AgreementRegistry.AgreementState.SETTLED);
    }

    function testAgreementLifecycleIncludesOpenAndNegotiating() public {
        bytes32 intentId =
            principal.createIntent(intents, address(usdc), CAPITAL, MAX_DURATION, POLICY_VECTOR);
        bytes32 agreementId = principal.open(agreements, intentId);
        assertState(agreementId, AgreementRegistry.AgreementState.OPEN);

        principal.negotiate(agreements, agreementId, counterparty);
        assertState(agreementId, AgreementRegistry.AgreementState.NEGOTIATING);

        SovereignTypes.Terms memory terms = SovereignTypes.Terms({
            intentId: intentId,
            principal: address(principal),
            counterparty: counterparty,
            capital: CAPITAL,
            duration: DURATION,
            yieldBps: YIELD_BPS,
            expiresAt: EXPIRES_AT,
            nonce: 7
        });
        principal.finalize(agreements, agreementId, terms, _signCounterpartyOffer(terms));
        assertState(agreementId, AgreementRegistry.AgreementState.PENDING_VALIDATION);
    }

    function testFuzzSafeReportPreservesStateAndNonce(uint64 proposedNonce) public {
        bytes32 agreementId = _proposeAgreement();
        sink.recordDecision(agreementId, keccak256("accepted"), 1, true, 1);
        uint64 nonce = proposedNonce < 2 ? 2 : proposedNonce;
        (bool success, bytes memory reason) = address(sink)
            .call(
                abi.encodeCall(
                    DecisionSink.recordDecision,
                    (agreementId, keccak256("safe"), uint8(2), false, nonce)
                )
            );
        require(!success, "SAFE report accepted");
        assertEq(
            keccak256(reason),
            keccak256(abi.encodeWithSelector(DecisionSink.NonActionableDecision.selector)),
            "unexpected revert"
        );
        assertEq(sink.lastNonce(agreementId), 1, "SAFE report consumed nonce");
        assertState(agreementId, AgreementRegistry.AgreementState.ACTIVE);
        // The rejected report must not prevent a real breach using the same nonce.
        sink.recordDecision(agreementId, keccak256("breached"), 2, true, nonce);
        assertEq(sink.lastNonce(agreementId), nonce, "breach nonce missing");
        assertState(agreementId, AgreementRegistry.AgreementState.BREACHED);
    }

    function testOnlyForwarderMayRecordDecision() public {
        bytes32 agreementId = _proposeAgreement();

        bool ok = _actorRecord(
            outsider,
            agreementId,
            keccak256("forged-validation"),
            SovereignTypes.CHECK_VALIDATION,
            true,
            1
        );

        assertFalse(ok, "non-forwarder recorded decision");
    }

    function testAdministrativeOwnershipTransferRequiresAcceptance() public {
        agreements.transferOwnership(address(outsider));
        assertEq(agreements.owner(), address(this), "ownership changed before acceptance");
        assertEq(agreements.pendingOwner(), address(outsider), "pending owner not recorded");

        outsider.acceptOwnership(agreements);
        assertEq(agreements.owner(), address(outsider), "ownership was not accepted");
        assertEq(agreements.pendingOwner(), address(0), "pending owner was not cleared");
    }

    function testFinalOfferAcceptsERC1271CounterpartyWallet() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        bytes32 intentId =
            principal.createIntent(intents, address(usdc), CAPITAL, MAX_DURATION, POLICY_VECTOR);
        SovereignTypes.Terms memory terms = SovereignTypes.Terms({
            intentId: intentId,
            principal: address(principal),
            counterparty: address(wallet),
            capital: CAPITAL,
            duration: DURATION,
            yieldBps: YIELD_BPS,
            expiresAt: EXPIRES_AT,
            nonce: 1
        });
        wallet.approveDigest(SovereignTypes.offerDigest(terms, address(agreements)));

        bytes32 agreementId = principal.propose(agreements, terms, hex"");
        assertState(agreementId, AgreementRegistry.AgreementState.PENDING_VALIDATION);
    }

    function testCheckKindMustMatchAgreementState() public {
        bytes32 agreementId = _proposeAgreement();

        bool ok = _tryRecord(
            agreementId, keccak256("early-breach"), SovereignTypes.CHECK_BREACH, true, 1
        );

        assertFalse(ok, "breach check accepted before activation");
    }

    function testRejectedAgreementCannotBeActivatedOrBreached() public {
        bytes32 agreementId = _proposeAgreement();
        sink.recordDecision(
            agreementId, keccak256("validation-rejected"), SovereignTypes.CHECK_VALIDATION, false, 1
        );

        bool validationAgain = _tryRecord(
            agreementId, keccak256("validation-again"), SovereignTypes.CHECK_VALIDATION, true, 2
        );
        bool breach = _tryRecord(
            agreementId, keccak256("breach-after-rejection"), SovereignTypes.CHECK_BREACH, true, 2
        );
        assertFalse(validationAgain, "rejected agreement was activated");
        assertFalse(breach, "rejected agreement was breached");
        assertState(agreementId, AgreementRegistry.AgreementState.REJECTED);
    }

    function testSettledEscrowCannotBeReused() public {
        bytes32 agreementId = keccak256("settled-agreement");
        usdc.mint(address(principal), CAPITAL);
        principal.approve(usdc, address(escrow), CAPITAL);
        escrow.lockAgreement(
            agreementId,
            keccak256("settled-terms"),
            address(principal),
            counterparty,
            CAPITAL,
            POLICY_VECTOR
        );
        escrow.settle(agreementId, CAPITAL, 0);

        bool relock = _tryRelock(agreementId);
        bool unwind = _tryUnwind(agreementId);
        assertFalse(relock, "settled escrow was relocked");
        assertFalse(unwind, "settled escrow was unwound");
    }

    function testEscrowLockUnwindAndSettlePaths() public {
        bytes32 agreementId = keccak256("agreement-one");
        bytes32 termsHash = keccak256("terms-one");

        usdc.mint(address(principal), CAPITAL);
        principal.approve(usdc, address(escrow), CAPITAL);

        escrow.lockAgreement(
            agreementId, termsHash, address(principal), counterparty, CAPITAL, POLICY_VECTOR
        );

        assertEq(usdc.balanceOf(address(escrow)), CAPITAL, "escrow did not receive capital");
        escrow.unwind(agreementId, keccak256("breach-decision"));
        assertEq(usdc.balanceOf(address(principal)), CAPITAL, "principal not restored");

        Actor settlementPrincipal = new Actor();
        bytes32 secondAgreementId = keccak256("agreement-two");
        usdc.mint(address(settlementPrincipal), CAPITAL);
        settlementPrincipal.approve(usdc, address(escrow), CAPITAL);
        escrow.lockAgreement(
            secondAgreementId,
            keccak256("terms-two"),
            address(settlementPrincipal),
            counterparty,
            CAPITAL,
            POLICY_VECTOR
        );

        escrow.settle(secondAgreementId, 90_000e6, 10_000e6);
        assertEq(
            usdc.balanceOf(address(settlementPrincipal)), 90_000e6, "principal settlement wrong"
        );
        assertEq(usdc.balanceOf(counterparty), 10_000e6, "counterparty settlement wrong");
    }

    function _proposeAgreement() internal returns (bytes32 agreementId) {
        bytes32 intentId =
            principal.createIntent(intents, address(usdc), CAPITAL, MAX_DURATION, POLICY_VECTOR);

        SovereignTypes.Terms memory terms = SovereignTypes.Terms({
            intentId: intentId,
            principal: address(principal),
            counterparty: counterparty,
            capital: CAPITAL,
            duration: DURATION,
            yieldBps: YIELD_BPS,
            expiresAt: EXPIRES_AT,
            nonce: 1
        });

        bytes memory signature = _signCounterpartyOffer(terms);
        agreementId = principal.propose(agreements, terms, signature);
    }

    function _signCounterpartyOffer(SovereignTypes.Terms memory terms)
        internal
        returns (bytes memory)
    {
        bytes32 digest = SovereignTypes.offerDigest(terms, address(agreements));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(COUNTERPARTY_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _fixtureTerms(uint256 nonce) internal pure returns (SovereignTypes.Terms memory) {
        return SovereignTypes.Terms({
            intentId: TERMS_INTENT_ID,
            principal: 0x1111111111111111111111111111111111111111,
            counterparty: 0x2222222222222222222222222222222222222222,
            capital: CAPITAL,
            duration: DURATION,
            yieldBps: YIELD_BPS,
            expiresAt: EXPIRES_AT,
            nonce: nonce
        });
    }

    function _tryRelock(bytes32 agreementId) internal returns (bool ok) {
        (ok,) = address(escrow)
            .call(
                abi.encodeCall(
                    SovereignEscrow.lockAgreement,
                    (
                        agreementId,
                        keccak256("relock-terms"),
                        address(principal),
                        counterparty,
                        CAPITAL,
                        POLICY_VECTOR
                    )
                )
            );
    }

    function _tryUnwind(bytes32 agreementId) internal returns (bool ok) {
        (ok,) = address(escrow)
            .call(abi.encodeCall(SovereignEscrow.unwind, (agreementId, keccak256("late-unwind"))));
    }

    function _tryRecord(
        bytes32 agreementId,
        bytes32 decisionId,
        uint8 checkKind,
        bool result,
        uint64 nonce
    ) internal returns (bool ok) {
        (ok,) = address(sink)
            .call(
                abi.encodeCall(
                    DecisionSink.recordDecision, (agreementId, decisionId, checkKind, result, nonce)
                )
            );
    }

    function _actorRecord(
        Actor actor,
        bytes32 agreementId,
        bytes32 decisionId,
        uint8 checkKind,
        bool result,
        uint64 nonce
    ) internal returns (bool ok) {
        (ok,) = address(actor)
            .call(
                abi.encodeCall(
                    Actor.recordDecision, (sink, agreementId, decisionId, checkKind, result, nonce)
                )
            );
    }

    function assertState(bytes32 agreementId, AgreementRegistry.AgreementState expected)
        internal
        view
    {
        AgreementRegistry.AgreementState actual = agreements.stateOf(agreementId);
        assertEq(uint256(actual), uint256(expected), "unexpected agreement state");
    }

    function assertEq(bytes32 actual, bytes32 expected, string memory message) internal pure {
        require(actual == expected, message);
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) internal pure {
        require(actual == expected, message);
    }

    function assertEq(address actual, address expected, string memory message) internal pure {
        require(actual == expected, message);
    }

    function assertFalse(bool value, string memory message) internal pure {
        require(!value, message);
    }
}
