import assert from 'node:assert/strict'

export const LOCAL_MODE = 'LOCAL_EVM_TEST_FORWARDER_NOT_DON_OR_TEE'

export function assertLocalRpc(url: string, chainId: number): void {
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'http:', 'Local RPC must use HTTP')
  assert.equal(parsed.hostname, '127.0.0.1', 'Local RPC must use literal loopback')
  assert.ok(parsed.port && !parsed.username && !parsed.password && !parsed.search &&
    !parsed.hash && parsed.pathname === '/', 'Local RPC must have only a loopback port')
  assert.ok(chainId === 11155111 || chainId === 5042002, 'Unexpected local chain ID')
}