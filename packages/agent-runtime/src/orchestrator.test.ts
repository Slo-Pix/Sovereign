import assert from "node:assert/strict";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createTestClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { withLocalEvm } from "../../../packages/cre/scripts/local-evm.js";
import { claimJob, indexFinalizedIntents, openDatabase, processOne, type OrchestratorConfig } from "./orchestrator.js";
import type { RuntimeConfig, RuntimeResult } from "./runtime.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("unattended orchestrator acceptance: discovery, restart, lease recovery, and idempotency", async () => {
  const directory = mkdtempSync(join("/tmp", "sovereign-agent-orchestrator-"));
  directories.push(directory);
  await withLocalEvm(async ({ sepolia, artifact }) => {
    const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex);
    const chain = defineChain({ id: 11155111, name: "Local Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [sepolia.url] } } });
    const wallet = createWalletClient({ account: deployer, chain, transport: http(sepolia.url) });
    const control = createTestClient({ chain, mode: "anvil", transport: http(sepolia.url) });
    const compiled = await artifact("IntentRegistry");
    const deployment = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode.object, gas: 1_000_000n });
    const receipt = await sepolia.public.waitForTransactionReceipt({ hash: deployment });
    assert.ok(receipt.contractAddress);
    const registry = receipt.contractAddress as Address;
    const intentAbi = parseAbi(["function createIntent(address asset,uint256 capital,uint256 maxDuration,bytes32 policyCommitment) returns (bytes32)"]);
    const create = async (capital: bigint) => {
      const hash = await wallet.writeContract({ address: registry, abi: intentAbi, functionName: "createIntent", args: [deployer.address, capital, 30n, `0x${"22".repeat(32)}`] });
      return sepolia.public.waitForTransactionReceipt({ hash });
    };
    const startBlock = await sepolia.public.getBlockNumber();
    const a = await create(100_000_000_000n);
    const b = await create(200_000_000_000n);
    await control.mine({ blocks: 300 });
    const eventAbi = parseAbi(["event IntentCreated(bytes32 indexed intentId,address indexed creator,address asset,uint256 capital,uint256 maxDuration,bytes32 policyCommitment)"]);
    const intentA = (parseEventLogs({ abi: eventAbi, logs: a.logs, eventName: "IntentCreated", strict: true })[0]!.args as { intentId: Hex }).intentId;
    const intentB = (parseEventLogs({ abi: eventAbi, logs: b.logs, eventName: "IntentCreated", strict: true })[0]!.args as { intentId: Hex }).intentId;
    const config: OrchestratorConfig = {
      rpcUrl: sepolia.url, intentRegistry: registry, dbPath: join(directory, "orchestrator.sqlite"), stateDir: join(directory, "runs"),
      startBlock, maxBlocks: 100n, leaseSeconds: 30, pollSeconds: 30, broadcast: false,
    };
    const db = openDatabase(config.dbPath);
    expect(await indexFinalizedIntents(db, config)).toBe(2);
    expect((db.query("SELECT COUNT(*) AS count FROM agent_jobs").get() as { count: number }).count).toBe(2);
    const runner = async (runtime: RuntimeConfig): Promise<RuntimeResult> => ({ runId: `run-${runtime.intentId.slice(2, 6)}`, status: "CONVERGED", intentId: runtime.intentId, principal: deployer.address, counterparty: `0x${"44".repeat(20)}`, rounds: 4, completedAt: new Date().toISOString() });
    const configReader = (intentId: Hex): RuntimeConfig => ({ intentId, capital: 1n, signerBackend: "local", rpcUrl: sepolia.url, broadcast: false, stateFile: join(directory, "unused.json") });
    expect(await processOne(db, config, runner, configReader)).not.toBeNull();
    expect(await processOne(db, config, runner, configReader)).not.toBeNull();
    expect(await processOne(db, config, runner, configReader)).toBeNull();
    db.close();

    // Restart: reopening the durable database must not renegotiate A or B.
    const restarted = openDatabase(config.dbPath);
    expect(await processOne(restarted, config, runner, configReader)).toBeNull();

    // Re-indexing the exact same range is harmless because intent_id is the primary key.
    restarted.query("UPDATE metadata SET value=? WHERE key='source_cursor'").run(startBlock.toString());
    expect(await indexFinalizedIntents(restarted, config)).toBe(2);
    expect((restarted.query("SELECT COUNT(*) AS count FROM agent_jobs").get() as { count: number }).count).toBe(2);

    // Simulate a killed worker: the lease expires and another worker reclaims the job.
    const insert = restarted.query("INSERT INTO agent_jobs (intent_id, capital, status) VALUES (?, ?, 'DISCOVERED')");
    const intentC = `0x${"cc".repeat(32)}`;
    insert.run(intentC, "300000000000");
    expect(claimJob(restarted, 1)?.intent_id).toBe(intentC);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(claimJob(restarted, 1)?.intent_id).toBe(intentC);
    restarted.close();
    expect(existsSync(config.dbPath)).toBe(true);
    expect(intentA).not.toBe(intentB);
  });
});
