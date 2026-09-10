// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { AgreementRegistry } from "./AgreementRegistry.sol";
import { SovereignTypes } from "./SovereignTypes.sol";

contract DecisionSink is Ownable2Step {
    error NotForwarder();
    error ZeroForwarder();
    error ZeroDecisionId();
    error StaleNonce(uint64 provided, uint64 expectedGreaterThan);
    error InvalidCheckKind(uint8 checkKind);
    error NonActionableDecision();
    error CheckKindStateMismatch(uint8 checkKind, AgreementRegistry.AgreementState state);

    event DecisionRecorded(
        bytes32 indexed agreementId, bytes32 decisionId, uint8 checkKind, bool result, uint64 nonce
    );
    event ForwarderUpdated(address indexed forwarder);

    AgreementRegistry public immutable agreementRegistry;
    address public forwarder;

    mapping(bytes32 agreementId => uint64 nonce) public lastNonce;

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder();
        _;
    }

    constructor(
        AgreementRegistry agreementRegistry_,
        address initialForwarder,
        address initialOwner
    ) Ownable(initialOwner) {
        if (initialForwarder == address(0)) revert ZeroForwarder();
        agreementRegistry = agreementRegistry_;
        forwarder = initialForwarder;
        emit ForwarderUpdated(initialForwarder);
    }

    function setForwarder(address newForwarder) external onlyOwner {
        if (newForwarder == address(0)) revert ZeroForwarder();
        forwarder = newForwarder;
        emit ForwarderUpdated(newForwarder);
    }

    function recordDecision(
        bytes32 agreementId,
        bytes32 decisionId,
        uint8 checkKind,
        bool result,
        uint64 nonce
    ) external onlyForwarder {
        if (decisionId == bytes32(0)) revert ZeroDecisionId();
        uint64 previousNonce = lastNonce[agreementId];
        if (nonce <= previousNonce) revert StaleNonce(nonce, previousNonce);

        AgreementRegistry.AgreementState state = agreementRegistry.stateOf(agreementId);
        if (checkKind == SovereignTypes.CHECK_VALIDATION) {
            if (state != AgreementRegistry.AgreementState.PENDING_VALIDATION) {
                revert CheckKindStateMismatch(checkKind, state);
            }
        } else if (checkKind == SovereignTypes.CHECK_BREACH) {
            if (!result) revert NonActionableDecision();
            if (state != AgreementRegistry.AgreementState.ACTIVE) {
                revert CheckKindStateMismatch(checkKind, state);
            }
        } else {
            revert InvalidCheckKind(checkKind);
        }

        lastNonce[agreementId] = nonce;
        emit DecisionRecorded(agreementId, decisionId, checkKind, result, nonce);

        if (checkKind == SovereignTypes.CHECK_VALIDATION) {
            agreementRegistry.applyValidationDecision(agreementId, decisionId, result);
        } else {
            agreementRegistry.applyBreachDecision(agreementId, decisionId, result);
        }
    }
}
