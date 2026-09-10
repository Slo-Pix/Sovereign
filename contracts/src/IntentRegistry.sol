// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract IntentRegistry {
    error ZeroAsset();
    error ZeroCapital();
    error ZeroDuration();
    error ZeroPolicyCommitment();
    error UnknownIntent();

    struct Intent {
        bytes32 id;
        address creator;
        address asset;
        uint256 capital;
        uint256 maxDuration;
        uint256 createdAt;
        bytes32 policyCommitment;
    }

    event IntentCreated(
        bytes32 indexed intentId,
        address indexed creator,
        address asset,
        uint256 capital,
        uint256 maxDuration,
        bytes32 policyCommitment
    );

    mapping(bytes32 intentId => Intent intent) public intents;
    mapping(address creator => uint256 nonce) public nextIntentNonce;

    function createIntent(
        address asset,
        uint256 capital,
        uint256 maxDuration,
        bytes32 policyCommitment
    ) external returns (bytes32 intentId) {
        if (asset == address(0)) revert ZeroAsset();
        if (capital == 0) revert ZeroCapital();
        if (maxDuration == 0) revert ZeroDuration();
        if (policyCommitment == bytes32(0)) revert ZeroPolicyCommitment();

        uint256 nonce = nextIntentNonce[msg.sender]++;
        intentId = keccak256(
            abi.encode(
                msg.sender,
                asset,
                capital,
                maxDuration,
                policyCommitment,
                block.chainid,
                address(this),
                nonce
            )
        );

        intents[intentId] = Intent({
            id: intentId,
            creator: msg.sender,
            asset: asset,
            capital: capital,
            maxDuration: maxDuration,
            createdAt: block.timestamp,
            policyCommitment: policyCommitment
        });

        emit IntentCreated(intentId, msg.sender, asset, capital, maxDuration, policyCommitment);
    }

    function getIntent(bytes32 intentId) external view returns (Intent memory intent) {
        intent = intents[intentId];
        if (intent.id == bytes32(0)) revert UnknownIntent();
    }
}

