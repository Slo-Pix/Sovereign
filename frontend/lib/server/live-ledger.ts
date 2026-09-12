import { createPublicClient, http, parseAbiItem, type Abi, type Address, type Hex } from "viem";
import agreementAbi from "../../../packages/core/abis/AgreementRegistry.json";
import escrowAbi from "../../../packages/core/abis/SovereignEscrow.json";
import canonical from "../../../deployments/canonical.json";
import { ESCROW_STATES, REGISTRY_STATES } from "./public-status";

const sepolia = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 8000, retryCount: 2, retryDelay: 1000 }) });
const arc = createPublicClient({ transport: http(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network", { timeout: 8000, retryCount: 2, retryDelay: 1000 }) });
const indexSepolia = createPublicClient({ transport: http(process.env.AGREEMENT_INDEX_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 10000, retryCount: 2, retryDelay: 1000 }) });
const agreementOpenedEvent = parseAbiItem("event AgreementOpened(bytes32 indexed agreementId, bytes32 indexed intentId)");

export type LiveAgreement = {
  id: Hex;
  intentId: Hex;
  principal: Address;
  counterparty: Address;
  capital: bigint;
  duration: bigint;
  yieldBps: bigint;
  termsHash: Hex;
  policyCommitment: Hex;
  registryState: number;
  escrowState: number;
  sepoliaBlock: bigint;
  arcBlock: bigint;
};

async function readLiveAgreementAt(id: Hex, sourceBlock: bigint, destinationBlock: bigint): Promise<LiveAgreement> {
  const [rawAgreement, rawEscrow] = await Promise.all([
    sepolia.readContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as Abi, functionName: "agreements", args: [id], blockNumber: sourceBlock }),
    arc.readContract({ address: canonical.arcTestnet.sovereignEscrow as Address, abi: escrowAbi as Abi, functionName: "escrows", args: [id], blockNumber: destinationBlock }),
  ]);
  if (!Array.isArray(rawAgreement) || rawAgreement.length !== 10 || !Array.isArray(rawEscrow) || rawEscrow.length !== 7) throw new Error("Invalid public contract response");
  const agreement = rawAgreement as [Hex, Hex, Address, Address, bigint, bigint, bigint, Hex, Hex, bigint];
  const escrow = rawEscrow as [Hex, Hex, Address, Address, bigint, Hex, bigint];
  const registryState = Number(agreement[9]);
  const escrowState = Number(escrow[6]);
  if (!REGISTRY_STATES[registryState] || !ESCROW_STATES[escrowState]) throw new Error("Unknown public state");
  return { id: agreement[0], intentId: agreement[1], principal: agreement[2], counterparty: agreement[3], capital: agreement[4], duration: agreement[5], yieldBps: agreement[6], termsHash: agreement[7], policyCommitment: agreement[8], registryState, escrowState, sepoliaBlock: sourceBlock, arcBlock: destinationBlock };
}

export async function readLiveAgreement(id: Hex): Promise<LiveAgreement> {
  const [source, destination] = await Promise.all([
    sepolia.getBlock({ blockTag: "finalized" }),
    arc.getBlock({ blockTag: "finalized" }),
  ]);
  if (source.number === null || destination.number === null) throw new Error("Finalized block unavailable");
  return readLiveAgreementAt(id, source.number, destination.number);
}

export type LiveAgreementIndex = {
  agreements: LiveAgreement[];
  fromBlock: bigint;
  toBlock: bigint;
  truncated: boolean;
};

function positiveBigInt(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function getAgreementLogs(fromBlock: bigint, toBlock: bigint): Promise<Hex[]> {
  const filter = { address: canonical.sepolia.agreementRegistry as Address, event: agreementOpenedEvent, fromBlock, toBlock } as const;
  try {
    // Prefer one indexed query when the provider supports it. This avoids
    // hundreds of requests on public RPCs with normal eth_getLogs limits.
    const logs = await indexSepolia.getLogs(filter);
    return [...new Set(logs.map((log) => log.args.agreementId?.toLowerCase()).filter(Boolean))] as Hex[];
  } catch {
    // Alchemy free tier limits eth_getLogs to ten blocks; fall back to small
    // bounded ranges only for providers that reject the broad query.
  }
  const chunkSize = positiveBigInt("AGREEMENT_INDEX_CHUNK_BLOCKS", 10n);
  const ranges: Array<[bigint, bigint]> = [];
  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    ranges.push([from, from + chunkSize - 1n > toBlock ? toBlock : from + chunkSize - 1n]);
  }
  const ids = new Set<string>();
  // Keep the concurrency deliberately low: free RPC plans commonly rate-limit
  // eth_getLogs by compute units per second even when each range is valid.
  for (let offset = 0; offset < ranges.length; offset += 2) {
    const batch = await Promise.all(ranges.slice(offset, offset + 2).map(([from, to]) => indexSepolia.getLogs({
      address: canonical.sepolia.agreementRegistry as Address,
      event: agreementOpenedEvent,
      fromBlock: from,
      toBlock: to,
    })));
    for (const logs of batch) {
      for (const log of logs) {
        const id = log.args.agreementId;
        if (id) ids.add(id.toLowerCase());
      }
    }
  }
  return [...ids] as Hex[];
}

export async function indexLiveAgreements(): Promise<LiveAgreementIndex> {
  const [source, destination] = await Promise.all([
    sepolia.getBlock({ blockTag: "finalized" }),
    arc.getBlock({ blockTag: "finalized" }),
  ]);
  if (source.number === null || destination.number === null) throw new Error("Finalized block unavailable");
  const configuredStart = process.env.AGREEMENT_INDEX_START_BLOCK;
  const lookback = positiveBigInt("AGREEMENT_INDEX_LOOKBACK_BLOCKS", 5000n);
  let requestedFrom = source.number - lookback + 1n;
  if (configuredStart) {
    try {
      requestedFrom = BigInt(configuredStart);
    } catch {
      throw new Error("Invalid AGREEMENT_INDEX_START_BLOCK");
    }
  }
  const fromBlock = requestedFrom < 0n ? 0n : requestedFrom;
  const ids = await getAgreementLogs(fromBlock, source.number);
  const agreements = (await Promise.all(ids.map((id) => readLiveAgreementAt(id, source.number!, destination.number!)))).sort((a, b) => a.sepoliaBlock < b.sepoliaBlock ? 1 : -1);
  return { agreements, fromBlock, toBlock: source.number, truncated: !configuredStart && fromBlock > 0n };
}
