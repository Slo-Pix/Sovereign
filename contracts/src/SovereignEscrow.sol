// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SovereignEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroToken();
    error ZeroRelayer();
    error ZeroAddress();
    error ZeroCapital();
    error ZeroAgreementId();
    error ZeroTermsHash();
    error ZeroPolicyCommitment();
    error SameParticipant();
    error NotRelayer();
    error EscrowAlreadyExists();
    error UnknownEscrow();
    error InvalidEscrowState(EscrowState state);
    error InvalidSettlement(uint256 principalReturn, uint256 counterpartyReturn, uint256 capital);

    enum EscrowState {
        NONE,
        ACTIVE,
        UNWOUND,
        SETTLED
    }

    struct Escrow {
        bytes32 agreementId;
        bytes32 termsHash;
        address principal;
        address counterparty;
        uint256 capital;
        bytes32 policyCommitment;
        EscrowState state;
    }

    event RelayerUpdated(address indexed relayer);
    event EscrowLocked(
        bytes32 indexed agreementId,
        bytes32 indexed termsHash,
        address indexed principal,
        address counterparty,
        uint256 capital,
        bytes32 policyCommitment
    );
    event EscrowUnwound(bytes32 indexed agreementId, bytes32 indexed decisionId, uint256 returned);
    event EscrowSettled(
        bytes32 indexed agreementId,
        uint256 principalReturn,
        uint256 counterpartyReturn,
        uint256 retained
    );

    IERC20 public immutable token;
    address public relayer;

    mapping(bytes32 agreementId => Escrow escrow) public escrows;

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address token_, address relayer_, address initialOwner) Ownable(initialOwner) {
        if (token_ == address(0)) revert ZeroToken();
        if (relayer_ == address(0)) revert ZeroRelayer();
        token = IERC20(token_);
        relayer = relayer_;
        emit RelayerUpdated(relayer_);
    }

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroRelayer();
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function lockAgreement(
        bytes32 agreementId,
        bytes32 termsHash,
        address principal,
        address counterparty,
        uint256 capital,
        bytes32 policyCommitment
    ) external onlyRelayer nonReentrant {
        if (agreementId == bytes32(0)) revert ZeroAgreementId();
        if (termsHash == bytes32(0)) revert ZeroTermsHash();
        if (principal == address(0) || counterparty == address(0)) {
            revert ZeroAddress();
        }
        if (principal == counterparty) revert SameParticipant();
        if (capital == 0) revert ZeroCapital();
        if (policyCommitment == bytes32(0)) revert ZeroPolicyCommitment();
        if (escrows[agreementId].state != EscrowState.NONE) revert EscrowAlreadyExists();

        token.safeTransferFrom(principal, address(this), capital);

        escrows[agreementId] = Escrow({
            agreementId: agreementId,
            termsHash: termsHash,
            principal: principal,
            counterparty: counterparty,
            capital: capital,
            policyCommitment: policyCommitment,
            state: EscrowState.ACTIVE
        });

        emit EscrowLocked(
            agreementId, termsHash, principal, counterparty, capital, policyCommitment
        );
    }

    function unwind(bytes32 agreementId, bytes32 decisionId) external onlyRelayer nonReentrant {
        Escrow storage escrow = escrows[agreementId];
        if (escrow.state == EscrowState.NONE) revert UnknownEscrow();
        if (escrow.state != EscrowState.ACTIVE) revert InvalidEscrowState(escrow.state);

        escrow.state = EscrowState.UNWOUND;
        token.safeTransfer(escrow.principal, escrow.capital);

        emit EscrowUnwound(agreementId, decisionId, escrow.capital);
    }

    function settle(bytes32 agreementId, uint256 principalReturn, uint256 counterpartyReturn)
        external
        onlyRelayer
        nonReentrant
    {
        Escrow storage escrow = escrows[agreementId];
        if (escrow.state == EscrowState.NONE) revert UnknownEscrow();
        if (escrow.state != EscrowState.ACTIVE) revert InvalidEscrowState(escrow.state);
        if (principalReturn + counterpartyReturn > escrow.capital) {
            revert InvalidSettlement(principalReturn, counterpartyReturn, escrow.capital);
        }

        escrow.state = EscrowState.SETTLED;
        if (principalReturn != 0) token.safeTransfer(escrow.principal, principalReturn);
        if (counterpartyReturn != 0) token.safeTransfer(escrow.counterparty, counterpartyReturn);

        emit EscrowSettled(
            agreementId,
            principalReturn,
            counterpartyReturn,
            escrow.capital - principalReturn - counterpartyReturn
        );
    }
}
