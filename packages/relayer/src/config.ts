import { fileURLToPath } from 'node:url'
import { getAddress, type Address } from 'viem'
import canonical from '../../../deployments/canonical.json'
import { nonzeroAddress, requireRelay, type Settings } from './model'

export type Config = Settings & { sourceUrl: string; destinationUrl: string; stateDir: string }
export function parseArgs(args: string[]): { broadcast: boolean; help: boolean } {
  requireRelay(args.every(a => ['--once', '--broadcast', '--help'].includes(a)),
    'Unknown CLI argument. Use --once, optionally --broadcast; keys are environment-only.')
  requireRelay(new Set(args).size === args.length, 'Duplicate CLI argument.')
  return { broadcast: args.includes('--broadcast'), help: args.includes('--help') }
}
function integer(value: string | undefined, fallback?: string): bigint {
  const text = value || fallback
  requireRelay(text !== undefined && /^(0|[1-9][0-9]*)$/.test(text),
    'Missing/invalid numeric configuration. Set both start blocks explicitly; use unsigned decimal integers.')
  const result = BigInt(text)
  requireRelay(result <= 2n ** 64n - 1n, 'Numeric configuration exceeds uint64.')
  return result
}
function rpcUrl(raw: string | undefined): string {
  requireRelay(raw, 'Set SOURCE_RPC_URL and DESTINATION_RPC_URL in the environment.')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Invalid RPC configuration') }
  requireRelay(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
    'RPC endpoints must use HTTPS (HTTP allowed only on loopback).')
  return raw
}
function address(raw: string): Address {
  requireRelay(nonzeroAddress(raw), 'Canonical deployment contains an invalid address.')
  return getAddress(raw)
}
export function readConfig(env: Record<string, string | undefined>): Config {
  requireRelay(canonical.sepolia.chainId === 11155111 && canonical.arcTestnet.chainId === 5042002,
    'Canonical deployment chain IDs must be Sepolia 11155111 and Arc Testnet 5042002.')
  const maxBlocks = integer(env.MAX_BLOCKS, '500')
  const confirmations = integer(env.DESTINATION_CONFIRMATIONS, '2')
  requireRelay(maxBlocks > 0n && maxBlocks <= 2000n, 'MAX_BLOCKS must be between 1 and 2000.')
  requireRelay(confirmations >= 2n && confirmations <= 10000n, 'DESTINATION_CONFIRMATIONS must be between 2 and 10000.')
  return {
    sourceChain: 11155111, destinationChain: 5042002,
    sink: address(canonical.sepolia.decisionSink), registry: address(canonical.sepolia.agreementRegistry),
    escrow: address(canonical.arcTestnet.sovereignEscrow), token: address(canonical.arcTestnet.usdc),
    relayer: address(canonical.arcTestnet.relayer),
    sourceUrl: rpcUrl(env.SOURCE_RPC_URL), destinationUrl: rpcUrl(env.DESTINATION_RPC_URL),
    sourceStart: integer(env.SOURCE_START_BLOCK), destinationStart: integer(env.DESTINATION_START_BLOCK),
    maxBlocks, confirmations: Number(confirmations),
    stateDir: env.RELAYER_STATE_DIR || fileURLToPath(new URL('../state', import.meta.url)),
  }
}
// Bind storage to the deployment and replay origin, never to RPC URLs or secrets.
export function storageScope(cfg: Settings): string {
  return JSON.stringify([1, cfg.sourceChain, cfg.destinationChain, cfg.sink.toLowerCase(), cfg.registry.toLowerCase(),
    cfg.escrow.toLowerCase(), cfg.token.toLowerCase(), cfg.relayer.toLowerCase(), cfg.sourceStart.toString(),
    cfg.destinationStart.toString(), cfg.confirmations])
}