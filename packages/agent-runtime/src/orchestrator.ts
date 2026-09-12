import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import canonical from "../../../deployments/canonical.json" with { type: "json" };
import { readConfig, runOnce, type RuntimeResult } from "./runtime.js";

const CHAIN_ID = 11155111;
const intentCreatedEvent = parseAbiItem("event IntentCreated(bytes32 indexed intentId, address indexed creator, address asset, uint256 capital, uint256 maxDuration, bytes32 policyCommitment)");

type Job = {
  intent_id: string;
  capital: string;
  status: "DISCOVERED" | "NEGOTIATING" | "CONVERGED" | "FINALIZED" | "FAILED";
  retry_count: number;
  lease_until: number | null;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: string): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export type OrchestratorConfig = {
  rpcUrl: string;
  intentRegistry: Address;
  dbPath: string;
  stateDir: string;
  startBlock: bigint;
  maxBlocks: bigint;
  leaseSeconds: number;
  pollSeconds: number;
  broadcast: boolean;
};

export function readOrchestratorConfig(): OrchestratorConfig {
  const rpcUrl = required("SEPOLIA_RPC_URL");
  if (!rpcUrl.startsWith("https://") && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(rpcUrl)) throw new Error("SEPOLIA_RPC_URL must use HTTPS");
  const startBlock = BigInt(required("AGENT_INDEX_START_BLOCK"));
  return {
    rpcUrl,
    intentRegistry: (process.env.AGENT_INTENT_REGISTRY || canonical.sepolia.intentRegistry) as Address,
    dbPath: process.env.AGENT_ORCHESTRATOR_DB || "./state/agent-orchestrator.sqlite",
    stateDir: process.env.AGENT_STATE_DIR || "./state/agent-runs",
    startBlock,
    maxBlocks: BigInt(Math.max(1, positiveInteger("AGENT_INDEX_MAX_BLOCKS", "2000"))),
    leaseSeconds: Math.max(30, positiveInteger("AGENT_LEASE_SECONDS", "300")),
    pollSeconds: Math.max(30, positiveInteger("AGENT_SCHEDULE_SECONDS", "300")),
    broadcast: process.env.AGENT_BROADCAST === "true",
  };
}

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_jobs (
      intent_id TEXT PRIMARY KEY,
      capital TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('DISCOVERED','NEGOTIATING','CONVERGED','FINALIZED','FAILED')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER,
      last_error TEXT,
      agreement_id TEXT,
      run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS agent_jobs_claimable ON agent_jobs(status, lease_until);
  `);
  return db;
}

function cursor(db: Database, fallback: bigint): bigint {
  const row = db.query("SELECT value FROM metadata WHERE key = 'source_cursor'").get() as { value: string } | null;
  return row ? BigInt(row.value) : fallback;
}

export async function indexFinalizedIntents(db: Database, config: OrchestratorConfig): Promise<number> {
  const client = createPublicClient({ chain: { id: CHAIN_ID, name: "Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } }, transport: http(config.rpcUrl) });
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const from = cursor(db, config.startBlock);
  if (from > finalized.number) return 0;
  const to = from + config.maxBlocks - 1n > finalized.number ? finalized.number : from + config.maxBlocks - 1n;
  const logs = await client.getLogs({ address: config.intentRegistry, event: intentCreatedEvent, fromBlock: from, toBlock: to });
  const insert = db.query("INSERT OR IGNORE INTO agent_jobs (intent_id, capital, status) VALUES (?, ?, 'DISCOVERED')");
  for (const log of logs) {
    const args = log.args as { intentId?: Hex; capital?: bigint };
    if (!args.intentId || args.capital === undefined || args.capital <= 0n) throw new Error("Malformed IntentCreated log");
    insert.run(args.intentId.toLowerCase(), args.capital.toString());
  }
  db.query("INSERT INTO metadata (key, value) VALUES ('source_cursor', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run((to + 1n).toString());
  return logs.length;
}

export function claimJob(db: Database, leaseSeconds: number): Job | null {
  const now = Math.floor(Date.now() / 1000);
  const leaseUntil = now + leaseSeconds;
  const transaction = db.transaction(() => {
    const job = db.query(`SELECT intent_id, capital, status, retry_count, lease_until FROM agent_jobs
      WHERE status IN ('DISCOVERED','FAILED','NEGOTIATING') AND (lease_until IS NULL OR lease_until <= ?)
      ORDER BY created_at ASC LIMIT 1`).get(now) as Job | null;
    if (!job) return null;
    const changed = db.query(`UPDATE agent_jobs SET status='NEGOTIATING', lease_until=?, retry_count=retry_count+1, updated_at=CURRENT_TIMESTAMP
      WHERE intent_id=? AND status IN ('DISCOVERED','FAILED','NEGOTIATING') AND (lease_until IS NULL OR lease_until <= ?)`).run(leaseUntil, job.intent_id, now);
    return changed.changes === 1 ? { ...job, status: "NEGOTIATING" as const, lease_until: leaseUntil, retry_count: job.retry_count + 1 } : null;
  });
  return transaction();
}

function complete(db: Database, job: Job, result: RuntimeResult): void {
  const status = result.agreementId ? "FINALIZED" : "CONVERGED";
  db.query(`UPDATE agent_jobs SET status=?, lease_until=NULL, agreement_id=?, run_id=?, last_error=NULL, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE intent_id=?`).run(status, result.agreementId || null, result.runId, job.intent_id);
}

function fail(db: Database, job: Job, error: unknown): void {
  const message = error instanceof Error ? error.message : "agent run failed";
  db.query("UPDATE agent_jobs SET status='FAILED', lease_until=NULL, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE intent_id=?").run(message.slice(0, 1000), job.intent_id);
}

export async function processOne(db: Database, config: OrchestratorConfig, runner = runOnce, configReader: (intentId: Hex) => ReturnType<typeof readConfig> = readConfig): Promise<RuntimeResult | null> {
  const job = claimJob(db, config.leaseSeconds);
  if (!job) return null;
  try {
    const runtime = configReader(job.intent_id as Hex);
    const result = await runner({ ...runtime, capital: BigInt(job.capital), broadcast: config.broadcast, stateFile: `${config.stateDir}/${job.intent_id}.json` });
    complete(db, job, result);
    return result;
  } catch (error) {
    fail(db, job, error);
    throw error;
  }
}

export async function runOrchestrator(config: OrchestratorConfig, once = false): Promise<void> {
  const db = openDatabase(config.dbPath);
  try {
    do {
      const indexed = await indexFinalizedIntents(db, config);
      const result = await processOne(db, config);
      console.log(JSON.stringify({ indexed, result }));
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000));
    } while (true);
  } finally {
    db.close();
  }
}
