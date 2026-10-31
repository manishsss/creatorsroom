# End-to-End Arc Testnet Verification Guide

**Contract (v3):** `0xf4be6dea250a917f95966489732eed0efa74be1a`  
**Explorer:** https://explorer.testnet.arc.io/address/0xf4be6dea250a917f95966489732eed0efa74be1a  
**Chain ID:** 5042002  
**RPC:** https://rpc.testnet.arc.io  
**USDC:** `0x3600000000000000000000000000000000000000` (6 decimals)

---

## Baseline checks (verified before running campaigns)

| Check | Result | Evidence |
|---|---|---|
| RPC responds | **Passed** | `eth_chainId` → `0x4cef52` = 5042002; `eth_blockNumber` → block 68,157,358 |
| Chain ID is 5042002 | **Passed** | `eth_chainId` confirmed decimal 5042002 |
| App config chain ID | **Passed** | `src/config.ts` and `src/contracts/config.ts` both set to `5042002` |
| App RPC URL | **Passed** | Explicit `http('https://rpc.testnet.arc.io')` transport; no fallback to wallet RPC |
| Contract v3 bytecode | **Passed** | `eth_getCode` → 15,342 bytes at `0xf4be6dea250a917f95966489732eed0efa74be1a` |
| USDC bytecode | **Passed** | `eth_getCode` → 3,596 bytes at `0x3600...0000` |
| USDC symbol | **Passed** | `symbol()` → `"USDC"` |
| USDC decimals | **Passed** | `decimals()` → `6` |
| Contract `usdc()` | **Passed** | `usdc()` → `0x3600000000000000000000000000000000000000` |
| Contract `campaignCount()` | **Passed** | `campaignCount()` → `0` (fresh deploy, no campaigns yet) |
| Deploy tx receipt | **Passed** | tx `0x8d67e...0217110` → status 1, block 68,119,825 |
| No demo/mock data | **Passed** | grep of `src/` found zero occurrences of "demo" or "mock" |

---

## Wallets you need

You need three wallets (MetaMask accounts work — use "Add account" to create extras):

| Role | Label below | What it does |
|---|---|---|
| Brand wallet | **Wallet A** | Creates campaigns, funds them, approves payouts |
| Creator wallet 1 | **Wallet B** | Receives 0.60 USDC |
| Creator wallet 2 | **Wallet C** | Receives 0.40 USDC |

**Getting test USDC:** In the Arc Studio sidebar, click **Get test USDC**. Connect Wallet A — it drips Arc Testnet USDC. Repeat for Wallet B and Wallet C if you want them to have gas (on Arc, USDC is the gas token — the same faucet covers gas).

You will need at least **2 USDC in Wallet A** for Campaign 1 (1 USDC budget + gas overhead for ~4 transactions). A small amount in Wallet B and C covers their claim transactions.

---

## Campaign 1 — Main flow (fund, approve, claim, duplicate-claim block)

### Step 1 — Connect Wallet A (Brand)

1. Open the app preview.
2. Click **Connect Wallet**. Select MetaMask → choose **Wallet A**.
3. MetaMask will ask to add/switch to Arc Testnet (chain ID 5042002, RPC `https://rpc.testnet.arc.io`). **Approve the network switch.** Accept any "add network" prompt.
4. Confirm the header shows "Arc Testnet" and the testnet badge is visible.

**Expected:** Connected, correct chain shown.

---

### Step 2 — Create Campaign 1

1. Click **Create Campaign** (or the + button).
2. Fill in the form:
   - **Title:** `E2E Test Campaign`
   - **Description:** `End-to-end verification campaign`
   - **Fund by:** any date at least 30 minutes from now
   - **Approve by:** any date at least 1 hour from now (must be after Fund by)
   - **Scheduled Unlock:** leave **blank** (no lock — creators can claim immediately after approval)
3. Add **two creators:**
   - Creator 1: address of **Wallet B**, amount `0.60`
   - Creator 2: address of **Wallet C**, amount `0.40`
