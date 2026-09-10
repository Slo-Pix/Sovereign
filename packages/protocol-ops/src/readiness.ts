import { erc20Abi, isAddress, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { abis, addresses as a, clients, emit } from './common';
import { same } from './policy';

try {
  if (process.argv.length > 2) throw new Error('Unexpected arguments');
  const { source, destination } = clients();
  const [sourceId, destId, s, d] = await Promise.all([
    source.getChainId(), destination.getChainId(), source.getBlock(), destination.getBlock(),
  ]);
  if (sourceId !== 11155111 || destId !== 5042002 || s.number === null || d.number === null) throw new Error('Wrong network');
  const readSource = (contract: Hex, abi: typeof abis.registry, functionName: string) =>
    source.readContract({ address: contract, abi, functionName, blockNumber: s.number! });
  const readArc = (functionName: string) => destination.readContract({
    address: a.escrow, abi: abis.escrow, functionName, blockNumber: d.number!,
  });
  const [registrySink, sinkRegistry, registryIntent, registryOwner, sinkOwner, forwarder, token, relayer, tokenDecimals] = await Promise.all([
    readSource(a.registry, abis.registry, 'decisionSink'), readSource(a.sink, abis.sink, 'agreementRegistry'),
    readSource(a.registry, abis.registry, 'intentRegistry'), readSource(a.registry, abis.registry, 'owner'),
    readSource(a.sink, abis.sink, 'owner'), readSource(a.sink, abis.sink, 'forwarder'),
    readArc('token'), readArc('relayer'), destination.readContract({ address: a.token, abi: erc20Abi, functionName: 'decimals', blockNumber: d.number }),
  ]) as [Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, number];
  if (!same(registrySink, a.sink) || !same(sinkRegistry, a.registry) || !same(registryIntent, a.intent) ||
      !same(token, a.token) || !same(relayer, a.relayer) || tokenDecimals !== 6) throw new Error('Canonical wiring mismatch');
  for (const contract of [a.registry, a.sink, a.intent]) {
    const code = await source.getCode({ address: contract, blockNumber: s.number });
    if (!code || code === '0x') throw new Error('Source bytecode missing');
  }
  for (const contract of [a.escrow, a.token]) {
    const code = await destination.getCode({ address: contract, blockNumber: d.number });
    if (!code || code === '0x') throw new Error('Destination bytecode missing');
  }
  const principal = process.env.ARC_PRINCIPAL_ADDRESS;
  if (principal && (!isAddress(principal) || principal === zeroAddress)) throw new Error('Invalid principal');
  const amount = process.env.ARC_REQUIRED_CAPITAL;
  if (amount && (!/^[1-9][0-9]*$/.test(amount) || BigInt(amount) >= 2n ** 256n)) throw new Error('Invalid capital');
  const principalFunding = principal ? {
    address: principal,
    usdcBaseUnits: await destination.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [principal as Hex], blockNumber: d.number }),
    allowanceBaseUnits: await destination.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [principal as Hex, a.escrow], blockNumber: d.number }),
    requiredBaseUnits: amount ? BigInt(amount) : null,
  } : null;
  const relayerGas = await destination.getBalance({ address: relayer, blockNumber: d.number });
  const relayerCode = await destination.getCode({ address: relayer, blockNumber: d.number });
  const signer = process.env.DEPLOYER_PRIVATE_KEY ? privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex).address : null;
  const relayerSigner = process.env.ARC_RELAYER_PRIVATE_KEY ? privateKeyToAccount(process.env.ARC_RELAYER_PRIVATE_KEY as Hex).address : null;
  const blockers: string[] = [];
  if (!signer || !same(signer, sinkOwner) || !same(signer, registryOwner)) blockers.push('OWNER_KEY_MISSING_OR_MISMATCH');
  if (!relayerSigner || !same(relayerSigner, relayer)) blockers.push('RELAYER_KEY_MISSING_OR_MISMATCH');
  if (relayerCode && relayerCode !== '0x') blockers.push('RELAYER_IS_NOT_PLAIN_EOA');
  if (relayerGas === 0n) blockers.push('RELAYER_GAS_ZERO');
  if (!principalFunding || !amount) blockers.push('AGREEMENT_PRINCIPAL_OR_CAPITAL_MISSING');
  else if (principalFunding.usdcBaseUnits < BigInt(amount) || principalFunding.allowanceBaseUnits < BigInt(amount)) blockers.push('PRINCIPAL_USDC_OR_ALLOWANCE_INSUFFICIENT');
  const receiverAddress = process.env.CRE_REPORT_RECEIVER;
  let receiver: unknown = null;
  if (receiverAddress && isAddress(receiverAddress) && process.env.CRE_WORKFLOW_ID && process.env.CRE_WORKFLOW_OWNER && process.env.CRE_REPORT_FORWARDER) {
    const [receiverSink, receiverForwarder, workflowId, workflowOwner] = await Promise.all(
      ['sink', 'forwarder', 'workflowId', 'workflowOwner'].map(name => readSource(receiverAddress as Hex, abis.receiver, name)),
    ) as Hex[];
    if (!same(receiverSink, a.sink) || !same(forwarder, receiverAddress) ||
        !same(receiverForwarder, process.env.CRE_REPORT_FORWARDER) || !same(workflowId, process.env.CRE_WORKFLOW_ID) ||
        !same(workflowOwner, process.env.CRE_WORKFLOW_OWNER)) throw new Error('Receiver identity mismatch');
    receiver = { address: receiverAddress, forwarder: receiverForwarder, workflowId, workflowOwner };
  } else blockers.push('APPROVED_RECEIVER_IDENTITY_OR_DEPLOYMENT_MISSING');
  emit({ evidenceMode: 'LIVE_RPC_READS_ONLY_NO_TRANSACTIONS', checkedAt: new Date().toISOString(),
    source: { chainId: sourceId, blockNumber: s.number, blockHash: s.hash, ...a, registryOwner, sinkOwner, forwarder, signer },
    arc: { chainId: destId, blockNumber: d.number, blockHash: d.hash, escrow: a.escrow, token, tokenDecimals, relayer,
      relayerSigner, relayerGasBaseUnits: relayerGas, principalFunding }, receiver, blockers,
    limits: ['RPC state/wiring only, not bytecode attestation or DON approval', 'Positive gas balance is not a transaction gas estimate', 'No funded agreement or end-to-end execution proved'],
  });
  if (blockers.length) process.exitCode = 2;
} catch {
  console.error('Readiness check failed: check network, canonical wiring and local configuration. Provider diagnostics are suppressed.');
  process.exitCode = 1;
}
