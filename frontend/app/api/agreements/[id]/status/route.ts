import { publicStatusResponse, readPublicSnapshots } from "@/lib/server/public-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publicStatusResponse(id, readPublicSnapshots);
}