4. Total shown: `1.00 USDC`. Click **Continue**.
5. Review step: confirm wallets, amounts, total. Click **Create Campaign**.
6. MetaMask pops up — confirm the transaction (no USDC leaves yet; this just registers the campaign).

**Record:** Note the `campaignId` shown after creation (it will be `1` if this is the first campaign on the contract).

Verify on-chain:
```
cast call 0xf4be6dea250a917f95966489732eed0efa74be1a "campaignCount()(uint256)" --rpc-url https://rpc.testnet.arc.io
# Expected: 1
```
Explorer link: https://explorer.testnet.arc.io/address/0xf4be6dea250a917f95966489732eed0efa74be1a

---

### Step 3 — Fund Campaign 1 (Wallet A stays connected)

1. Open Campaign 1 from the dashboard.
2. Under **Brand Actions**, click **Fund Campaign**.
3. MetaMask shows **two** consecutive prompts:
   - **First:** ERC-20 `approve` — grants the contract permission to pull 1,000,000 units (1.00 USDC, 6 decimals). Confirm it.
   - **Second (after the approval confirms):** `fundCampaign(1)` — transfers 1.00 USDC into escrow. Confirm it.
4. Status badge should change from "Awaiting Funding" → "Funded".

**Record** the fund transaction hash from the UI tx-history row or MetaMask activity. Check it at:
`https://explorer.testnet.arc.io/tx/<FUND_TX_HASH>`

Expected events in that transaction:
- `Transfer` from Wallet A to contract (1,000,000 units = 1.00 USDC)
- `CampaignFunded(campaignId=1, totalBudget=1000000)`

Verify contract USDC balance:
```
cast call 0x3600000000000000000000000000000000000000 \
  "balanceOf(address)(uint256)" \
  0xf4be6dea250a917f95966489732eed0efa74be1a \
  --rpc-url https://rpc.testnet.arc.io
# Expected: 1000000 (= 1.00 USDC)
```

---

### Step 4 — Submit deliverables (switch to Wallet B, then Wallet C)

**Switch MetaMask to Wallet B.**

1. In the app, open Campaign 1. The UI now shows Wallet B as "Your wallet" in the creator list.
2. In Creator 1's row, enter a deliverable URL (e.g. `https://example.com/deliverable-b`).
3. Click **Submit**. Confirm the transaction in MetaMask.
4. The link appears on-chain; the row updates.

**Switch MetaMask to Wallet C.**

5. In Creator 2's row, enter `https://example.com/deliverable-c`. Submit and confirm.

These are metadata-only. Status remains "Funded" — deliverable submission does NOT trigger payment.

---

### Step 5 — Brand approves (switch back to Wallet A)

**Switch MetaMask to Wallet A.**

1. Open Campaign 1.
2. Under **Brand Actions**, click **Approve Payouts**.
3. MetaMask prompt: confirm `approveCampaign(1)`.
4. Status badge changes to "Approved".

**Record** the approve tx hash. Verify on explorer — expect `CampaignApproved(campaignId=1)` event.

Check campaign status on-chain:
```
cast call 0xf4be6dea250a917f95966489732eed0efa74be1a \
  "getCampaignStatus(uint256)(uint8)" 1 \
  --rpc-url https://rpc.testnet.arc.io
# Expected: 2 (= Status.Approved)
```

---

### Step 6 — Creator B claims (switch to Wallet B)

**Switch MetaMask to Wallet B.**

1. Open Campaign 1. Creator 1's row shows **"Claim 0.60 USDC"** button (no lock badge, since no scheduled unlock was set).
2. Click it. MetaMask: confirm `claimPayment(1, 0)`.
3. Row updates to **Claimed** badge.

**Record** claim tx hash. Verify:
- `PaymentClaimed(campaignId=1, creatorIndex=0, creator=<WalletB>, amount=600000)` event in the tx.
- Wallet B USDC balance increased by 0.60.

Wallet B balance check:
```
cast call 0x3600000000000000000000000000000000000000 \
  "balanceOf(address)(uint256)" <WALLET_B_ADDRESS> \
  --rpc-url https://rpc.testnet.arc.io
```

