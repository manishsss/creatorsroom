# Creators Room Pay

A USDC-escrow platform for brand-creator campaigns, live on **Arc Mainnet**.

Built with [Arc Studio](https://studio.arc.io)

## What it does

Brands lock a USDC budget in an onchain escrow contract. Each creator receives their payment once the brand approves the completed work. Two payment modes are supported:

- **Immediate pay** — Brand calls "Approve and pay" in one transaction. USDC is pushed directly to each creator's wallet at approval time. No separate claim step.
- **Scheduled unlock** — Brand calls "Approve campaign". Creators claim their own payment after a specified unlock timestamp.

## Campaign lifecycle

1. **Create** — Brand sets title, deadlines, and up to 20 creator wallets with fixed USDC allocations.
2. **Fund** — Brand approves the USDC allowance then funds the contract. Budget is frozen in escrow.
3. **Submit** — Creators attach a public deliverable URL while the campaign is active.
4. **Approve** — Brand approves before the approval deadline.
   - Immediate-pay campaigns: USDC is pushed to all creators in the same transaction.
   - Scheduled-unlock campaigns: creators claim individually after the unlock time.
5. **Refund (fallback)** — If the brand never approves before the deadline, they reclaim the full escrowed budget.

## Rules

- Recipients, amounts, and deadlines are **frozen once funded**.
- Creator addresses can only be updated via `replaceCreator` while status is Pending.
- No partial funding — full budget is escrowed in one transaction.
- No duplicate claims or payments.
- Approved campaigns cannot be refunded.

## Deployed contracts

| Network | Chain ID | Address |
|---|---|---|
| Arc Mainnet | 5042 | `0x46C58f235e0B90F3f91BF7118d01BD60d81E237A` |
| Arc Testnet (v4) | 5042002 | `0xa7de927c7168dd320f0657803beebb687c7e8098` |

USDC address (both networks): `0x3600000000000000000000000000000000000000`

## Contract functions

| Function | Who | When |
|---|---|---|
| `createCampaign(...)` | Brand | Any time |
| `replaceCreator(id, index, newWallet)` | Brand | Pending only |
| `fundCampaign(id)` | Brand | Pending, before fund deadline |
| `submitDeliverable(id, index, link)` | Creator | Active |
| `approveAndPayAll(id)` | Brand | Active, before approval deadline, claimUnlockTime == 0 |
| `approveCampaign(id)` | Brand | Active, before approval deadline |
| `claimPayment(id, index)` | Creator | Approved, after claimUnlockTime, not already claimed |
| `refundBrand(id)` | Brand | Active, after approval deadline |

## Development

```bash
bun install        # install dependencies
bun run dev        # start dev server (http://localhost:5173)
forge build        # compile contracts
forge test         # run 85 contract unit tests
bun run check      # lint + typecheck
bunx vite build    # production build
```

## Environment variables

| Variable | Purpose |
|---|---|
| `VITE_NETWORK` | Set to `mainnet` for Arc Mainnet, anything else uses Arc Testnet |
| `VITE_MAINNET_CONTRACT_ADDRESS` | Mainnet contract address (set after deploy) |

See `env.example` for a template. `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, and `RPC_PROXY_CHAINS` are injected automatically inside Arc Studio and are optional outside it.

## Tech stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS
- **Web3:** wagmi v2, viem v2, ConnectKit
- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin
- **Chain:** Arc (USDC as native gas, sub-second finality)
- **Token:** USDC ERC-20 — 6 decimals, `0x3600000000000000000000000000000000000000`

## GitHub export and Vercel

The production build uses `bun install --frozen-lockfile`, `bun run build`,
and the `dist` output directory, as configured in `vercel.json`. Set both
public variables from `env.example` in Vercel before building the mainnet app.
The actual `.env`, session logs, archives, and build output are excluded.

The temporary wallet deployment page has been removed. Publishing the frontend
does not redeploy the existing mainnet contract.

The Foundry test library is vendored under `lib/forge-std`; this export does
not depend on Git submodule metadata to restore it. Contract dependencies
from OpenZeppelin are installed with Bun.

Run `bun run check` for type checking, non-mutating lint, exact amount tests
and the production build. Run `forge test` separately with Foundry installed.
Large USDC amounts are formatted without conversion to JavaScript Number.
