// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { DecisionSink } from "./DecisionSink.sol";

/// @notice Immutable CRE authentication adapter; nonce storage remains in the existing sink.
contract CREDecisionReceiver is ERC165 {
    error InvalidConfiguration();
    error UnauthorizedForwarder();
    error InvalidMetadata();
    error UnauthorizedWorkflow();
    error InvalidReport();
    error InvalidDecisionId();
    error NonActionableDecision();
    error InvalidWiring();

    DecisionSink public immutable sink;
    address public immutable forwarder;
    bytes32 public immutable workflowId;
    address public immutable workflowOwner;

    constructor(DecisionSink sink_, address forwarder_, bytes32 workflowId_, address owner_) {
        if (
            address(sink_).code.length == 0 || forwarder_ == address(0) || workflowId_ == bytes32(0)
                || owner_ == address(0)
        ) revert InvalidConfiguration();
        sink = sink_;
        forwarder = forwarder_;
        workflowId = workflowId_;
        workflowOwner = owner_;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == this.onReport.selector || super.supportsInterface(interfaceId);
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert UnauthorizedForwarder();
        // CRE production metadata includes a two-byte report ID after the packed identity.
        if (metadata.length != 62 && metadata.length != 64) revert InvalidMetadata();
        if (
            bytes32(metadata[:32]) != workflowId
                || address(bytes20(metadata[42:62])) != workflowOwner
        ) {
            revert UnauthorizedWorkflow();
        }
        if (report.length != 160) revert InvalidReport();
        (bytes32 agreementId, bytes32 decisionId, uint8 kind, bool result, uint64 nonce) =
            abi.decode(report, (bytes32, bytes32, uint8, bool, uint64));
        if (kind == 2 && !result) revert NonActionableDecision();
        if (decisionId != keccak256(abi.encode(agreementId, kind, nonce))) {
            revert InvalidDecisionId();
        }
        if (
            sink.forwarder() != address(this)
                || sink.agreementRegistry().decisionSink() != address(sink)
        ) revert InvalidWiring();
        sink.recordDecision(agreementId, decisionId, kind, result, nonce);
    }
}
