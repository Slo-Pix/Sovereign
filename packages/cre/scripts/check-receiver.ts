import assert from 'node:assert/strict'
import { createPublicClient, http, isAddress, parseAbi, toFunctionSelector,
  zeroAddress, zeroHash, type Address, type Hex } from 'viem'

export const receiverReadAbi = parseAbi([
  'function sink() view returns (address)',
  'function forwarder() view returns (address)',
  'function workflowId() view returns (bytes32)',
  'function workflowOwner() view returns (address)',
  'function supportsInterface(bytes4) view returns (bool)',
  'function agreementRegistry() view returns (address)',
  'function decisionSink() view returns (address)',
  'function intentRegistry() view returns (address)',
])
export type ReceiverConfig = {
  rpcUrl: string; receiver: Address; workflowId: Hex; workflowOwner: Address
  forwarder: Address; sink: Address; agreementRegistry: Address; intentRegistry: Address
}

// Public configuration only. Deliberately no defaults, dotenv, wallet or signer.
export function receiverConfigFromEnv(env: Record<string, string | undefined>): ReceiverConfig {
  const required = (key: string): string => {
    const value = env[key]
    assert.ok(value && value.trim() === value, `Missing or invalid ${key}`)
    return value
  }
  const address = (key: string): Address => {
    const value = required(key)
    assert.ok(isAddress(value) && value.toLowerCase() !== zeroAddress, `Invalid ${key}`)
    return value as Address
  }
  const rpcUrl = required('SEPOLIA_RPC_URL')
  const url = new URL(rpcUrl)
  assert.ok(['https:', 'http:'].includes(url.protocol), 'Unsupported RPC protocol')
  const workflowId = required('CRE_WORKFLOW_ID')
  assert.ok(/^0x[0-9a-fA-F]{64}$/.test(workflowId) && workflowId !== zeroHash, 'Invalid CRE_WORKFLOW_ID')
  return { rpcUrl, receiver: address('CRE_REPORT_RECEIVER'), workflowId: workflowId as Hex,
    workflowOwner: address('CRE_WORKFLOW_OWNER'), forwarder: address('CRE_FORWARDER'),
    sink: address('CRE_DECISION_SINK'), agreementRegistry: address('CRE_AGREEMENT_REGISTRY'),
    intentRegistry: address('CRE_INTENT_REGISTRY') }
}

export async function checkReceiver(config: ReceiverConfig, options: { localTestForwarder?: boolean } = {}) {
  if (options.localTestForwarder) {
    assert.equal(new URL(config.rpcUrl).hostname, '127.0.0.1', 'Test forwarder is loopback-only')
  }
  assert.notEqual(config.receiver.toLowerCase(), config.sink.toLowerCase(), 'Receiver must differ from sink')
  const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) })
  assert.equal(await client.getChainId(), 11155111, 'Expected Sepolia chain ID 11155111')
  const block = await client.getBlock()
  const blockNumber = block.number
  const codeTargets = [config.receiver, config.sink, config.agreementRegistry, config.intentRegistry]
  if (!options.localTestForwarder) codeTargets.push(config.forwarder)
  for (const address of codeTargets) {
    const code = await client.getBytecode({ address, blockNumber })
    assert.ok(code && code !== '0x', 'Required contract has no bytecode')
  }
  const read = (address: Address, functionName: 'sink' | 'forwarder' | 'workflowId' |
    'workflowOwner' | 'agreementRegistry' | 'decisionSink' | 'intentRegistry') =>
    client.readContract({ address, abi: receiverReadAbi, functionName, blockNumber })
  const same = (actual: string, expected: string, label: string) =>
    assert.equal(actual.toLowerCase(), expected.toLowerCase(), `${label} mismatch`)
  same(await read(config.receiver, 'sink'), config.sink, 'Receiver sink')
  same(await read(config.receiver, 'forwarder'), config.forwarder, 'Receiver forwarder')
  same(await read(config.receiver, 'workflowId'), config.workflowId, 'Receiver workflow ID')
  same(await read(config.receiver, 'workflowOwner'), config.workflowOwner, 'Receiver workflow owner')
  same(await read(config.sink, 'forwarder'), config.receiver, 'Sink forwarder')
  same(await read(config.sink, 'agreementRegistry'), config.agreementRegistry, 'Sink registry')
  same(await read(config.agreementRegistry, 'decisionSink'), config.sink, 'Registry sink')
  same(await read(config.agreementRegistry, 'intentRegistry'), config.intentRegistry, 'Intent registry')
  for (const [id, expected] of [[toFunctionSelector('onReport(bytes,bytes)'), true],
    ['0x01ffc9a7', true], ['0xffffffff', false]] as const) {
    assert.equal(await client.readContract({ address: config.receiver, abi: receiverReadAbi,
      functionName: 'supportsInterface', args: [id,], blockNumber }), expected, 'ERC165 mismatch')
  }
  return { evidenceMode: options.localTestForwarder ? 'LOCAL_READ_ONLY_RECEIVER_CHECK' : 'RPC_READS_ONLY_NO_TRANSACTIONS',
    status: 'CONFIGURATION_MATCHES_NOT_DEPLOYMENT_AUTHORIZATION', checkedAt: new Date().toISOString(),
    chainId: 11155111, blockNumber: blockNumber.toString(), blockHash: block.hash,
    receiver: config.receiver, sink: config.sink, forwarder: config.forwarder,
    workflowId: config.workflowId, workflowOwner: config.workflowOwner,
    agreementRegistry: config.agreementRegistry, intentRegistry: config.intentRegistry,
    limitations: ['Checks configured getters, bytecode presence and ERC165, not audited bytecode equivalence',
      'Does not attest DON identity, workflow deployment, TEE execution, funding or delivery',
      'No transaction, deployment, or funding authorization is implied; Arc transport is not checked'] }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await checkReceiver(receiverConfigFromEnv(process.env)), null, 2))
  } catch {
    console.error('Receiver check failed: supply SEPOLIA_RPC_URL, CRE_REPORT_RECEIVER, CRE_WORKFLOW_ID, CRE_WORKFLOW_OWNER, CRE_FORWARDER, CRE_DECISION_SINK, CRE_AGREEMENT_REGISTRY and CRE_INTENT_REGISTRY; all must match deployed configuration. No transactions sent; RPC details suppressed.')
    process.exitCode = 1
  }
}