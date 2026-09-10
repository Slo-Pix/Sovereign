import { blockNumber, bytesToHex, cre, encodeCallMsg, getNetwork, LATEST_BLOCK_NUMBER,
  prepareReportRequest, protoBigIntToBigint, TxStatus, type TeeRuntime } from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { decodeFunctionResult, encodeFunctionData, type Hex, type Abi, zeroAddress } from 'viem'
import agreementAbi from '../../core/abis/AgreementRegistry.json'
import intentAbi from '../../core/abis/IntentRegistry.json'
import sinkAbi from '../../core/abis/DecisionSink.json'
import type { Config } from './config'
import { encodeDecision, type Snapshot } from './domain'
import type { WorkflowPorts } from './handler'
import { readPrivatePosition } from './position'

export function chainPorts(runtime: TeeRuntime<Config>): WorkflowPorts {
  const config = runtime.config
  const don = runtime.usingTheDons()
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-testnet-sepolia' })
  if (!network) throw new Error('Sepolia capability unavailable')
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)

  return {
    readSnapshot(): Snapshot {
      // Pin every read in this snapshot to one block, avoiding mixed state between RPC calls.
      const header = evm.headerByNumber(don, { blockNumber: LATEST_BLOCK_NUMBER }).result().header
      if (!header?.blockNumber) throw new Error('Chain header unavailable')
      const pinnedBlock = blockNumber(protoBigIntToBigint(header.blockNumber))
      const call = (abi: Abi, to: Hex, functionName: string, args: readonly unknown[] = []) => {
        const data = encodeFunctionData({ abi, functionName, args })
        const reply = evm.callContract(don, {
          call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: pinnedBlock,
        }).result()
        return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) })
      }
      const agreement = call(agreementAbi as Abi, config.agreementRegistry, 'agreements', [config.agreementId]) as
        readonly [Hex, Hex, Hex, Hex, bigint, bigint, bigint, Hex, Hex, number]
      const intent = call(intentAbi as Abi, config.intentRegistry, 'getIntent', [agreement[1]]) as
        { id: Hex; policyCommitment: Hex }
      // Refuse accidental pairing of an unrelated registry, intent registry or sink.
      const registryIntent = call(agreementAbi as Abi, config.agreementRegistry, 'intentRegistry') as Hex
      const registrySink = call(agreementAbi as Abi, config.agreementRegistry, 'decisionSink') as Hex
      const sinkRegistry = call(sinkAbi as Abi, config.decisionSink, 'agreementRegistry') as Hex
      if (registryIntent.toLowerCase() !== config.intentRegistry.toLowerCase() ||
          registrySink.toLowerCase() !== config.decisionSink.toLowerCase() ||
          sinkRegistry.toLowerCase() !== config.agreementRegistry.toLowerCase() ||
          intent.id.toLowerCase() !== agreement[1].toLowerCase()) throw new Error('Contract linkage mismatch')
      const lastNonce = call(sinkAbi as Abi, config.decisionSink, 'lastNonce', [config.agreementId]) as bigint
      return { agreementId: agreement[0], intentId: agreement[1], termsHash: agreement[7],
        policyCommitment: agreement[8], intentCommitment: intent.policyCommitment,
        state: agreement[9], lastNonce }
    },
    readPosition() {
      return readPrivatePosition(runtime)
    },
    publish(decision) {
      // Defense in depth: reject accidental SAFE publication before generating any DON report.
      if (decision.checkKind === 2 && !decision.result) throw new Error('Non-actionable decision')
      const report = don.report(prepareReportRequest(encodeDecision(decision))).result()
      if (config.delivery === 'report-only') {
        return { delivery: 'report-only' }
      }
      if (!config.reportReceiver) throw new Error('Missing report receiver')
      const write = evm.writeReport(don, {
        receiver: config.reportReceiver, report, gasConfig: { gasLimit: '500000' },
      }).result()
      if (write.txStatus !== TxStatus.SUCCESS ||
          write.receiverContractExecutionStatus !== EVM_PB.ReceiverContractExecutionStatus.SUCCESS ||
          write.txHash?.length !== 32) throw new Error('Report delivery failed')
      return { delivery: 'sepolia', txHash: bytesToHex(write.txHash) }
    },
  }
}