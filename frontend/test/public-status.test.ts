import { describe, expect, it } from "vitest";
import { publicStatusResponse, type SnapshotReader } from "../lib/server/public-status";

const id = `0x${"bb".repeat(32)}`;
const snapshot = { sepolia: { chainId: 11155111, blockNumber: 123n, state: 4 }, arc: { chainId: 5042002, blockNumber: 456n, state: 1 } };
describe("public status boundary", () => {
  it("emits only public state, never provider extra fields", async () => {
    const response = await publicStatusResponse(id, async () => ({ ...snapshot, privatePolicy: "never-send" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data.evidenceMode).toBe("LIVE_RPC_READS");
    expect(data.chains.sepolia.state).toBe("ACTIVE");
    expect(JSON.stringify(data)).not.toContain("never-send");
    expect(Object.keys(data)).toEqual(["evidenceMode", "agreementId", "chains", "warning"]);
  });
  it("rejects malformed IDs before RPC", async () => {
    let calls = 0;
    for (const value of ["SOV-8F29", `${id}\n`, "../position", ""]) {
      expect((await publicStatusResponse(value, async () => { calls++; return snapshot; })).status).toBe(400);
    }
    expect(calls).toBe(0);
  });
  it("does not leak credentials or invent demo state on RPC failure", async () => {
    const response = await publicStatusResponse(id, async () => { throw new Error("https://rpc.invalid/secret-key"); });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Public status unavailable" });
  });
  it("rejects wrong chains and invalid state responses", async () => {
    const readers: SnapshotReader[] = [
      async () => ({ ...snapshot, sepolia: { ...snapshot.sepolia, chainId: 1 } }),
      async () => ({ ...snapshot, arc: { ...snapshot.arc, state: 99 } }),
      async () => ({ ...snapshot, arc: { ...snapshot.arc, blockNumber: -1n } }),
    ];
    for (const read of readers) expect((await publicStatusResponse(id, read)).status).toBe(503);
  });
});