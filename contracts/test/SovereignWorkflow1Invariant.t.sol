// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { AgreementRegistry } from "../src/AgreementRegistry.sol";
import { DecisionSink } from "../src/DecisionSink.sol";
import { IntentRegistry } from "../src/IntentRegistry.sol";
import { SovereignEscrow } from "../src/SovereignEscrow.sol";
import { SovereignTypes } from "../src/SovereignTypes.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";

contract Invariant1271Wallet {
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;
    bytes32 public approvedDigest;

    function approveDigest(bytes32 digest) external {
        approvedDigest = digest;
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        return digest == approvedDigest ? MAGIC_VALUE : bytes4(0xffffffff);
    }
}

contract SovereignInvariantHandler {
    uint256 internal constant CAPITAL = 100_000e6;
    uint256 internal constant MAX_DURATION = 30 days;
    uint256 internal constant DURATION = 21 days;
    uint256 internal constant YIELD_BPS = 880;
    uint256 internal constant EXPIRES_AT = 1_800_000_000;

    bytes32 internal constant POLICY_COMMITMENT =
        0x1915bf97fe0c977a0b489c3d45f36350c8d8615322efeb520b4c4141b65c9a52;

    MockUSDC public immutable usdc;
    IntentRegistry public immutable intents;
    AgreementRegistry public immutable agreements;
    DecisionSink public immutable sink;
    SovereignEscrow public immutable escrow;
    Invariant1271Wallet public immutable counterparty;

    bytes32 public immutable agreementId;
    bytes32 public immutable cancelledAgreementId;
    bytes32 public immutable escrowId = keccak256("invariant-escrow");

    uint64 public observedDecisionNonce;
    bool public validationAccepted;
    bool public agreementRejected;
    bool public agreementCancelled;
    bool public agreementUnwinding;
    bool public agreementSettled;
    bool public breachAccepted;
    bool public safeReportAccepted;
    bool public escrowUnwound;
    bool public escrowSettled;
    bool public escrowRelockSucceeded;

    constructor() {
        usdc = new MockUSDC();
        intents = new IntentRegistry();
        agreements = new AgreementRegistry(intents, address(this));
        sink = new DecisionSink(agreements, address(this), address(this));
        agreements.setDecisionSink(address(sink));
        escrow = new SovereignEscrow(address(usdc), address(this), address(this));
        counterparty = new Invariant1271Wallet();

        bytes32 intentId =
            intents.createIntent(address(usdc), CAPITAL, MAX_DURATION, POLICY_COMMITMENT);
        SovereignTypes.Terms memory terms = SovereignTypes.Terms({
            intentId: intentId,
            principal: address(this),
            counterparty: address(counterparty),
            capital: CAPITAL,
            duration: DURATION,
            yieldBps: YIELD_BPS,
            expiresAt: EXPIRES_AT,
            nonce: 1
        });
        counterparty.approveDigest(SovereignTypes.offerDigest(terms, address(agreements)));
        agreementId = agreements.proposeAgreement(terms, hex"");

        bytes32 cancelledIntentId =
            intents.createIntent(address(usdc), CAPITAL, MAX_DURATION, POLICY_COMMITMENT);
        cancelledAgreementId = agreements.openAgreement(cancelledIntentId);

        usdc.mint(address(this), CAPITAL);
        usdc.approve(address(escrow), CAPITAL);
        escrow.lockAgreement(
            escrowId,
            keccak256("invariant-terms"),
            address(this),
            address(counterparty),
            CAPITAL,
            POLICY_COMMITMENT
        );
    }

    function actionValidation(bool accepted) external {
        try sink.recordDecision(
            agreementId,
            keccak256("invariant-validation"),
            SovereignTypes.CHECK_VALIDATION,
            accepted,
            1
        ) {
            observedDecisionNonce = 1;
            if (accepted) validationAccepted = true;
            else agreementRejected = true;
        } catch { }
    }

    function actionBreach(bool breached) external {
        try sink.recordDecision(
            agreementId, keccak256("invariant-breach"), SovereignTypes.CHECK_BREACH, breached, 2
        ) {
            observedDecisionNonce = 2;
            if (breached) breachAccepted = true;
            else safeReportAccepted = true;
        } catch { }
    }

    function actionReplayValidation() external {
        try sink.recordDecision(
            agreementId, keccak256("invariant-replay"), SovereignTypes.CHECK_VALIDATION, true, 1
        ) {
            observedDecisionNonce = 1;
            validationAccepted = true;
        } catch { }
    }

    function actionCancel() external {
        try agreements.cancelAgreement(cancelledAgreementId) {
            agreementCancelled = true;
        } catch { }
    }

    function actionMarkUnwinding() external {
        try agreements.markUnwinding(agreementId) {
            agreementUnwinding = true;
        } catch { }
    }

    function actionMarkSettled() external {
        try agreements.markSettled(agreementId, 0) {
            agreementSettled = true;
        } catch { }
    }

    function actionEscrowUnwind() external {
        try escrow.unwind(escrowId, keccak256("invariant-breach")) {
            escrowUnwound = true;
        } catch { }
    }

    function actionEscrowSettle() external {
        try escrow.settle(escrowId, CAPITAL, 0) {
            escrowSettled = true;
        } catch { }
    }

    function actionEscrowRelock() external {
        try escrow.lockAgreement(
            escrowId,
            keccak256("invariant-relock"),
            address(this),
            address(counterparty),
            CAPITAL,
            POLICY_COMMITMENT
        ) {
            escrowRelockSucceeded = true;
        } catch { }
    }

    function agreementState() external view returns (AgreementRegistry.AgreementState) {
        return agreements.stateOf(agreementId);
    }

    function cancelledState() external view returns (AgreementRegistry.AgreementState) {
        return agreements.stateOf(cancelledAgreementId);
    }

    function escrowState() external view returns (SovereignEscrow.EscrowState) {
        (,,,,,, SovereignEscrow.EscrowState state) = escrow.escrows(escrowId);
        return state;
    }

    function currentDecisionNonce() external view returns (uint64) {
        return sink.lastNonce(agreementId);
    }
}

