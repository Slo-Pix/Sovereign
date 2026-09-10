import { describe, expect, test } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, type Hex, type TransactionReceipt } from 'viem';
import { plan, type Proof } from '../src/policy';
import { confirmedReceipt, eventArgs } from '../src/evidence';

const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Hex;
function fixture(): Proof {
  const agreement = { agreementId: h(1), termsHash: h(2), policyCommitment: h(3),
    principal: address(4), counterparty: address(5), capital: 100000000000n };
  const decisionId = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'uint64' }], [h(1), 2, 2n]));
  return { agreement, escrow: { ...agreement }, registryState: 5, escrowState: 2,
    decision: { agreementId: h(1), decisionId, kind: 2, result: true, nonce: 2n },
    unwind: { agreementId: h(1), decisionId, returned: agreement.capital } };
}
describe('owner unwind reconciliation policy', () => {
  test('full unwind plans both owner transitions in order', () => expect(plan(fixture())).toEqual(['markUnwinding', 'markSettled']));
  test('restart at UNWIND only settles', () => {
    const p = fixture(); p.registryState = 6; expect(plan(p)).toEqual(['markSettled']);
  });
  test('terminal state never writes again (CLI additionally requires settlement receipt)', () => {
    const p = fixture(); p.registryState = 7; expect(plan(p)).toEqual([]);
  });
  for (const state of [0, 1, 2, 3, 4, 8, 9, 10]) test(`reject registry state ${state}`, () => {
    const p = fixture(); p.registryState = state; expect(() => plan(p)).toThrow();
  });
  for (const state of [0, 1, 3]) test(`reject escrow state ${state}`, () => {
    const p = fixture(); p.escrowState = state; expect(() => plan(p)).toThrow();
  });
  const mutations: Record<string, (p: Proof) => void> = {
    'SAFE': p => { p.decision.result = false; },
    'validation': p => { p.decision.kind = 1; },
    'zero nonce': p => { p.decision.nonce = 0n; },
    'overflow nonce': p => { p.decision.nonce = 2n ** 64n; },
    'wrong nonce': p => { p.decision.nonce++; },
    'wrong decision ID': p => { p.decision.decisionId = h(8); },
    'wrong unwind ID': p => { p.unwind.decisionId = h(8); },
    'wrong breach agreement': p => { p.decision.agreementId = h(8); },
    'wrong unwind agreement': p => { p.unwind.agreementId = h(8); },
    'partial return': p => { p.unwind.returned--; },
    'excess return': p => { p.unwind.returned++; },
    'capital mismatch': p => { p.escrow.capital++; },
    'zero capital': p => { p.agreement.capital = 0n; },
    'invalid address': p => { p.agreement.principal = h(4); },
    'same participants': p => { p.agreement.principal = p.agreement.counterparty; },
    'zero commitment': p => { p.agreement.policyCommitment = h(0); },
  };
  for (const field of ['agreementId', 'termsHash', 'policyCommitment', 'principal', 'counterparty'] as const) {
    mutations[`mismatched ${field}`] = p => { p.escrow[field] = field === 'principal' || field === 'counterparty' ? address(9) : h(9); };
  }
  for (const [name, mutate] of Object.entries(mutations)) test(`reject ${name}`, () => {
    const p = fixture(); mutate(p); expect(() => plan(p)).toThrow();
  });
});

const abi = parseAbi(['event EscrowUnwound(bytes32 indexed agreementId, bytes32 indexed decisionId, uint256 returned)']);
function receipt(): TransactionReceipt {
  return { status: 'success', transactionHash: h(11), blockHash: h(12), blockNumber: 50n,
    logs: [{ address: address(6), data: encodeAbiParameters([{ type: 'uint256' }], [100000000000n]),
      topics: encodeEventTopics({ abi, eventName: 'EscrowUnwound', args: { agreementId: h(1), decisionId: h(2) } }),
      blockHash: h(12), transactionHash: h(11), removed: false }] } as unknown as TransactionReceipt;
}
describe('receipt and event evidence', () => {
  test('accept canonical confirmed successful receipt', () => expect(() => confirmedReceipt(receipt(), h(11), h(12), 50n)).not.toThrow());
  test('reject failed receipt', () => { const r = receipt(); r.status = 'reverted'; expect(() => confirmedReceipt(r, h(11), h(12), 50n)).toThrow(); });
  test('reject wrong transaction', () => expect(() => confirmedReceipt(receipt(), h(10), h(12), 50n)).toThrow());
  test('reject reorganized block', () => expect(() => confirmedReceipt(receipt(), h(11), h(13), 50n)).toThrow());
  test('reject insufficient confirmations', () => expect(() => confirmedReceipt(receipt(), h(11), h(12), 49n)).toThrow());
  test('decode amount from exact emitter and agreement', () => expect(eventArgs(receipt(), address(6), abi, 'EscrowUnwound', h(1)).returned).toBe(100000000000n));
  test('reject wrong emitter', () => expect(() => eventArgs(receipt(), address(7), abi, 'EscrowUnwound', h(1))).toThrow());
  test('reject wrong agreement', () => expect(() => eventArgs(receipt(), address(6), abi, 'EscrowUnwound', h(9))).toThrow());
  test('reject duplicate events', () => { const r = receipt(); r.logs.push(r.logs[0]); expect(() => eventArgs(r, address(6), abi, 'EscrowUnwound', h(1))).toThrow(); });
  test('reject removed event', () => { const r = receipt(); r.logs[0].removed = true; expect(() => eventArgs(r, address(6), abi, 'EscrowUnwound', h(1))).toThrow(); });
  test('reject mismatched log block', () => { const r = receipt(); r.logs[0].blockHash = h(99); expect(() => eventArgs(r, address(6), abi, 'EscrowUnwound', h(1))).toThrow(); });
  test('reject malformed event', () => { const r = receipt(); r.logs[0].data = '0x'; expect(() => eventArgs(r, address(6), abi, 'EscrowUnwound', h(1))).toThrow(); });
});
