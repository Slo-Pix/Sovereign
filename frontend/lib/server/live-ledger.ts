import { createPublicClient, http, type Abi, type Address, type Hex } from "viem";
import agreementAbi from "../../../packages/core/abis/AgreementRegistry.json";
import escrowAbi from "../../../packages/core/abis/SovereignEscrow.json";
import canonical from "../../../deployments/canonical.json";
import { ESCROW_STATES, REGISTRY_STATES } from "./public-status";

const sepolia = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 8000, retryCount: 1 }) });
const arc = createPublicClient({ transport: http(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network", { timeout: 8000, retryCount: 1 }) });

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

export async function readLiveAgreement(id: Hex): Promise<LiveAgreement> {
  const [source, destination] = await Promise.all([
    sepolia.getBlock({ blockTag: "finalized" }),
    arc.getBlock({ blockTag: "finalized" }),
  ]);
  if (source.number === null || destination.number === null) throw new Error("Finalized block unavailable");
  const [rawAgreement, rawEscrow] = await Promise.all([
    sepolia.readContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as Abi, functionName: "agreements", args: [id], blockNumber: source.number }),
    arc.readContract({ address: canonical.arcTestnet.sovereignEscrow as Address, abi: escrowAbi as Abi, functionName: "escrows", args: [id], blockNumber: destination.number }),
  ]);
  if (!Array.isArray(rawAgreement) || rawAgreement.length !== 10 || !Array.isArray(rawEscrow) || rawEscrow.length !== 7) throw new Error("Invalid public contract response");
  const agreement = rawAgreement as [Hex, Hex, Address, Address, bigint, bigint, bigint, Hex, Hex, bigint];
  const escrow = rawEscrow as [Hex, Hex, Address, Address, bigint, Hex, bigint];
  const registryState = Number(agreement[9]);
  const escrowState = Number(escrow[6]);
  if (!REGISTRY_STATES[registryState] || !ESCROW_STATES[escrowState]) throw new Error("Unknown public state");
  return { id: agreement[0], intentId: agreement[1], principal: agreement[2], counterparty: agreement[3], capital: agreement[4], duration: agreement[5], yieldBps: agreement[6], termsHash: agreement[7], policyCommitment: agreement[8], registryState, escrowState, sepoliaBlock: source.number, arcBlock: destination.number };
}