contract SovereignWorkflow1InvariantTest is StdInvariant {
    SovereignInvariantHandler internal handler;

    function setUp() public {
        handler = new SovereignInvariantHandler();
        targetContract(address(handler));
    }

    function invariant_terminalAgreementStatesAreFinal() public view {
        AgreementRegistry.AgreementState state = handler.agreementState();
        if (handler.agreementRejected()) {
            require(state == AgreementRegistry.AgreementState.REJECTED, "rejected state regressed");
        }
        if (handler.agreementUnwinding()) {
            require(
                state == AgreementRegistry.AgreementState.UNWIND
                    || state == AgreementRegistry.AgreementState.SETTLED,
                "unwind state regressed"
            );
        }
        if (handler.agreementSettled()) {
            require(state == AgreementRegistry.AgreementState.SETTLED, "settled state regressed");
        }
    }

    function invariant_cancelledAgreementCannotActivate() public view {
        if (handler.agreementCancelled()) {
            require(
                handler.cancelledState() == AgreementRegistry.AgreementState.CANCELLED,
                "cancelled state changed"
            );
        }
    }

    function invariant_validationCannotRunAfterActivation() public view {
        if (handler.validationAccepted()) {
            AgreementRegistry.AgreementState state = handler.agreementState();
            require(
                state == AgreementRegistry.AgreementState.ACTIVE
                    || state == AgreementRegistry.AgreementState.BREACHED
                    || state == AgreementRegistry.AgreementState.UNWIND
                    || state == AgreementRegistry.AgreementState.SETTLED,
                "validation state regressed"
            );
        }
    }

    function invariant_breachOnlyFollowsActivation() public view {
        if (handler.breachAccepted()) {
            require(handler.validationAccepted(), "breach occurred before activation");
        }
    }

    function invariant_safeReportsAreNeverAccepted() public view {
        require(!handler.safeReportAccepted(), "SAFE report accepted");
    }

    function invariant_decisionNonceNeverRegresses() public view {
        require(
            handler.currentDecisionNonce() == handler.observedDecisionNonce(),
            "decision nonce changed unexpectedly"
        );
    }

    function invariant_escrowTerminalStatesAreFinal() public view {
        SovereignEscrow.EscrowState state = handler.escrowState();
        if (handler.escrowUnwound()) {
            require(state == SovereignEscrow.EscrowState.UNWOUND, "unwound escrow changed");
        }
        if (handler.escrowSettled()) {
            require(state == SovereignEscrow.EscrowState.SETTLED, "settled escrow changed");
        }
    }

    function invariant_escrowCannotBeLockedTwice() public view {
        require(!handler.escrowRelockSucceeded(), "escrow was locked twice");
    }
}
