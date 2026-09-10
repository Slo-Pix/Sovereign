import { createPublicClient, http, type Abi, type Hex } from 'viem'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sinkAbi from '../../core/abis/DecisionSink.json'
import escrowAbi from '../../core/abis/SovereignEscrow.json'
import example from '../sovereign/config.example.json'
import arc from '../../../deployments/arc-testnet.json'

// Read-only: no private keys, accounts, signing or transaction submission.
try {
  const sepolia = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL ??
    'https://ethereum-sepolia-rpc.publicnode.com', { timeout: 15000, retryCount: 1 }) })
  const arcClient = createPublicClient({ transport: http(process.env.ARC_RPC_URL ??
    'https://rpc.testnet.arc.network', { timeout: 15000, retryCount: 1 }) })
  const sink = example.decisionSink as Hex
  const escrow = arc.contracts.sovereignEscrow.address as Hex
  const [sepoliaId, arcId, sinkCode, escrowCode, forwarder, relayer, token] = await Promise.all([
    sepolia.getChainId(), arcClient.getChainId(), sepolia.getBytecode({ address: sink }),
    arcClient.getBytecode({ address: escrow }),
    sepolia.readContract({ address: sink, abi: sinkAbi as Abi, functionName: 'forwarder' }),
    arcClient.readContract({ address: escrow, abi: escrowAbi as Abi, functionName: 'relayer' }),
    arcClient.readContract({ address: escrow, abi: escrowAbi as Abi, functionName: 'token' }),
  ])
  if (sepoliaId !== 11155111 || arcId !== 5042002 || !sinkCode || sinkCode === '0x' ||
      !escrowCode || escrowCode === '0x') throw new Error('Deployment verification failed')
  const evidence = { evidenceMode: 'LIVE_RPC_READS_ONLY_NO_TRANSACTIONS', checkedAt: new Date().toISOString(),
    sepolia: { chainId: sepoliaId, decisionSink: sink, hasBytecode: true, configuredForwarder: forwarder },
    arc: { chainId: arcId, escrow, hasBytecode: true, configuredRelayer: relayer, token },
    limitations: ['No agreement lifecycle tested', 'No transaction broadcast', 'Wallet funding not checked',
      'Current contract ABIs do not expose onReport; receiver integration required'],
  }
  const path = resolve(import.meta.dir, '../evidence/preflight')
  await mkdir(path, { recursive: true })
  await writeFile(resolve(path, 'live-contracts.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} catch {
  console.error('Read-only preflight failed. Check connectivity and RPC configuration locally; credentials are not logged.')
  process.exitCode = 1
}