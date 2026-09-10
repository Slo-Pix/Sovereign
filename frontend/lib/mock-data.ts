// DEMO / SYNTHETIC ONLY. Public-term examples, not RPC results or receipts.
// Never add private policy values, evaluation history, risk scores or proofs.

export const AGREEMENTS = [
  {
    id: "SOV-8F29",
    type: "COLLATERALIZED LOAN",
    status: "ACTIVE",
    partyA: { name: "Treasury example A" },
    partyB: { name: "Strategy example A" },
    principal: 100000,
    principalAsset: "USDC",
    yield: 8.4,
    duration: 25,
  },
  {
    id: "SOV-7B14",
    type: "YIELD VAULT SYNDICATE",
    status: "SETTLED",
    partyA: { name: "Treasury example B" },
    partyB: { name: "Strategy example B" },
    principal: 250000,
    principalAsset: "USDC",
    yield: 7.2,
    duration: 60,
  },
  {
    id: "SOV-6A02",
    type: "ARBITRAGE LIQUIDITY",
    status: "UNWOUND",
    partyA: { name: "Treasury example C" },
    partyB: { name: "Strategy example C" },
    principal: 150000,
    principalAsset: "USDC",
    yield: 9.1,
    duration: 90,
  },
];

export const NEGOTIATION_ROUNDS = [
  { round: 1, actor: "TREASURY EXAMPLE", action: "OFFER", timestamp: "Example T+00s", capital: 100000, duration: 30, yield: 8.0 },
  { round: 2, actor: "STRATEGY EXAMPLE", action: "COUNTER-OFFER", timestamp: "Example T+32s", capital: 100000, duration: 30, yield: 8.8 },
  { round: 3, actor: "TREASURY EXAMPLE", action: "COUNTER-OFFER", timestamp: "Example T+65s", capital: 100000, duration: 25, yield: 8.4 },
  { round: 4, actor: "STRATEGY EXAMPLE", action: "ACCEPTANCE", timestamp: "Example T+98s", capital: 100000, duration: 25, yield: 8.4 },
];

export const ACTIVITY_EVENTS = [
  { id: 1, time: "Example T+180s", event: "Demo unwind scenario", agreement: "#SOV-6A02", chain: "ARC (EXAMPLE)", status: "UNWOUND", reference: "DEMO-EVENT-01" },
  { id: 2, time: "Example T+150s", event: "Demo escrow scenario", agreement: "#SOV-8F29", chain: "ARC (EXAMPLE)", status: "ACTIVE", reference: "DEMO-EVENT-02" },
  { id: 3, time: "Example T+120s", event: "Demo agreement scenario", agreement: "#SOV-8F29", chain: "SEPOLIA (EXAMPLE)", status: "ACTIVE", reference: "DEMO-EVENT-03" },
  { id: 4, time: "Example T+98s", event: "Demo terms convergence", agreement: "#SOV-8F29", chain: "OFFCHAIN EXAMPLE", status: "PENDING", reference: "DEMO-EVENT-04" },
  { id: 5, time: "Example T+00s", event: "Demo public intent preview", agreement: "#SOV-8F29", chain: "OFFCHAIN EXAMPLE", status: "PENDING", reference: "DEMO-EVENT-05" },
  { id: 6, time: "Earlier example", event: "Demo maturity scenario", agreement: "#SOV-7B14", chain: "ARC (EXAMPLE)", status: "SETTLED", reference: "DEMO-EVENT-06" },
];

export const AGENTS = [
  {
    id: "TA",
    name: "Treasury Agent Example",
    ens: "Treasury example A (not ENS)",
    address: "DEMO-ACTOR-A (not a wallet)",
    role: "Illustrative capital allocator",
    delegationContract: "Not connected",
    activeAgreement: "#SOV-8F29 ($100,000 synthetic USDC)",
    hardwareKey: "Not configured or attested",
    sigScheme: "No signatures requested or verified",
    status: "DEMO / SYNTHETIC",
    executionCapacity: "$1,000,000 synthetic USDC",
  },
  {
    id: "SA",
    name: "Strategy Agent Example",
    ens: "Strategy example A (not ENS)",
    address: "DEMO-ACTOR-B (not a wallet)",
    role: "Illustrative counterparty",
    delegationContract: "Not connected",
    activeAgreement: "#SOV-8F29 ($100,000 synthetic USDC)",
    hardwareKey: "Not configured or attested",
    sigScheme: "No signatures requested or verified",
    status: "DEMO / SYNTHETIC",
    executionCapacity: "$2,400,000 synthetic USDC",
  },
];

export const AUDIT_LOG = [
  { time: "Example T+150s", action: "Demo escrow scenario ($100,000 synthetic USDC)", network: "ARC EXAMPLE" },
  { time: "Example T+120s", action: "Demo agreement scenario (#SOV-8F29)", network: "SEPOLIA EXAMPLE" },
];

