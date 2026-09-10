# Sovereign frontend

Use **Node 22** for production builds. Bun can run agent tests but Bun 1.3.13's Next.js production runtime failed during page-data collection; the Node build is verified separately.

## Implemented integration

- Agent EIP-712 signing imports core's canonical seven-field type and digest. `proposer` is the counterparty address; `proposerRole` is unsigned negotiation metadata. Both agents require `{intentId,principal,counterparty}` binding and second-based durations. Final terms retain expiry and offer nonce, separate from decision nonce.
- The wallet button calls the injected wallet's account-request API only on explicit click. It is not a transaction, signature verification or protocol authorization.
- `/monitoring` accepts an actual bytes32 agreement ID and reads `/api/agreements/:id/status`. The server reads finalized Sepolia/Arc blocks and returns only public state/block numbers. Errors do not fall back to mock data. No private position endpoint or token is exposed to the browser.
- Other dashboard pages are explicitly labeled synthetic examples. Their fixture status/address/metrics are not evidence of live transactions, verification, ZK proofs or TEE execution. Private policy inputs and SAFE history are not collected/displayed.

## Server configuration and checks

Optional server-only `SEPOLIA_RPC_URL` and `ARC_RPC_URL` override public read RPCs. Never prefix credentials with `NEXT_PUBLIC_`; never configure the private position read token in the frontend. Contract addresses come from [canonical deployments](../deployments/canonical.json). Public status is read-only and unauthenticated because it returns public chain data, but production needs edge IP/global rate limits, request timeouts and budget controls to protect RPC access. No durable public-endpoint limiter is claimed here.

From this directory: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run lint`, `npm test`, then `npm run build`. `npm test` includes API and agent tests; agent tests can also run from their own workspace. Build output must not be committed. Remote package/Node availability and dependency audits remain operator responsibilities.

The [private position provider](../packages/position-feed/README.md), [CRE workflow](../packages/cre/README.md) and [trusted relayer](../packages/relayer/README.md) are separate services. The public UI does not operate their private credentials or silently submit transactions. Local lifecycle tests and provider tests are reproducible from those packages; public deployment remains gated on actual identity/wallet configuration and authorization.

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
