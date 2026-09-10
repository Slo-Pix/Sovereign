// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { SovereignEscrow } from "../contracts/src/SovereignEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployArcEscrow {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (SovereignEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address usdc = vm.envAddress("ARC_USDC");
        address relayer = vm.envAddress("ARC_RELAYER");

        vm.startBroadcast(deployerKey);
        escrow = new SovereignEscrow(usdc, relayer, deployer);
        vm.stopBroadcast();
    }
}
