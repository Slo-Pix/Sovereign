import { createPublicClient, createWalletClient, defineChain, http, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { parseArgs, readConfig, storageScope } from './config'
import { RelayError, requireRelay } from './model'
import { processOnce } from './processor'
import { createAdapter } from './rpc'
import { SqliteStore } from './store'

export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
  const mode = parseArgs(args)
  if (mode.help) {
    console.log('Usage: bun --no-env-file src/cli.ts --once [--broadcast]\nDefault: read-only plan, no private key, no cursor advancement. Configure both RPC URLs and start blocks. See package README.')
    return
  }
  const cfg = readConfig(env)
  const chain = defineChain({ id: cfg.destinationChain, name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [cfg.destinationUrl] } } })
  let wallet: WalletClient | undefined
  if (mode.broadcast) {
    const key = env.RELAYER_PRIVATE_KEY
    requireRelay(key && /^0x[0-9a-fA-F]{64}$/.test(key), 'Explicit --broadcast requires RELAYER_PRIVATE_KEY in the environment.')
    wallet = createWalletClient({ chain, account: privateKeyToAccount(key as `0x${string}`), transport: http(cfg.destinationUrl, { retryCount: 0 }) })
  }
  process.umask(0o077)
  const store = new SqliteStore(cfg.stateDir, storageScope(cfg), mode.broadcast)
  try {
    const previousCursor = store.load().cursor?.number
    const rpc = createAdapter(cfg,
      createPublicClient({ transport: http(cfg.sourceUrl, { retryCount: 0 }), cacheTime: 0 }),
      createPublicClient({ transport: http(cfg.destinationUrl, { retryCount: 0 }), cacheTime: 0 }), wallet)
    const plans = await processOnce(cfg, rpc, store, mode.broadcast)
    store.commit()
    // Explicit allowlist only: never serialize configuration, errors, RPC requests, accounts, or env.
    console.log(JSON.stringify({ mode: mode.broadcast ? 'broadcast' : 'dry-run', sourceChain: cfg.sourceChain,
      destinationChain: cfg.destinationChain, sink: cfg.sink, escrow: cfg.escrow,
      cursorAdvanced: mode.broadcast && store.load().cursor?.number !== previousCursor, plans }))
  } finally { store.close() }
}
if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof RelayError ? error.message
      : 'Relayer stopped; batch not checkpointed. Check RPC/archive availability, DB permissions, allowance/balance, and pending nonce/receipt. Raw diagnostics suppressed to protect credentials.')
    process.exitCode = 1
  })
}