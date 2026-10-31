# Creators Room Pay

> Built with Arc Studio — money-powered apps in minutes

Brand-to-creator USDC campaign escrow on Arc Testnet. Brands fund campaigns in USDC; creators get paid on approval; optional Scheduled Unlock gates claims to a future timestamp.

---

## Deployed Contracts

| Version | Chain | Address | Explorer |
|---|---|---|---|
| **v4 — MAINNET LIVE** (approveAndPayAll) | Arc Mainnet | `0x46C58f235e0B90F3f91BF7118d01BD60d81E237A` | [View](https://explorer.arc.io/address/0x46C58f235e0B90F3f91BF7118d01BD60d81E237A) |
| v4 — current testnet (approveAndPayAll) | Arc Testnet | `0xa7de927c7168dd320f0657803beebb687c7e8098` | [View](https://explorer.testnet.arc.io/address/0xa7de927c7168dd320f0657803beebb687c7e8098) |
| v3 (post-audit: fee-on-transfer guard + strict approval deadline) | Arc Testnet | `0xf4be6dea250a917f95966489732eed0efa74be1a` | [View](https://explorer.testnet.arc.io/address/0xf4be6dea250a917f95966489732eed0efa74be1a) |
| v2 (adds Scheduled Unlock / claimUnlockTime) | Arc Testnet | `0x3fdabd335cef458d6977b5f0f694f207e960d448` | [View](https://explorer.testnet.arc.io/address/0x3fdabd335cef458d6977b5f0f694f207e960d448) |
| v1 (initial) | Arc Testnet | `0x452dfc6a03392f5cc3ab472af7cc6025c3e8e380` | [View](https://explorer.testnet.arc.io/address/0x452dfc6a03392f5cc3ab472af7cc6025c3e8e380) |

Constructor arg (all versions): `_usdc = 0x3600000000000000000000000000000000000000` (Arc Testnet / Arc Mainnet USDC)

Deploy tx (v3): `0x8d67e1b19cd91ad8273e0bdb68130042ffe33b10c7ebc5ed8422b0dc10217110`

---

## What Changed Between Versions

### v1 → v2 (Scheduled Unlock)
- `Campaign.claimUnlockTime` (uint64): 0 = immediate; non-zero = earliest claimable timestamp.
- `createCampaign` gains 5th param `claimUnlockTime` (before `creatorWallets`).
- `claimPayment` reverts `ClaimNotYetUnlocked` until `block.timestamp >= claimUnlockTime`.
- `CampaignCreated` event gains `claimUnlockTime` as 4th non-indexed field.

### v2 → v3 (Audit fixes)
- **F-1 (High):** `fundCampaign` now verifies balance-before/after; reverts if received < declared budget. Guards against fee-on-transfer / deflationary tokens.
- **F-2 (Medium):** `approveCampaign` now uses `>= approvalDeadline` (strict-before). Approval at exactly the deadline is disallowed.

---

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS (Arc Light mode)
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28, Foundry (forge build / forge test)
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: USDC ERC-20 (6 decimals) at `0x3600000000000000000000000000000000000000`
- Toasts: Sonner
- Tests: 75 tests, 0 failed

## Contract State Machine

```
Pending → Active (fundCampaign, brand only, before fundDeadline)
Active  → Approved (approveCampaign, brand only, before approvalDeadline)
Active  → Refunded (refundBrand, brand only, strictly after approvalDeadline)
```

Approved campaigns: each creator can claim their allocation once, via claimPayment.
If claimUnlockTime > 0: claimPayment reverts until block.timestamp >= claimUnlockTime.

## Key Files

- `src/App.tsx` — view routing (list / create / campaign)
- `src/contracts/config.ts` — contract address + full ABI (v3)
- `src/components/CreateCampaign.tsx` — 3-step wizard with optional Scheduled Unlock
- `src/components/CampaignDashboard.tsx` — per-campaign view with role-aware actions
- `src/components/CampaignList.tsx` — My Campaigns / Creator In tabs
- `src/utils/format.ts` — USDC formatting, status labels, timestamps with UTC
- `src/hooks/useCampaignData.ts` — chain reads for campaign + creator state
- `contracts/CreatorsRoomPay.sol` — escrow contract (v3)
- `contracts/test/CreatorsRoomPay.t.sol` — 75 Foundry tests
- `docs/security-review.md` — structured audit findings
- `docs/mainnet-deploy.md` — mainnet deployment instructions
- `docs/submission-checklist.md` — hackathon submission checklist

## To Run

```bash
bun install
bun run dev
# Contracts:
forge build
forge test
```
