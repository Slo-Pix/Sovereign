// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { SovereignTypes } from "./SovereignTypes.sol";
import { IntentRegistry } from "./IntentRegistry.sol";

contract AgreementRegistry is Ownable2Step {
    error UnknownIntent();
    error UnknownAgreement();
    error AgreementAlreadyExists();
    error ExpiredOffer();
    error InvalidPrincipal();
    error InvalidCounterparty();
    error InvalidCapital();
    error InvalidDuration();
    error InvalidSignature(address expected);
    error NotParticipant();
    error NotDecisionSink();
    error InvalidState(AgreementState current);
    error ZeroDecisionSink();
    error UnknownOpenAgreement();

    enum AgreementState {
        NONE,
        OPEN,
        NEGOTIATING,
        PENDING_VALIDATION,
        ACTIVE,
        BREACHED,
        UNWIND,
        SETTLED,
        CANCELLED,
        REJECTED
    }

    struct Agreement {
        bytes32 id;
        bytes32 intentId;
        address principal;
        address counterparty;
        uint256 capital;
        uint256 duration;
        uint256 yieldBps;
        bytes32 termsHash;
        bytes32 policyCommitment;
        AgreementState state;
    }

    event AgreementProposed(
        bytes32 indexed agreementId, bytes32 indexed intentId, bytes32 termsHash
    );
    event AgreementOpened(bytes32 indexed agreementId, bytes32 indexed intentId);
    event AgreementNegotiating(bytes32 indexed agreementId, address indexed counterparty);
    event ValidationRequested(bytes32 indexed agreementId, uint8 checkKind);
    event AgreementActivated(bytes32 indexed agreementId);
    event AgreementBreached(bytes32 indexed agreementId, bytes32 decisionId);
    event AgreementUnwinding(bytes32 indexed agreementId);
    event AgreementSettled(bytes32 indexed agreementId, uint256 returned);
    event AgreementCancelled(bytes32 indexed agreementId);
    event AgreementRejected(bytes32 indexed agreementId, bytes32 decisionId);
    event DecisionSinkUpdated(address indexed decisionSink);

    IntentRegistry public immutable intentRegistry;
    address public decisionSink;

    mapping(bytes32 agreementId => Agreement agreement) public agreements;
    mapping(bytes32 intentId => bytes32 agreementId) public openAgreementByIntent;

    modifier onlyDecisionSink() {
        if (_msgSender() != decisionSink) revert NotDecisionSink();
        _;
    }

    constructor(IntentRegistry intentRegistry_, address initialOwner) Ownable(initialOwner) {
        intentRegistry = intentRegistry_;
    }

    function setDecisionSink(address newDecisionSink) external onlyOwner {
        if (newDecisionSink == address(0)) revert ZeroDecisionSink();
        decisionSink = newDecisionSink;
        emit DecisionSinkUpdated(newDecisionSink);
    }

    function openAgreement(bytes32 intentId) external returns (bytes32 agreementId) {
        IntentRegistry.Intent memory intent = intentRegistry.getIntent(intentId);
        if (intent.creator == address(0)) revert UnknownIntent();
        if (msg.sender != intent.creator) revert InvalidPrincipal();
        if (openAgreementByIntent[intentId] != bytes32(0)) revert AgreementAlreadyExists();

        agreementId = keccak256(abi.encode(intentId, msg.sender, address(this)));
        openAgreementByIntent[intentId] = agreementId;
        agreements[agreementId] = Agreement({
            id: agreementId,
            intentId: intentId,
            principal: msg.sender,
            counterparty: address(0),
            capital: 0,
            duration: 0,
            yieldBps: 0,
            termsHash: bytes32(0),
            policyCommitment: intent.policyCommitment,
            state: AgreementState.OPEN
        });

        emit AgreementOpened(agreementId, intentId);
    }

    function beginNegotiation(bytes32 agreementId, address counterparty) external {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownOpenAgreement();
        if (agreement.state != AgreementState.OPEN) revert InvalidState(agreement.state);
        if (msg.sender != agreement.principal) revert InvalidPrincipal();
        if (counterparty == address(0) || counterparty == msg.sender) {
            revert InvalidCounterparty();
        }

        agreement.counterparty = counterparty;
        agreement.state = AgreementState.NEGOTIATING;
        emit AgreementNegotiating(agreementId, counterparty);
    }

    function finalizeAgreement(
        bytes32 agreementId,
        SovereignTypes.Terms calldata terms,
        bytes calldata counterpartySignature
    ) external {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownOpenAgreement();
        if (agreement.state != AgreementState.NEGOTIATING) revert InvalidState(agreement.state);
        if (msg.sender != agreement.principal) revert InvalidPrincipal();
        if (terms.intentId != agreement.intentId || terms.principal != agreement.principal) {
            revert InvalidPrincipal();
        }
        if (terms.counterparty != agreement.counterparty) revert InvalidCounterparty();

        IntentRegistry.Intent memory intent = intentRegistry.getIntent(terms.intentId);
        bytes32 termsHash = _validateTerms(intent, terms, counterpartySignature);
        _setFinalTerms(agreement, terms, termsHash);

        emit AgreementProposed(agreementId, terms.intentId, termsHash);
        emit ValidationRequested(agreementId, SovereignTypes.CHECK_VALIDATION);
    }

    function proposeAgreement(
        SovereignTypes.Terms calldata terms,
        bytes calldata counterpartySignature
    ) external returns (bytes32 agreementId) {
        IntentRegistry.Intent memory intent = intentRegistry.getIntent(terms.intentId);
        if (intent.creator == address(0)) revert UnknownIntent();
        if (msg.sender != terms.principal) revert InvalidPrincipal();
        if (terms.principal != intent.creator) revert InvalidPrincipal();
        if (terms.counterparty == address(0) || terms.counterparty == terms.principal) {
            revert InvalidCounterparty();
        }
        bytes32 termsHash = _validateTerms(intent, terms, counterpartySignature);
        agreementId = keccak256(
            abi.encode(
                termsHash,
                intent.policyCommitment,
                terms.principal,
                terms.counterparty,
                address(this)
            )
        );
        if (agreements[agreementId].state != AgreementState.NONE) revert AgreementAlreadyExists();

        agreements[agreementId] = Agreement({
            id: agreementId,
            intentId: terms.intentId,
            principal: terms.principal,
            counterparty: terms.counterparty,
            capital: terms.capital,
            duration: terms.duration,
            yieldBps: terms.yieldBps,
            termsHash: termsHash,
            policyCommitment: intent.policyCommitment,
            state: AgreementState.PENDING_VALIDATION
        });

        emit AgreementProposed(agreementId, terms.intentId, termsHash);
        emit ValidationRequested(agreementId, SovereignTypes.CHECK_VALIDATION);
    }

    function cancelAgreement(bytes32 agreementId) external {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownAgreement();
        if (msg.sender != agreement.principal && msg.sender != agreement.counterparty) {
            revert NotParticipant();
        }
        if (
            agreement.state != AgreementState.OPEN && agreement.state != AgreementState.NEGOTIATING
                && agreement.state != AgreementState.PENDING_VALIDATION
        ) {
            revert InvalidState(agreement.state);
        }

        agreement.state = AgreementState.CANCELLED;
        emit AgreementCancelled(agreementId);
    }

    function applyValidationDecision(bytes32 agreementId, bytes32 decisionId, bool accepted)
        external
        onlyDecisionSink
    {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownAgreement();
        if (agreement.state != AgreementState.PENDING_VALIDATION) {
            revert InvalidState(agreement.state);
        }

        if (accepted) {
            agreement.state = AgreementState.ACTIVE;
            emit AgreementActivated(agreementId);
        } else {
            agreement.state = AgreementState.REJECTED;
            emit AgreementRejected(agreementId, decisionId);
        }
    }

    function applyBreachDecision(bytes32 agreementId, bytes32 decisionId, bool breached)
        external
        onlyDecisionSink
    {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownAgreement();
        if (agreement.state != AgreementState.ACTIVE) revert InvalidState(agreement.state);

        if (breached) {
            agreement.state = AgreementState.BREACHED;
            emit AgreementBreached(agreementId, decisionId);
        }
    }

    function markSettled(bytes32 agreementId, uint256 returnedAmount) external onlyOwner {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownAgreement();
        if (
            agreement.state != AgreementState.ACTIVE && agreement.state != AgreementState.BREACHED
                && agreement.state != AgreementState.UNWIND
        ) {
            revert InvalidState(agreement.state);
        }

        agreement.state = AgreementState.SETTLED;
        emit AgreementSettled(agreementId, returnedAmount);
    }

    function markUnwinding(bytes32 agreementId) external onlyOwner {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.state == AgreementState.NONE) revert UnknownAgreement();
        if (agreement.state != AgreementState.BREACHED) {
            revert InvalidState(agreement.state);
        }

        agreement.state = AgreementState.UNWIND;
        emit AgreementUnwinding(agreementId);
    }

    function stateOf(bytes32 agreementId) external view returns (AgreementState) {
        AgreementState current = agreements[agreementId].state;
        if (current == AgreementState.NONE) revert UnknownAgreement();
        return current;
    }

    function _validateTerms(
        IntentRegistry.Intent memory intent,
        SovereignTypes.Terms calldata terms,
        bytes calldata counterpartySignature
    ) internal view returns (bytes32 termsHash) {
        if (terms.capital == 0 || terms.capital > intent.capital) revert InvalidCapital();
        if (terms.duration == 0 || terms.duration > intent.maxDuration) revert InvalidDuration();
        if (block.timestamp > terms.expiresAt) revert ExpiredOffer();

        bytes32 digest = SovereignTypes.offerDigest(terms, address(this));
        if (!SignatureChecker.isValidSignatureNowCalldata(
                terms.counterparty, digest, counterpartySignature
            )) {
            revert InvalidSignature(terms.counterparty);
        }

        termsHash = SovereignTypes.hashTerms(terms);
    }

    function _setFinalTerms(
        Agreement storage agreement,
        SovereignTypes.Terms calldata terms,
        bytes32 termsHash
    ) internal {
        agreement.capital = terms.capital;
        agreement.duration = terms.duration;
        agreement.yieldBps = terms.yieldBps;
        agreement.termsHash = termsHash;
        agreement.state = AgreementState.PENDING_VALIDATION;
    }
}
