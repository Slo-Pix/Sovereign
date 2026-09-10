import { encodeAbiParameters, keccak256, type Hex } from 'viem';

export type Binding = {
  agreementId: Hex; termsHash: Hex; principal: Hex; counterparty: Hex;
  capital: bigint; policyCommitment: Hex;
};
export type Proof = {
  agreement: Binding; escrow: Binding; registryState: number; escrowState: number;
  decision: { agreementId: Hex; decisionId: Hex; kind: number; result: boolean; nonce: bigint };
  unwind: { agreementId: Hex; decisionId: Hex; returned: bigint };
};
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonzero = (v: string, bytes: number) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(v) && !/^0x0+$/.test(v);

/** This policy reconciles full-capital unwinds only; discretionary settlement is excluded. */
export function plan(proof: Proof): ('markUnwinding' | 'markSettled')[] {
  const { agreement: a, escrow: e, decision: d, unwind: u } = proof;
  for (const b of [a, e]) {
    if (![b.agreementId, b.termsHash, b.policyCommitment].every(v => nonzero(v, 32)) ||
        !nonzero(b.principal, 20) || !nonzero(b.counterparty, 20) ||
        same(b.principal, b.counterparty) || b.capital <= 0n) throw new Error('Invalid binding');
  }
  for (const field of ['agreementId', 'termsHash', 'principal', 'counterparty', 'policyCommitment'] as const) {
    if (!same(a[field], e[field])) throw new Error('Escrow binding mismatch');
  }
  if (a.capital !== e.capital || u.returned !== a.capital || proof.escrowState !== 2) {
    throw new Error('Full unwind not confirmed');
  }
  if (d.kind !== 2 || d.result !== true || d.nonce <= 0n || d.nonce >= 2n ** 64n ||
      !same(d.agreementId, a.agreementId) || !same(u.agreementId, a.agreementId)) {
    throw new Error('Invalid breach evidence');
  }
  const expected = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'uint64' }], [a.agreementId, 2, d.nonce],
  ));
  if (!same(d.decisionId, expected) || !same(u.decisionId, expected)) throw new Error('Decision mismatch');
  if (proof.registryState === 5) return ['markUnwinding', 'markSettled'];
  if (proof.registryState === 6) return ['markSettled'];
  // A prior operator may have used a different return amount; require manual audit.
  if (proof.registryState === 7) return [];
  throw new Error('Registry state cannot be reconciled');
}
