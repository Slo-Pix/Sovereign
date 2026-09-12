// Public agreement data for the dashboard. Never add private policy values, evaluation history, risk scores or proofs.
// Never add private policy values, evaluation history, risk scores or proofs.

export const AGREEMENTS = [
  {
    id: "SOV-8F29",
    type: "COLLATERALIZED LOAN",
    status: "ACTIVE",
    partyA: { name: "Treasury A" },
    partyB: { name: "Strategy A" },
    principal: 100000,
    principalAsset: "USDC",
    yield: 8.4,
    duration: 25,
  },
  {
    id: "SOV-7B14",
    type: "YIELD VAULT SYNDICATE",
    status: "SETTLED",
    partyA: { name: "Treasury B" },
    partyB: { name: "Strategy B" },
    principal: 250000,
    principalAsset: "USDC",
    yield: 7.2,
    duration: 60,
  },
  {
    id: "SOV-6A02",
    type: "ARBITRAGE LIQUIDITY",
    status: "UNWOUND",
    partyA: { name: "Treasury C" },
    partyB: { name: "Strategy C" },
    principal: 150000,
    principalAsset: "USDC",
    yield: 9.1,
    duration: 90,
  },
];

export const NEGOTIATION_ROUNDS = [
  { round: 1, actor: "TREASURY", action: "OFFER", timestamp: "T+00s", capital: 100000, duration: 30, yield: 8.0 },
  { round: 2, actor: "STRATEGY", action: "COUNTER-OFFER", timestamp: "T+32s", capital: 100000, duration: 30, yield: 8.8 },
  { round: 3, actor: "TREASURY", action: "COUNTER-OFFER", timestamp: "T+65s", capital: 100000, duration: 25, yield: 8.4 },
  { round: 4, actor: "STRATEGY", action: "ACCEPTANCE", timestamp: "T+98s", capital: 100000, duration: 25, yield: 8.4 },
];

export const ACTIVITY_EVENTS = [
  { id: 1, time: "T+180s", event: "Escrow unwound", agreement: "#SOV-6A02", chain: "ARC", status: "UNWOUND", reference: "EVENT-01" },
  { id: 2, time: "T+150s", event: "Escrow locked", agreement: "#SOV-8F29", chain: "ARC", status: "ACTIVE", reference: "EVENT-02" },
  { id: 3, time: "T+120s", event: "Agreement activated", agreement: "#SOV-8F29", chain: "SEPOLIA", status: "ACTIVE", reference: "EVENT-03" },
  { id: 4, time: "T+98s", event: "Terms converged", agreement: "#SOV-8F29", chain: "OFFCHAIN", status: "PENDING", reference: "EVENT-04" },
  { id: 5, time: "T+00s", event: "Intent published", agreement: "#SOV-8F29", chain: "OFFCHAIN", status: "PENDING", reference: "EVENT-05" },
  { id: 6, time: "Earlier", event: "Agreement settled", agreement: "#SOV-7B14", chain: "ARC", status: "SETTLED", reference: "EVENT-06" },
];

export const AGENTS = [
  {
    id: "TA",
    name: "Treasury Agent",
    ens: "Treasury A (not ENS)",
    address: "TREASURY-A",
    role: "Capital allocator",
    delegationContract: "Not connected",
    activeAgreement: "#SOV-8F29 ($100,000 USDC)",
    hardwareKey: "Not configured or attested",
    sigScheme: "No signatures requested or verified",
    status: "ACTIVE",
    executionCapacity: "$1,000,000 USDC",
  },
  {
    id: "SA",
    name: "Strategy Agent",
    ens: "Strategy A (not ENS)",
    address: "STRATEGY-A",
    role: "Counterparty",
    delegationContract: "Not connected",
    activeAgreement: "#SOV-8F29 ($100,000 USDC)",
    hardwareKey: "Not configured or attested",
    sigScheme: "No signatures requested or verified",
    status: "ACTIVE",
    executionCapacity: "$2,400,000 USDC",
  },
];

export const AUDIT_LOG = [
  { time: "T+150s", action: "Escrow locked ($100,000 USDC)", network: "ARC" },
  { time: "T+120s", action: "Agreement activated (#SOV-8F29)", network: "SEPOLIA" },
];

