# Sovereign frontend

Use **Node 22** for production builds. Bun can run agent tests but Bun 1.3.13's Next.js production runtime failed during page-data collection; the Node build is verified separately.

## Implemented integration

- Agent EIP-712 signing imports core's canonical seven-field type and digest. `proposer` is the counterparty address; `proposerRole` is unsigned negotiation metadata. Both agents require `{intentId,principal,counterparty}` binding and second-based durations. Final terms retain expiry and offer nonce, separate from decision nonce.
- The wallet button uses Privy's wallet connection modal only on explicit click. The participant workspace uses the connected wallet for explicit, user-approved Sepolia and Arc transactions and EIP-712 signatures; it never receives a private key.
- `/create-intent` is the participant transaction workspace: it hashes a private policy in memory, creates an intent, opens and binds an agreement, captures the counterparty's canonical signature, finalizes terms (emitting `ValidationRequested`), and submits an exact-value Arc USDC allowance.
- `/monitoring` accepts an actual bytes32 agreement ID and reads `/api/agreements/:id/status`. The server reads finalized Sepolia/Arc blocks and returns only public state/block numbers. Errors do not fall back to mock data. No private position endpoint or token is exposed to the browser.
- Opening an agreement by its bytes32 identifier reads live contract state on both chains. Other dashboard pages render public terms and status. The workspace never sends the private policy or salt onchain: only its commitment is included in `createIntent`; the optional CRE-secret export is a user-controlled clipboard handoff. No page displays private position readings or SAFE history, and none claims ZK proofs or TEE execution.

## Server configuration and checks

### Privy wallet setup

Create a Privy application, enable wallet login/connection in the Privy dashboard, and set the public application ID before starting Next.js:

```bash
cp .env.example .env.local
# edit .env.local and set NEXT_PUBLIC_PRIVY_APP_ID
npm run dev
```

`NEXT_PUBLIC_*` values are inlined into the bundle at build time, so a production server does not pick up a change on restart alone:

```bash
NEXT_PUBLIC_PRIVY_APP_ID=your-app-id npm run build
npm run start
```

A value exported only in the shell before `npm run start` has no effect; it must be present during `npm run build`, or in `.env.local` when running `npm run dev`.

The frontend intentionally keeps embedded-wallet creation disabled. Privy is used for wallet connection, signing, and explicit transaction approval; no private key is handled by the application. If the application ID is missing, the UI shows a configuration state and does not fall back to direct `window.ethereum` or MetaMask calls.

Optional server-only `SEPOLIA_RPC_URL` and `ARC_RPC_URL` override public read RPCs. Never prefix credentials with `NEXT_PUBLIC_`; never configure the private position read token in the frontend. Contract addresses come from [canonical deployments](../deployments/canonical.json). Public status is read-only and unauthenticated because it returns public chain data, but production needs edge IP/global rate limits, request timeouts and budget controls to protect RPC access. No durable public-endpoint limiter is claimed here.

The Agreements and Overview pages discover records from finalized `AgreementOpened`
events on the deployed Sepolia registry, then verify each ID against the Sepolia
registry and Arc escrow at their finalized blocks. The indexer defaults to the
latest 5,000 finalized blocks and uses 10-block log
chunks for compatibility with free RPC plans. For a wider reconciliation window,
set these server-only variables in `.env.local`:

```bash
AGREEMENT_INDEX_START_BLOCK=11690500
AGREEMENT_INDEX_CHUNK_BLOCKS=10
AGREEMENT_INDEX_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

`AGREEMENT_INDEX_START_BLOCK` takes precedence over the lookback window. The UI
reports the indexed block window and never substitutes fixture agreements when
the provider or index is unavailable. Log discovery can use a separate public
RPC so rate limits on the state-read provider do not prevent indexing; every
agreement is still verified through the configured Sepolia and Arc state-read
providers before it is rendered.

From this directory: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run lint`, `npm test`, then `npm run build`. `npm test` includes API and agent tests; agent tests can also run from their own workspace. Build output must not be committed. Remote package/Node availability and dependency audits remain operator responsibilities.

The [private position provider](../packages/position-feed/README.md), [CRE workflow](../packages/cre/README.md) and [trusted relayer](../packages/relayer/README.md) are separate services. CRE evaluation is scheduler-driven after `ValidationRequested`; the relayer alone can lock, settle, or unwind escrow. The public UI exposes their finalized public state and handoff status but never operates their private credentials or privileged writes. Local lifecycle tests and provider tests are reproducible from those packages; public deployment remains gated on actual identity/wallet configuration and authorization.

The Next.js starter's general editor/deployment instructions follow.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
