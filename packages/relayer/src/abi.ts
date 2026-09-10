import { parseAbi } from 'viem'

// Exact callable/event fragments from contracts/src and packages/core/abis.
// ABI parity is tested, including indexed fields and tuple order.
export const sinkAbi = parseAbi([
  'function agreementRegistry() view returns (address)',
  'event DecisionRecorded(bytes32 indexed agreementId, bytes32 decisionId, uint8 checkKind, bool result, uint64 nonce)',
])
export const registryAbi = parseAbi([
  'function decisionSink() view returns (address)',
  'function agreements(bytes32 agreementId) view returns (bytes32 id, bytes32 intentId, address principal, address counterparty, uint256 capital, uint256 duration, uint256 yieldBps, bytes32 termsHash, bytes32 policyCommitment, uint8 state)',
])
export const escrowAbi = parseAbi([
  'function token() view returns (address)',
  'function relayer() view returns (address)',
  'function escrows(bytes32 agreementId) view returns (bytes32 agreementId, bytes32 termsHash, address principal, address counterparty, uint256 capital, bytes32 policyCommitment, uint8 state)',
  'function lockAgreement(bytes32 agreementId, bytes32 termsHash, address principal, address counterparty, uint256 capital, bytes32 policyCommitment)',
  'function unwind(bytes32 agreementId, bytes32 decisionId)',
  'event EscrowLocked(bytes32 indexed agreementId, bytes32 indexed termsHash, address indexed principal, address counterparty, uint256 capital, bytes32 policyCommitment)',
  'event EscrowUnwound(bytes32 indexed agreementId, bytes32 indexed decisionId, uint256 returned)',
])