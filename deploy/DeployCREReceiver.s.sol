// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { DecisionSink } from "../contracts/src/DecisionSink.sol";
import { CREDecisionReceiver } from "../contracts/src/CREDecisionReceiver.sol";

interface ReceiverVm {
    function envAddress(string calldata key) external returns (address);
    function envBytes32(string calldata key) external returns (bytes32);
    function envUint(string calldata key) external returns (uint256);
    function addr(uint256 key) external returns (address);
    function startBroadcast(uint256 key) external;
    function stopBroadcast() external;
}

contract DeployCREReceiver {
    ReceiverVm constant vm = ReceiverVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (CREDecisionReceiver receiver) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        DecisionSink sink = DecisionSink(vm.envAddress("EXISTING_DECISION_SINK"));
        address expectedForwarder = vm.envAddress("EXPECTED_SINK_FORWARDER");
        address donForwarder = vm.envAddress("CRE_REPORT_FORWARDER");
        bytes32 workflowId = vm.envBytes32("CRE_WORKFLOW_ID");
        address workflowOwner = vm.envAddress("CRE_WORKFLOW_OWNER");
        require(block.chainid == vm.envUint("RECEIVER_CHAIN_ID"), "wrong chain");
        require(sink.owner() == vm.addr(key), "signer is not sink owner");
        require(sink.forwarder() == expectedForwarder, "unexpected sink forwarder");
        require(sink.agreementRegistry().decisionSink() == address(sink), "inactive sink");
        vm.startBroadcast(key);
        receiver = new CREDecisionReceiver(sink, donForwarder, workflowId, workflowOwner);
        // Preserve the sink and its entire nonce mapping; replace only its caller.
        sink.setForwarder(address(receiver));
        vm.stopBroadcast();
        require(sink.forwarder() == address(receiver), "cutover failed");
    }
}
