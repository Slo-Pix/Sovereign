// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { AgreementRegistry } from "../contracts/src/AgreementRegistry.sol";
import { DecisionSink } from "../contracts/src/DecisionSink.sol";
import { IntentRegistry } from "../contracts/src/IntentRegistry.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeploySepolia {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (IntentRegistry intents, AgreementRegistry agreements, DecisionSink sink) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address forwarder = vm.envAddress("CRE_FORWARDER");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");

        vm.startBroadcast(deployerKey);
        intents = new IntentRegistry();
        agreements = new AgreementRegistry(intents, deployer);
        sink = new DecisionSink(agreements, forwarder, deployer);
        agreements.setDecisionSink(address(sink));
        vm.stopBroadcast();
    }
}
