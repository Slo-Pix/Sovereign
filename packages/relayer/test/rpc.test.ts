import { expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, encodeEventTopics, type Hex } from 'viem'
import { parseAbiParameters } from 'viem'
import { createAdapter, validateIdentity, type Identity } from '../src/rpc'
import { escrowAbi, sinkAbi } from '../src/abi'
import { agreement, block, cfg, event, h } from './fixtures'

const identity: Identity = {
  sourceChain: 11155111, destinationChain: 5042002, registry: cfg.registry, sink: cfg.sink,
  relayer: cfg.relayer, token: cfg.token, signer: cfg.relayer,
  sourceCode: '0x6000', registryCode: '0x6000', escrowCode: '0x6000', tokenCode: '0x6000', relayerCode: '0x',
}
test('canonical chain/wiring/token/code/EOA identity passes', () => expect(() => validateIdentity(cfg, identity)).not.toThrow())
for (const [label, patch] of [
  ['source chain', { sourceChain: 1 }], ['destination chain', { destinationChain: 1 }],
  ['registry', { registry: agreement.principal }], ['sink', { sink: agreement.principal }],
  ['token', { token: agreement.principal }], ['signer', { signer: agreement.principal }],
  ['relayer', { relayer: agreement.principal }], ['missing sink code', { sourceCode: '0x' }],
  ['missing registry code', { registryCode: undefined }], ['missing escrow code', { escrowCode: '0x' }],
  ['missing token code', { tokenCode: '0x' }], ['contract relayer', { relayerCode: '0x6000' }],
] as [string, Partial<Identity>][]) {
  test(`preflight rejects wrong ${label}`, () => expect(() => validateIdentity(cfg, { ...identity, ...patch })).toThrow())
}
test('read-only identity requires no signing key', () => expect(() => validateIdentity(cfg, { ...identity, signer: undefined })).not.toThrow())