---

### Step 7 — Creator C claims (switch to Wallet C)

**Switch MetaMask to Wallet C.** Same flow — claim 0.40 USDC. Verify `PaymentClaimed` event with `amount=400000`.

After both claims, contract USDC balance for this campaign should be 0:
```
cast call 0x3600000000000000000000000000000000000000 \
  "balanceOf(address)(uint256)" \
  0xf4be6dea250a917f95966489732eed0efa74be1a \
  --rpc-url https://rpc.testnet.arc.io
# Expected: 0 (assuming no other campaigns)
```

---

### Step 8 — Duplicate claim blocked (still Wallet C)

1. With Wallet C still connected, open Campaign 1.
2. Creator 2's row shows **"Claimed"** badge. The claim button is gone.
3. If you attempt to call `claimPayment(1, 1)` directly (e.g. via a script), the contract reverts with `AlreadyClaimed(1, 1)`.

The UI prevents the button from appearing after `claimed = true` is read from chain. The contract enforces it independently.

---

## Campaign 2 — Expired refund path

### Setup

With **Wallet A**, create a second campaign:
- Title: `Refund Test Campaign`
- Fund by: 2 minutes from now (use the time picker — set it as close to the current time as allowed)
- Approve by: 4 minutes from now
- Creators: any two wallets, any amounts (e.g. Wallet B: 0.50, Wallet C: 0.50 — total 1.00 USDC)
- No scheduled unlock

Fund the campaign (two MetaMask prompts as before). Status → "Funded".

### Wait for approval deadline to pass

Wait until the approval deadline passes (4 minutes). The status badge in the UI will change from "Funded" to "Expired" once `block.timestamp > approvalDeadline`.

### Reclaim

1. With Wallet A connected, open Campaign 2.
2. Brand Actions section now shows **Reclaim Budget** (red button).
3. Click it. Confirm `refundBrand(2)` in MetaMask.
4. Status → "Refunded". Contract USDC balance decreases by 1.00.

Verify `BrandRefunded(campaignId=2, brand=<WalletA>, amount=1000000)` event on explorer.

### Test: Creator cannot claim after refund

With Wallet B connected, open Campaign 2. No claim button exists — campaign status is "Refunded" (not "Approved"), so the claim condition is never met.

### Test: Brand cannot double-refund

With Wallet A, attempt Reclaim again — the button is gone. If called directly, contract reverts `InvalidCampaignStatus(expected=1, actual=3)`.

---

## Campaign 3 — Scheduled unlock restriction

### Setup

With **Wallet A**, create a third campaign:
- Title: `Unlock Test Campaign`
- Fund by: 10 minutes from now
- Approve by: 20 minutes from now
- **Scheduled Unlock:** 60 minutes from now (this is the key field)
- Creators: Wallet B: 0.50, Wallet C: 0.50

Fund and approve the campaign. Status → "Approved".

### Verify lock is enforced

1. Switch to Wallet B. Open Campaign 3.
2. Creator 1's row shows **"Payout locked until [local time] (UTC)"** banner instead of a claim button.
3. The unlock date and the "Locked" pill are visible in the campaign header.

**The contract enforces this.** If `claimPayment(3, 0)` is called directly before the unlock time, the contract reverts `ClaimNotYetUnlocked(unlockTime, currentTime)`.

To test the revert directly:
```bash
cast call 0xf4be6dea250a917f95966489732eed0efa74be1a \
  "claimPayment(uint256,uint256)" 3 0 \
  --from <WALLET_B_ADDRESS> \
  --rpc-url https://rpc.testnet.arc.io
# Expected: revert ClaimNotYetUnlocked(...)
```

### Verify claim succeeds after unlock

Wait until the scheduled unlock time passes. Refresh the app. The banner disappears and the **Claim** button appears. Claim normally — confirm the `PaymentClaimed` event.

> **Note:** Funds do not move automatically when the timer reaches zero. Each creator must send a claim transaction.

