import { createPublicClient, http, isAddress, zeroAddress, type Hex, type Abi } from 'viem';
import canonical from '../../../deployments/canonical.json';
import registry from '../../core/abis/AgreementRegistry.json';
import sink from '../../core/abis/DecisionSink.json';
import escrow from '../../core/abis/SovereignEscrow.json';
import receiver from '../../core/abis/CREDecisionReceiver.json';
export const abis = { registry: registry as Abi, sink: sink as Abi, escrow: escrow as Abi, receiver: receiver as Abi };
export const addresses = {
  registry: canonical.sepolia.agreementRegistry as Hex,
  sink: canonical.sepolia.decisionSink as Hex,
  intent: canonical.sepolia.intentRegistry as Hex,
  escrow: canonical.arcTestnet.sovereignEscrow as Hex,
  token: canonical.arcTestnet.usdc as Hex,
  relayer: canonical.arcTestnet.relayer as Hex,
};
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing configuration');
  return value;
}
export function address(name: string): Hex {
  const value = required(name);
  if (!isAddress(value) || value === zeroAddress) throw new Error('Invalid address');
  return value;
}
export function hash(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0+$/.test(value)) throw new Error('Invalid hash');
  return value as Hex;
}
export function clients() {
  const transport = (name: string) => {
    const value = required(name), url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('Invalid RPC transport');
    }
    return http(value, { timeout: 15000, retryCount: 0 });
  };
  return {
    source: createPublicClient({ transport: transport('SEPOLIA_RPC_URL') }),
    destination: createPublicClient({ transport: transport('ARC_RPC_URL') }),
  };
}
export function emit(value: unknown) {
  console.log(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
