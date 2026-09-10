import { createPublicClient, http, type Abi, type Hex } from "viem";
import agreementAbi from "../../../packages/core/abis/AgreementRegistry.json";
import escrowAbi from "../../../packages/core/abis/SovereignEscrow.json";
import canonical from "../../../deployments/canonical.json";

export const REGISTRY_STATES = ["NONE", "OPEN", "NEGOTIATING", "PENDING_VALIDATION", "ACTIVE", "BREACHED", "UNWIND", "SETTLED", "CANCELLED", "REJECTED"];
export const ESCROW_STATES = ["NONE", "ACTIVE", "UNWOUND", "SETTLED"];
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export const validAgreementId = (id: string): id is Hex => id.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(id);

export type SnapshotReader = (id: Hex) => Promise<{
  sepolia: { chainId: number; blockNumber: bigint; state: number };
  arc: { chainId: number; blockNumber: bigint; state: number };
}>;

export async function publicStatusResponse(id: string, read: SnapshotReader): Promise<Response> {
  if (!validAgreementId(id)) return Response.json({ error: "Invalid agreement ID" }, { status: 400, headers });
  try {
    const { sepolia, arc } = await read(id.toLowerCase() as Hex);
    if (sepolia.chainId !== 11155111 || arc.chainId !== 5042002 || sepolia.blockNumber < 0n || arc.blockNumber < 0n ||
      !Number.isInteger(sepolia.state) || !REGISTRY_STATES[sepolia.state] ||
      !Number.isInteger(arc.state) || !ESCROW_STATES[arc.state]) throw new Error("Invalid chain response");
    return Response.json({
      evidenceMode: "LIVE_RPC_READS", agreementId: id.toLowerCase(),
      chains: {
        sepolia: { chainId: sepolia.chainId, blockNumber: sepolia.blockNumber.toString(), state: REGISTRY_STATES[sepolia.state] },
        arc: { chainId: arc.chainId, blockNumber: arc.blockNumber.toString(), state: ESCROW_STATES[arc.state] },
      },
      warning: "Independent finalized public snapshots only. ACTIVE is not a fresh SAFE attestation. No transaction or private evaluation is performed by this request.",
    }, { headers });
  } catch {
    // Provider exceptions can contain RPC credentials. Never serialize them or fall back to fixtures.
    return Response.json({ error: "Public status unavailable" }, { status: 503, headers });
  }
}

export const readPublicSnapshots: SnapshotReader = async id => {
  const sepolia = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 8000, retryCount: 0 }) });
  const arc = createPublicClient({ transport: http(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network", { timeout: 8000, retryCount: 0 }) });
  const [sepoliaId, arcId, sourceBlock, destBlock] = await Promise.all([
    sepolia.getChainId(), arc.getChainId(), sepolia.getBlock({ blockTag: "finalized" }), arc.getBlock({ blockTag: "finalized" }),
  ]);
  if (sepoliaId !== 11155111 || arcId !== 5042002 || sourceBlock.number === null || destBlock.number === null) throw new Error("Invalid network");
  const [agreement, escrow] = await Promise.all([
    sepolia.readContract({ address: canonical.sepolia.agreementRegistry as Hex, abi: agreementAbi as Abi, functionName: "agreements", args: [id], blockNumber: sourceBlock.number }),
    arc.readContract({ address: canonical.arcTestnet.sovereignEscrow as Hex, abi: escrowAbi as Abi, functionName: "escrows", args: [id], blockNumber: destBlock.number }),
  ]);
  if (!Array.isArray(agreement) || agreement.length !== 10 || !Array.isArray(escrow) || escrow.length !== 7) throw new Error("Invalid contract response");
  return {
    sepolia: { chainId: sepoliaId, blockNumber: sourceBlock.number, state: Number(agreement[9]) },
    arc: { chainId: arcId, blockNumber: destBlock.number, state: Number(escrow[6]) },
  };
};