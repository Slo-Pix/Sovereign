import { expect } from 'bun:test'
import { blockNumber, bytesToHex, protoBigIntToBigint, type TeeRuntime } from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { hexToBytes, type Abi, type Hex } from 'viem'
import agreementAbi from '../../core/abis/AgreementRegistry.json'
import intentAbi from '../../core/abis/IntentRegistry.json'
import sinkAbi from '../../core/abis/DecisionSink.json'
import vectors from '../../core/fixtures/vectors.json'
import example from '../sovereign/config.example.json'
import { configSchema, type Config } from '../src/config'
import { chainPorts } from '../src/chain'
import { deriveDecisionId } from '../src/domain'

function setup(delivery: 'report-only' | 'simulation-sepolia' | 'sepolia' = 'report-only') {
  const config = configSchema.parse({ ...example, agreementId: `0x${'bb'.repeat(32)}`,
    terms: vectors.terms, delivery, reportReceiver: `0x${'44'.repeat(20)}` })
  const don = newTestRuntime(null, undefined, config)
  const runtime = { config, usingTheDons: () => don } as unknown as TeeRuntime<Config>
  const evm = EvmMock.testInstance(16015286601757825753n)
  evm.headerByNumber = () => ({ header: { blockNumber: blockNumber(123), timestamp: '1799999990' } })
  const agreement = Object.assign(addContractMock(evm, { address: config.agreementRegistry, abi: agreementAbi as Abi }), {
    agreements: () => [config.agreementId, config.terms.intentId,
      config.terms.principal, config.terms.counterparty, config.terms.capital, config.terms.duration,
      config.terms.yieldBps, vectors.termsHash, vectors.policyCommitment, 3],
    intentRegistry: () => config.intentRegistry,
    decisionSink: () => config.decisionSink,
  })
  Object.assign(addContractMock(evm, { address: config.intentRegistry, abi: intentAbi as Abi }), {
    getIntent: () => ({ id: config.terms.intentId, creator: config.terms.principal,
      asset: `0x${'55'.repeat(20)}`, capital: config.terms.capital, maxDuration: 2592000n,
      createdAt: 1799999900n, policyCommitment: vectors.policyCommitment }),
  })
  const sink = Object.assign(addContractMock(evm, { address: config.decisionSink, abi: sinkAbi as Abi }), {
    agreementRegistry: () => config.agreementRegistry,
    lastNonce: () => 7n,
  })
  return { config, runtime, evm, agreement, sink, don }
}

test('real SDK EVM calls decode canonical ABIs and pin every snapshot read to one block', () => {
  const { config, runtime, evm } = setup()
  const original = evm.callContract!
  let calls = 0
  evm.callContract = input => {
    expect(protoBigIntToBigint(input.blockNumber!)).toBe(123n)
    calls++
    return original(input)
  }
  expect(chainPorts(runtime).readSnapshot()).toEqual({ agreementId: config.agreementId,
    intentId: config.terms.intentId, termsHash: vectors.termsHash as Hex,
    policyCommitment: vectors.policyCommitment as Hex, intentCommitment: vectors.policyCommitment as Hex,
    state: 3, lastNonce: 7n })
  expect(calls).toBe(6)
})
test('mismatched contract wiring fails closed', () => {
  const { runtime, sink } = setup()
  sink.agreementRegistry = () => `0x${'99'.repeat(20)}`
  expect(() => chainPorts(runtime).readSnapshot()).toThrow('Contract linkage mismatch')
})
test('report-only never invokes an EVM write', () => {
  const { config, runtime, evm } = setup()
  evm.writeReport = () => { throw new Error('Unexpected chain write') }
  expect(chainPorts(runtime).publish({ agreementId: config.agreementId, checkKind: 1,
    result: true, decisionNonce: 8n, decisionId: deriveDecisionId(config.agreementId, 1, 8n) }))
    .toEqual({ delivery: 'report-only' })
})
test('SDK report delivery targets the configured receiver and checks receipt status', () => {
  const { config, runtime, evm } = setup('sepolia')
  const txHash = `0x${'77'.repeat(32)}` as Hex
  evm.writeReport = input => {
    expect(bytesToHex(input.receiver)).toBe(config.reportReceiver!)
    return { txStatus: 'TX_STATUS_SUCCESS', receiverContractExecutionStatus: 'RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS',
      txHash: Buffer.from(hexToBytes(txHash)).toString('base64') }
  }
  const decision = { agreementId: config.agreementId, checkKind: 1 as const,
    result: true, decisionNonce: 8n, decisionId: deriveDecisionId(config.agreementId, 1, 8n) }
  expect(chainPorts(runtime).publish(decision)).toEqual({ delivery: 'sepolia', txHash })
  evm.writeReport = () => ({ txStatus: 'TX_STATUS_REVERTED' })
  expect(() => chainPorts(runtime).publish(decision)).toThrow('Report delivery failed')
  evm.writeReport = () => ({ txStatus: 'TX_STATUS_SUCCESS', receiverContractExecutionStatus: 'RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED',
    txHash: Buffer.from(hexToBytes(txHash)).toString('base64') })
  expect(() => chainPorts(runtime).publish(decision)).toThrow('Report delivery failed')
  evm.writeReport = () => ({ txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.from(hexToBytes(txHash)).toString('base64') })
  expect(() => chainPorts(runtime).publish(decision)).toThrow('Report delivery failed')
})

test('transport rejects SAFE before report generation or chain write in either delivery mode', () => {
  for (const delivery of ['report-only', 'simulation-sepolia', 'sepolia'] as const) {
    const { config, runtime, evm, don } = setup(delivery)
    let reports = 0
    let writes = 0
    don.report = () => { reports++; throw new Error('Unexpected SAFE report') }
    evm.writeReport = () => { writes++; throw new Error('Unexpected SAFE chain write') }
    expect(() => chainPorts(runtime).publish({ agreementId: config.agreementId, checkKind: 2, result: false,
      decisionNonce: 8n, decisionId: deriveDecisionId(config.agreementId, 2, 8n) }))
      .toThrow('Non-actionable decision')
    expect(reports).toBe(0)
    expect(writes).toBe(0)
  }
})
