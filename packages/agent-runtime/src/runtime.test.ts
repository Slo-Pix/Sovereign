import { afterEach, describe, expect, test } from "bun:test";
import { readConfig } from "./runtime.js";

const names = [
  "SEPOLIA_RPC_URL", "AGENT_INTENT_ID", "AGENT_SIGNER_BACKEND", "AGENT_TREASURY_PRIVATE_KEY",
  "AGENT_STRATEGY_PRIVATE_KEY", "AGENT_TREASURY_POLICY_SALT", "AGENT_STRATEGY_POLICY_SALT",
  "TURNKEY_ORGANIZATION_ID", "TURNKEY_API_PUBLIC_KEY", "TURNKEY_API_PRIVATE_KEY",
  "TURNKEY_TREASURY_SIGNER", "TURNKEY_STRATEGY_SIGNER",
] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

function setBase(): void {
  process.env.SEPOLIA_RPC_URL = "https://sepolia.example.invalid";
  process.env.AGENT_INTENT_ID = `0x${"a".repeat(64)}`;
  process.env.AGENT_TREASURY_POLICY_SALT = `0x${"b".repeat(64)}`;
  process.env.AGENT_STRATEGY_POLICY_SALT = `0x${"c".repeat(64)}`;
}

afterEach(() => {
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe("agent runtime signer configuration", () => {
  test("requires Turnkey configuration by default", () => {
    setBase();
    expect(() => readConfig()).toThrow("Missing TURNKEY_ORGANIZATION_ID");
  });

  test("accepts a complete Turnkey configuration", () => {
    setBase();
    process.env.TURNKEY_ORGANIZATION_ID = "org_example";
    process.env.TURNKEY_API_PUBLIC_KEY = "public";
    process.env.TURNKEY_API_PRIVATE_KEY = "private";
    process.env.TURNKEY_TREASURY_SIGNER = `0x${"1".repeat(40)}`;
    process.env.TURNKEY_STRATEGY_SIGNER = `0x${"2".repeat(40)}`;
    const config = readConfig();
    expect(config.signerBackend).toBe("turnkey");
    expect(config.turnkey?.treasurySigner).toBe(`0x${"1".repeat(40)}`);
  });

  test("allows local keys only when explicitly selected", () => {
    setBase();
    process.env.AGENT_SIGNER_BACKEND = "local";
    process.env.AGENT_TREASURY_PRIVATE_KEY = `0x${"1".repeat(64)}`;
    process.env.AGENT_STRATEGY_PRIVATE_KEY = `0x${"2".repeat(64)}`;
    const config = readConfig();
    expect(config.signerBackend).toBe("local");
    expect(config.treasuryKey).toBe(`0x${"1".repeat(64)}`);
  });
});
