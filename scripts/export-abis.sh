#!/usr/bin/env bash
set -euo pipefail

forge build
mkdir -p packages/core/abis

for contract in IntentRegistry AgreementRegistry DecisionSink SovereignEscrow SovereignTypes CREDecisionReceiver; do
  artifact="out/${contract}.sol/${contract}.json"
  jq '.abi' "$artifact" > "packages/core/abis/${contract}.json"
done

echo "Exported canonical ABI files to packages/core/abis"