---

## Check summary table

Fill in your transaction hashes as you run each step.

| # | Check | Status | TX / Evidence |
|---|---|---|---|
| B-1 | RPC responds at `rpc.testnet.arc.io` | Passed | `eth_chainId` = 5042002 |
| B-2 | Chain ID = 5042002 | Passed | Confirmed via `cast` |
| B-3 | Contract v3 has bytecode | Passed | 15,342 bytes |
| B-4 | USDC at `0x3600...0000` responds | Passed | symbol=USDC, decimals=6 |
| B-5 | `usdc()` in contract = `0x3600...0000` | Passed | `cast call` confirmed |
| B-6 | Deploy tx confirmed | Passed | block 68,119,825, status=1 |
| B-7 | No demo/mock data in app | Passed | grep found 0 matches |
| C1-1 | Campaign created on-chain | Not tested | — |
| C1-2 | `campaignCount` incremented | Not tested | — |
| C1-3 | USDC approve confirmed | Not tested | — |
| C1-4 | Fund tx confirmed | Not tested | — |
| C1-5 | Contract holds 1,000,000 USDC units | Not tested | — |
| C1-6 | Deliverable B stored on-chain | Not tested | — |
| C1-7 | Deliverable C stored on-chain | Not tested | — |
| C1-8 | Approve tx confirmed | Not tested | — |
| C1-9 | Status = Approved | Not tested | — |
| C1-10 | Creator B claimed 600,000 units | Not tested | — |
| C1-11 | Creator C claimed 400,000 units | Not tested | — |
| C1-12 | Contract balance = 0 after both claims | Not tested | — |
| C1-13 | Duplicate claim blocked (UI + contract) | Not tested | — |
| C2-1 | Expired refund: brand reclaims | Not tested | — |
| C2-2 | Creator cannot claim after refund | Not tested | — |
| C2-3 | Double-refund blocked | Not tested | — |
| C3-1 | Scheduled lock banner shown before unlock | Not tested | — |
| C3-2 | Contract reverts claim before unlock | Not tested | — |
| C3-3 | Claim succeeds after unlock | Not tested | — |

---

## Amount accounting note

On Arc Testnet, USDC is both the ERC-20 token (6 decimals) and the native gas token (18 decimals). Gas is paid from the same USDC balance but at 18-decimal precision. When you check balances:

- ERC-20 `balanceOf` always returns 6-decimal units (e.g. 1,000,000 = 1.00 USDC).
- MetaMask's ETH-balance display shows the same funds in 18-decimal native units — this is the **same money**, not a separate balance. Do not add them.
- After a claim of 0.60 USDC, Wallet B's `balanceOf` increases by exactly 600,000. The wallet's displayed "ETH" balance also increases by the same amount but in 18-decimal representation.
- Gas costs are tiny (a few cents equivalent) and come out of the same pool. Expect the actual balance change to be 599,999 or 400,000 minus a small gas amount rather than exactly 600,000 / 400,000, depending on which direction you measure.

---

## If something fails

| Symptom | Likely cause | Fix |
|---|---|---|
| "Failed to fetch" on fund | MetaMask using old RPC | On the pending step, let MetaMask add/update the Arc Testnet network from the app's switch prompt. The app now passes `rpc.testnet.arc.io` explicitly via `addEthereumChain`. |
| "User rejected" | You dismissed a MetaMask prompt | Retry the action in the UI. |
| Fund step 2 never fires | Approve tx not confirmed yet | Wait for the first tx (approve) to confirm; wagmi triggers fund automatically on approval success. |
| Status still shows "Pending" | UI cache lag | Click the refresh (↻) button on the campaign card. Wagmi re-reads from chain on demand. |
| Claim button shows "Locked" | Scheduled unlock not reached | Wait for the unlock time. Refresh the page to re-evaluate `NOW`. |
| Creator claim reverts on-chain | Wrong wallet connected | Ensure MetaMask is on the exact Wallet B or C address that was registered as creator index 0 or 1. |
