import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  createPublicClient, createWalletClient, http, parseEventLogs,
  type Address, type Hex, type Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { erc20Abi } from 'viem';
import { hashPolicy, hashTerms, offerDigest, type Policy, type Terms } from '../../core/src/index';
import intentAbi from '../../core/abis/IntentRegistry.json';
import registryAbi from '../../core/abis/AgreementRegistry.json';
import canonical from '../../../deployments/canonical.json';
import { required } from './common';
import { same } from './policy';

const ROOT = resolve(import.meta.dir, '../../..');

const registry = canonical.sepolia.agreementRegistry as Address;
const intents = canonical.sepolia.intentRegistry as Address;
const escrow = canonical.arcTestnet.sovereignEscrow as Address;
const token = canonical.arcTestnet.usdc as Address;
const sourceChain = { id: 11155111, name: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [] } } } as const;
const destinationChain = { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'Arc', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [] } } } as const;
const offerTypes = {
  Offer: [
    { name: 'intentId', type: 'bytes32' }, { name: 'proposer', type: 'address' },
    { name: 'capital', type: 'uint256' }, { name: 'duration', type: 'uint256' },
    { name: 'yieldBps', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

function privateKey(name: string) {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid private key configuration');
  return value as Hex;
}
function uint(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (!value) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`Invalid ${name}`);
  return BigInt(value);
}
function rpc(name: string) {
  const value = required(name), parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('RPC endpoints must use HTTPS');
  return value;
}
function localFile(value: string | undefined, fallback: string) {
  return isAbsolute(value || '') ? value! : resolve(ROOT, value || fallback);
}
function publicFile() { return localFile(process.env.DEMO_PUBLIC_FILE, 'packages/cre/.local/demo.public.json'); }
function privateFile() { return localFile(process.env.DEMO_POLICY_FILE, 'packages/cre/.local/demo.policy.json'); }
function txResult(receipt: { transactionHash: Hex; blockNumber: bigint }) {
  return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString() };
}

async function main() {
  const capital = uint('ARC_REQUIRED_CAPITAL', 10_000_000n);
  const duration = uint('DEMO_DURATION', 1_814_400n);
  const maxDuration = uint('DEMO_MAX_DURATION', 2_592_000n);
  const yieldBps = uint('DEMO_YIELD_BPS', 880n);
  if (capital > 20_000_000n || duration > maxDuration) throw new Error('Demo terms exceed configured safety bounds');

  const ownerKey = privateKey('DEPLOYER_PRIVATE_KEY');
  const relayerKey = privateKey('ARC_RELAYER_PRIVATE_KEY');
  const owner = privateKeyToAccount(ownerKey);
  const counterparty = privateKeyToAccount(relayerKey);
  if (process.env.DEPLOYER_ADDRESS && !same(owner.address, process.env.DEPLOYER_ADDRESS)) throw new Error('Owner key mismatch');
  if (same(owner.address, counterparty.address)) throw new Error('Principal and counterparty must differ');
  const policy: Policy = { minYieldBps: 800n, maxLossBps: 300n, maxDuration, salt: `0x${randomBytes(32).toString('hex')}` as Hex };
  const policyCommitment = hashPolicy(policy);

  const sourceTransport = http(rpc('SEPOLIA_RPC_URL'), { timeout: 20_000, retryCount: 0 });
  const arcTransport = http(rpc('ARC_RPC_URL'), { timeout: 20_000, retryCount: 0 });
  const source = createPublicClient({ chain: sourceChain, transport: sourceTransport });
  const arc = createPublicClient({ chain: destinationChain, transport: arcTransport });
  const sourceWallet = createWalletClient({ account: owner, chain: sourceChain, transport: sourceTransport });
  const arcWallet = createWalletClient({ account: owner, chain: destinationChain, transport: arcTransport });

  const [sourceId, arcId, block] = await Promise.all([source.getChainId(), arc.getChainId(), source.getBlock()]);
  if (sourceId !== 11155111 || arcId !== 5042002) throw new Error('Wrong testnet');
  const currentAllowance = await arc.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner.address, escrow] });
  if (currentAllowance < capital && process.argv.includes('--broadcast') === false) {
    console.log(JSON.stringify({ mode: 'dry-run', principal: owner.address, counterparty: counterparty.address, capital: capital.toString(), requiredApproval: capital.toString(), currentAllowance: currentAllowance.toString(), policyCommitment }, null, 2));
    return;
  }
  if (!process.argv.includes('--broadcast')) {
    console.log(JSON.stringify({ mode: 'dry-run', principal: owner.address, counterparty: counterparty.address, capital: capital.toString(), policyCommitment }, null, 2));
    return;
  }

  const intentHash = await sourceWallet.writeContract({ address: intents, abi: intentAbi as Abi, functionName: 'createIntent', args: [token, capital, maxDuration, policyCommitment] });
  const intentReceipt = await source.waitForTransactionReceipt({ hash: intentHash, confirmations: 1 });
  const intentEvent = parseEventLogs({ abi: intentAbi as Abi, logs: intentReceipt.logs, eventName: 'IntentCreated', strict: true }) as unknown as { args: { intentId: Hex } }[];
  if (intentEvent.length !== 1) throw new Error('IntentCreated event missing');
  const intentId = intentEvent[0].args.intentId as Hex;

  const openHash = await sourceWallet.writeContract({ address: registry, abi: registryAbi as Abi, functionName: 'openAgreement', args: [intentId] });
  const openReceipt = await source.waitForTransactionReceipt({ hash: openHash, confirmations: 1 });
  const opened = parseEventLogs({ abi: registryAbi as Abi, logs: openReceipt.logs, eventName: 'AgreementOpened', strict: true }) as unknown as { args: { agreementId: Hex } }[];
  if (opened.length !== 1) throw new Error('AgreementOpened event missing');
  const agreementId = opened[0].args.agreementId as Hex;

  const negotiateHash = await sourceWallet.writeContract({ address: registry, abi: registryAbi as Abi, functionName: 'beginNegotiation', args: [agreementId, counterparty.address] });
  const negotiateReceipt = await source.waitForTransactionReceipt({ hash: negotiateHash, confirmations: 1 });
  const now = (await source.getBlock()).timestamp;
  const terms: Terms = { intentId, principal: owner.address, counterparty: counterparty.address, capital, duration, yieldBps, expiresAt: now + 86_400n, nonce: 1n };
  const signature = await counterparty.sign({ hash: offerDigest(terms, registry) });
  const finalizeHash = await sourceWallet.writeContract({ address: registry, abi: registryAbi as Abi, functionName: 'finalizeAgreement', args: [agreementId, terms, signature] });
  const finalizeReceipt = await source.waitForTransactionReceipt({ hash: finalizeHash, confirmations: 1 });

  const approvalHash = currentAllowance < capital
    ? await arcWallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [escrow, capital] })
    : null;
  const approvalReceipt = approvalHash ? await arc.waitForTransactionReceipt({ hash: approvalHash, confirmations: 1 }) : null;
  const out = { schemaVersion: 1, evidenceMode: 'PUBLIC_TESTNET_BOOTSTRAP_MOCK_CRE_PENDING_VALIDATION', chainIds: { sepolia: sourceId, arc: arcId }, agreementId, intentId, terms, termsHash: hashTerms(terms), policyCommitment, principal: owner.address, counterparty: counterparty.address, capital: capital.toString(), transactions: { createIntent: txResult(intentReceipt), openAgreement: txResult(openReceipt), beginNegotiation: txResult(negotiateReceipt), finalizeAgreement: txResult(finalizeReceipt), approve: approvalReceipt ? txResult(approvalReceipt) : null }, next: 'Freeze CRE config and predicted receiver identity before deploying receiver.' };
  await mkdir(resolve(ROOT, 'packages/cre/.local'), { recursive: true, mode: 0o700 });
  await writeFile(publicFile(), JSON.stringify(out, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', { mode: 0o600 });
  await writeFile(privateFile(), JSON.stringify({ policy }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', { mode: 0o600 });
  await chmod(publicFile(), 0o600); await chmod(privateFile(), 0o600);
  console.log(JSON.stringify({ ...out, privatePolicyFile: privateFile() }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch(() => { console.error('Demo bootstrap failed: check local configuration and public testnet state.'); process.exitCode = 1; });
