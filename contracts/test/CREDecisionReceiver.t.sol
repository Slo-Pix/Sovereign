// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { SovereignWorkflow1Test } from "./SovereignWorkflow1.t.sol";
import { CREDecisionReceiver } from "../src/CREDecisionReceiver.sol";
import { AgreementRegistry } from "../src/AgreementRegistry.sol";

contract CREDecisionReceiverTest is SovereignWorkflow1Test {
    bytes32 constant WORKFLOW = keccak256("test-workflow");

    function receiver() internal returns (CREDecisionReceiver target) {
        target = new CREDecisionReceiver(sink, address(this), WORKFLOW, address(this));
        sink.setForwarder(address(target));
    }

    function metadata() internal view returns (bytes memory) {
        return abi.encodePacked(WORKFLOW, bytes10("sovereign"), address(this), bytes2(0));
    }

    function report(bytes32 id, uint8 kind, bool result, uint64 nonce)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(id, keccak256(abi.encode(id, kind, nonce)), kind, result, nonce);
    }

    function denied(CREDecisionReceiver target, bytes memory meta, bytes memory data) internal {
        (bool ok,) = address(target).call(abi.encodeCall(target.onReport, (meta, data)));
        require(!ok, "invalid report accepted");
    }

    function testReceiverMigrationPreservesNonceAndBlocksOldCaller() public {
        bytes32 id = _proposeAgreement();
        sink.recordDecision(id, keccak256("old validation"), 1, true, 41);
        CREDecisionReceiver target = receiver();
        require(sink.lastNonce(id) == 41, "nonce reset at cutover");
        require(!_tryRecord(id, keccak256("bypass"), 2, true, 42), "old caller still trusted");
        denied(target, metadata(), report(id, 2, true, 41));
        denied(target, metadata(), report(id, 2, false, 42));
        require(sink.lastNonce(id) == 41, "rejection consumed nonce");
        assertState(id, AgreementRegistry.AgreementState.ACTIVE);
        target.onReport(metadata(), report(id, 2, true, 42));
        denied(target, metadata(), report(id, 2, true, 42));
        denied(target, metadata(), report(id, 2, true, 43));
        require(sink.lastNonce(id) == 42, "terminal replay consumed nonce");
        assertState(id, AgreementRegistry.AgreementState.BREACHED);
    }

    function testReceiverAcceptAndRejectValidation() public {
        bytes32 id = _proposeAgreement();
        CREDecisionReceiver target = receiver();
        target.onReport(metadata(), report(id, 1, false, 1));
        assertState(id, AgreementRegistry.AgreementState.REJECTED);
        denied(target, metadata(), report(id, 1, true, 2));
        denied(target, metadata(), report(id, 2, true, 2));
    }

    function testReceiverValidationAndMetadata62() public {
        bytes32 id = _proposeAgreement();
        CREDecisionReceiver target = receiver();
        target.onReport(
            abi.encodePacked(WORKFLOW, bytes10("sovereign"), address(this)), report(id, 1, true, 1)
        );
        assertState(id, AgreementRegistry.AgreementState.ACTIVE);
        require(target.supportsInterface(target.onReport.selector), "missing receiver interface");
        require(target.supportsInterface(0x01ffc9a7), "missing ERC165");
        require(!target.supportsInterface(0xffffffff), "invalid interface supported");
    }

    function testReceiverRejectsUnauthorizedAndMalformedReports() public {
        bytes32 id = _proposeAgreement();
        CREDecisionReceiver target = receiver();
        denied(target, hex"", report(id, 1, true, 1));
        denied(
            target, abi.encodePacked(bytes32(0), bytes10(0), address(this)), report(id, 1, true, 1)
        );
        denied(target, abi.encodePacked(WORKFLOW, bytes10(0), address(123)), report(id, 1, true, 1));
        denied(target, metadata(), hex"00");
        denied(target, metadata(), bytes.concat(report(id, 1, true, 1), hex"00"));
        denied(target, metadata(), abi.encode(id, bytes32(0), uint8(1), true, uint64(1)));
        // Dirty ABI words must not truncate into valid bool/uint8/uint64 values.
        denied(target, metadata(), abi.encode(id, bytes32(0), uint256(257), true, uint64(1)));
        denied(target, metadata(), abi.encode(id, bytes32(0), uint8(1), uint256(2), uint64(1)));
        denied(target, metadata(), abi.encode(id, bytes32(0), uint8(1), true, uint256(1) << 64));
        denied(target, metadata(), report(id, 3, true, 1));
        require(sink.lastNonce(id) == 0, "invalid input consumed nonce");
        assertState(id, AgreementRegistry.AgreementState.PENDING_VALIDATION);
        CREDecisionReceiver other =
            new CREDecisionReceiver(sink, address(123), WORKFLOW, address(this));
        denied(other, metadata(), report(id, 1, true, 1));
    }
}