type Call = { method: string; params?: unknown }
function clients(handler: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = []
  const transport = custom({ request: async call => { calls.push(call); return handler(call) } }, { retryCount: 0 })
  const chain = defineChain({ id: 5042002, name: 'Mock Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:1'] } } })
  return { client: createPublicClient({ transport, cacheTime: 0 }), wallet: createWalletClient({ transport, chain, account: cfg.relayer }), calls }
}
const encodedAddress = (address: Hex) => encodeAbiParameters(parseAbiParameters('address'), [address])
const rpcBlock = (n: number) => ({ number: `0x${n.toString(16)}`, hash: block(BigInt(n)).hash })
test('source finalized request uses the finalized tag with no fallback', async () => {
  const c = clients(call => { expect(call.method).toBe('eth_getBlockByNumber'); expect(call.params).toEqual(['finalized', false]); return rpcBlock(12) })
  expect(await createAdapter(cfg, c.client, c.client).finalized()).toEqual(block(12n))
})
test('unsupported finalized tag fails closed', async () => {
  const c = clients(() => { throw new Error('unsupported block tag') })
  await expect(createAdapter(cfg, c.client, c.client).finalized()).rejects.toThrow()
  expect(c.calls).toHaveLength(1)
})
test('Arc confirmed snapshot uses depth, never assumes finalized support', async () => {
  const c = clients(call => call.method === 'eth_blockNumber' ? '0x65' : rpcBlock(100))
  expect(await createAdapter(cfg, c.client, c.client).confirmed()).toEqual(block(100n))
  expect(c.calls[1]?.params).toEqual(['0x64', false])
})
test('historical agreement/wiring reads all use source event block, not latest state', async () => {
  const c = clients(call => {
    expect(call.method).toBe('eth_call')
    const [request, at] = call.params as [{ to: string }, string]
    expect(at).toBe('0xa')
    if (request.to.toLowerCase() === cfg.sink.toLowerCase()) return encodedAddress(cfg.registry)
    if (c.calls.length === 2) return encodedAddress(cfg.sink)
    return encodeAbiParameters(parseAbiParameters('bytes32,bytes32,address,address,uint256,uint256,uint256,bytes32,bytes32,uint8'),
      [agreement.agreementId, h(4), agreement.principal, agreement.counterparty, agreement.capital, 100n, 100n, agreement.termsHash, agreement.policyCommitment, 7])
  })
  const result = await createAdapter(cfg, c.client, c.client).agreement(event())
  expect(result).toEqual({ ...agreement, state: 7 })
})
test('real adapter requests only configured sink with bounded source range', async () => {
  const c = clients(call => {
    expect(call.method).toBe('eth_getLogs')
    const [filter] = call.params as [{ address: string; fromBlock: string; toBlock: string }]
    expect(filter.address).toBe(cfg.sink); expect(filter.fromBlock).toBe('0xa'); expect(filter.toBlock).toBe('0xc')
    return []
  })
  const rpc = createAdapter(cfg, c.client, c.client)
  await rpc.decisions(10n, 12n)
  await expect(rpc.decisions(10n, 13n)).rejects.toThrow('MAX_BLOCKS')
  expect(c.calls).toHaveLength(1)
})
test('UNWOUND proof enforces expected decision ID and returned capital in actual decoded logs', async () => {
  for (const wrong of ['id', 'capital', 'missing', 'hash'] as const) {
    const e = event(2)
    const c = clients(call => {
      if (call.method === 'eth_getLogs') return wrong === 'missing' ? [] : [{
        address: cfg.escrow, blockNumber: '0x64', blockHash: wrong === 'hash' ? h(9) : block(100n).hash,
        transactionHash: h(302), transactionIndex: '0x0', logIndex: '0x0', removed: false,
        topics: encodeEventTopics({ abi: escrowAbi, eventName: 'EscrowUnwound',
          args: { agreementId: e.agreementId, decisionId: wrong === 'id' ? h(99) : e.decisionId } }),
        data: encodeAbiParameters(parseAbiParameters('uint256'), [wrong === 'capital' ? 99n : agreement.capital]),
      }]
      return rpcBlock(100)
    })
    const local = { ...cfg, destinationStart: 99n }
    await expect(createAdapter(local, c.client, c.client).prove('unwind', e, agreement, block(100n))).rejects.toThrow()
  }
})
test('recovery proof searches bounded windows and verifies canonical receipt', async () => {
  const e = event(2); const ranges: [string, string][] = []
  const c = clients(call => {
    if (call.method === 'eth_getLogs') {
      const [filter] = call.params as [{ fromBlock: string; toBlock: string }]
      ranges.push([filter.fromBlock, filter.toBlock])
      if (filter.toBlock !== '0x61') return []
      return [{ address: cfg.escrow, blockNumber: '0x61', blockHash: block(97n).hash,
        transactionHash: h(302), transactionIndex: '0x0', logIndex: '0x0', removed: false,
        topics: encodeEventTopics({ abi: escrowAbi, eventName: 'EscrowUnwound', args: { agreementId: e.agreementId, decisionId: e.decisionId } }),
        data: encodeAbiParameters(parseAbiParameters('uint256'), [agreement.capital]),
      }]
    }
    if (call.method === 'eth_getTransactionReceipt') return {
      blockNumber: '0x61', blockHash: block(97n).hash, transactionHash: h(302), transactionIndex: '0x0',
      status: '0x1', to: cfg.escrow, from: cfg.relayer, logs: [], gasUsed: '0x1', cumulativeGasUsed: '0x1', effectiveGasPrice: '0x1', type: '0x2',
    }
    return rpcBlock(97)
  })
  expect(await createAdapter(cfg, c.client, c.client).prove('unwind', e, agreement, block(100n)))
    .toEqual({ ...block(97n), transactionHash: h(302) })
  expect(ranges).toEqual([['0x62', '0x64'], ['0x5f', '0x61']])
})
test('adapter without wallet cannot send', async () => {
  const c = clients(() => { throw new Error('No network expected') })
  await expect(createAdapter(cfg, c.client, c.client).send('lockAgreement', event(), agreement)).rejects.toThrow('No broadcast wallet')
  expect(c.calls).toHaveLength(0)
})
test('pending nonce activity blocks send after full identity preflight', async () => {
  let count = 0
  const source = clients(call => {
    if (call.method === 'eth_chainId') return '0xaa36a7'
    if (call.method === 'eth_getBlockByNumber') return rpcBlock(12)
    if (call.method === 'eth_getCode') return '0x6000'
    const [request] = call.params as [{ to: string }]
    return encodedAddress(request.to.toLowerCase() === cfg.sink.toLowerCase() ? cfg.registry : cfg.sink)
  })
  const dest = clients(call => {
    if (call.method === 'eth_chainId') return '0x4cef52'
    if (call.method === 'eth_getBlockByNumber') return rpcBlock(100)
    if (call.method === 'eth_blockNumber') return '0x65'
    if (call.method === 'eth_getCode') {
      const [address] = call.params as [string]
      return address.toLowerCase() === cfg.relayer.toLowerCase() ? '0x' : '0x6000'
    }
    if (call.method === 'eth_getTransactionCount') {
      const [, tag] = call.params as [string, string]
      return tag === 'pending' ? '0x2' : '0x1'
    }
    if (call.method === 'eth_call') return encodedAddress(count++ === 0 ? cfg.relayer : cfg.token)
    throw new Error('Unexpected RPC')
  })
  await expect(createAdapter(cfg, source.client, dest.client, dest.wallet).send('lockAgreement', event(), agreement))
    .rejects.toThrow('pending/unconfirmed')
  expect(dest.calls.some(call => call.method.includes('sendTransaction'))).toBe(false)
})
test('malformed source log is an error, not a silently skipped checkpoint', async () => {
  const c = clients(() => [{ address: cfg.sink, blockNumber: '0xa', blockHash: block(10n).hash,
    transactionHash: h(100), logIndex: '0x1', transactionIndex: '0x0', removed: false,
    topics: encodeEventTopics({ abi: sinkAbi, eventName: 'DecisionRecorded', args: { agreementId: agreement.agreementId } }),
    data: '0x00',
  }])
  await expect(createAdapter(cfg, c.client, c.client).decisions(10n, 12n)).rejects.toThrow('Malformed')
})
test('real adapter simulates and submits exact lock/unwind calldata with explicit stable nonce', async () => {
  const source = clients(call => {
    if (call.method === 'eth_chainId') return '0xaa36a7'
    if (call.method === 'eth_getBlockByNumber') return rpcBlock(12)
    if (call.method === 'eth_getCode') return '0x6000'
    const [request] = call.params as [{ to: string }]
    return encodedAddress(request.to.toLowerCase() === cfg.sink.toLowerCase() ? cfg.registry : cfg.sink)
  })
  let reads = 0
  const submitted: { to: string; from: string; nonce: string; data: Hex }[] = []
  const dest = clients(call => {
    if (call.method === 'eth_chainId') return '0x4cef52'
    if (call.method === 'eth_getBlockByNumber') return rpcBlock(100)
    if (call.method === 'eth_blockNumber') return '0x65'
    if (call.method === 'eth_getCode') {
      const [address] = call.params as [string]
      return address.toLowerCase() === cfg.relayer.toLowerCase() ? '0x' : '0x6000'
    }
    if (call.method === 'eth_getTransactionCount') return '0x1'
    if (call.method === 'eth_call') {
      const n = reads++ % 3
      return n === 0 ? encodedAddress(cfg.relayer) : n === 1 ? encodedAddress(cfg.token) : '0x'
    }
    if (call.method === 'eth_sendTransaction') {
      const [request] = call.params as typeof submitted
      submitted.push(request!)
      return h(submitted.length === 1 ? 301 : 302)
    }
    throw new Error(`Unexpected mocked RPC ${call.method}`)
  })
  const rpc = createAdapter(cfg, source.client, dest.client, dest.wallet)
  expect(await rpc.send('lockAgreement', event(), agreement)).toBe(h(301))
  expect(await rpc.send('unwind', event(2), agreement)).toBe(h(302))
  const { decodeFunctionData } = await import('viem')
  expect(submitted).toHaveLength(2)
  for (const request of submitted) {
    expect(request.to.toLowerCase()).toBe(cfg.escrow.toLowerCase())
    expect(request.from.toLowerCase()).toBe(cfg.relayer.toLowerCase())
    expect(request.nonce).toBe('0x1')
  }
  expect(decodeFunctionData({ abi: escrowAbi, data: submitted[0]!.data })).toEqual({
    functionName: 'lockAgreement', args: [agreement.agreementId, agreement.termsHash, agreement.principal,
      agreement.counterparty, agreement.capital, agreement.policyCommitment],
  })
  expect(decodeFunctionData({ abi: escrowAbi, data: submitted[1]!.data })).toEqual({
    functionName: 'unwind', args: [agreement.agreementId, event(2).decisionId],
  })
})
for (const mode of ['success', 'reverted', 'replacement', 'reorg'] as const) {
  test(`real receipt waiter verifies confirmations, status, transaction identity and block hash: ${mode}`, async () => {
    const c = clients(call => {
      if (call.method === 'eth_getTransactionReceipt') return {
        blockNumber: '0x64', blockHash: block(100n).hash,
        transactionHash: mode === 'replacement' ? h(999) : h(301), transactionIndex: '0x0',
        status: mode === 'reverted' ? '0x0' : '0x1', to: cfg.escrow, from: cfg.relayer, logs: [],
        gasUsed: '0x1', cumulativeGasUsed: '0x1', effectiveGasPrice: '0x1', type: '0x2',
      }
      if (call.method === 'eth_blockNumber') return '0x67' // Four confirmations, including receipt block.
      if (call.method === 'eth_getBlockByNumber') return { ...rpcBlock(100), hash: mode === 'reorg' ? h(999) : block(100n).hash }
      throw new Error('Unexpected receipt-wait RPC')
    })
    const rpc = createAdapter({ ...cfg, confirmations: 4 }, c.client, c.client)
    if (mode === 'success') expect(await rpc.wait(h(301))).toEqual({ ...block(100n), transactionHash: h(301) })
    else await expect(rpc.wait(h(301))).rejects.toThrow()
    expect(c.calls.some(call => call.method === 'eth_blockNumber')).toBe(true)
  })
}