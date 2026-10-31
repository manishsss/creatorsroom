# Security Review — CreatorsRoomPay

**Contract:** `CreatorsRoomPay.sol`  
**Reviewed version:** v3 (post-fix, deployed `0xf4be6dea250a917f95966489732eed0efa74be1a`)  
**Review date:** 2026-10-20  
**Severity tiers:** High / Medium / Low / Info  
**Test suite:** 75 tests, 0 failed  

> **Disclaimer.** This review is a structured analysis of the source code using automated rule corpora and manual inspection. It does NOT constitute a professional smart-contract audit by a registered security firm. No tool-generated review should be described as "audited." Independent professional review is required before any mainnet deployment.

---

## Findings

| # | Severity | Title | Location | Status |
|---|---|---|---|---|
| F-1 | High | Fee-on-transfer token creates cross-campaign solvency gap | `fundCampaign` (line ~210) | **Fixed in v3** |
| F-2 | Medium | Approval at exactly `approvalDeadline` allowed simultaneous approve + refund | `approveCampaign` (line ~261) | **Fixed in v3** |

### F-1 — Fee-on-transfer (HIGH) — Fixed

**Description.** `fundCampaign` set `campaign.status = Active` based on the declared `totalBudget`, then called `transferFrom` for the same amount. If the configured ERC-20 token charged a fee and delivered fewer tokens than requested, the contract would record a fully-funded campaign backed by less USDC than the sum of creator allocations. Over multiple campaigns, one campaign's claims could consume liquidity belonging to another.

**Fix applied.** A balance-before/balance-after check now verifies `received == totalBudget` before the campaign is committed as Active. Any shortfall causes an immediate revert. Because Circle USDC is non-deflationary, this check is always a no-op in production but eliminates the risk for any misconfigured token.

**Test coverage.** `TestFund::test_fund_revert_feeOnTransferToken` deploys a `FeeOnTransferUSDC` mock and confirms the fund call reverts.

---

### F-2 — Approval deadline boundary (MEDIUM) — Fixed

**Description.** `approveCampaign` used `> approvalDeadline` (not `>=`), so approval at exactly `block.timestamp == approvalDeadline` succeeded. At the same timestamp, `refundBrand` becomes callable (its check is `<= approvalDeadline`). A brand could approve at the boundary second and a third party observing the mempool could race to call `refundBrand` in the same block, creating an ambiguous state (though both cannot execute: status changes atomically).

More importantly, the product rule is "approve BEFORE the deadline" — not "at the deadline" — so the inclusive check violated the specification.

**Fix applied.** Changed to `>= approvalDeadline` (strict-before). Approval one second before the deadline still succeeds; at or after reverts.

**Test coverage.**
- `TestApprove::test_approve_revert_atDeadline` — approval at exactly the deadline reverts.
- `TestApprove::test_approve_success_oneSecondBeforeDeadline` — approval at `deadline - 1` succeeds.
- `TestRefund::test_refund_revert_atDeadline` — refund at exactly the deadline reverts (existing behaviour, confirmed).

---

## Invariant Assessment

| # | Invariant | Verdict | Notes |
|---|---|---|---|
| 1 | Only the campaign brand can approve or claim an expired refund | **HOLDS** | `OnlyBrand` check on both paths. Tests: `test_approve_invariant_onlyBrand`, `test_refund_invariant_onlyBrand`. |
| 2 | Nobody can redirect a creator's allocation | **HOLDS** | `claimPayment` checks `msg.sender == creator.wallet`. `replaceCreator` is restricted to Pending status + brand only. Tests: `test_claim_invariant_noRedirect`, `test_claim_revert_wrongIndex`. |
| 3 | Funding, approval, refunds and claims cannot execute twice | **HOLDS** | Status machine (Pending→Active→Approved/Refunded) prevents any duplicate state transition. `creator.claimed` bool prevents double-claim. Tests: `test_fund_revert_alreadyFunded`, `test_approve_revert_doubleApprove`, `test_refund_revert_doubleRefund`, `test_claim_revert_alreadyClaimed`. |
| 4 | Approval and expiry have unambiguous timestamp boundaries | **HOLDS** (after fix) | Approval: `< approvalDeadline` (strict-before). Refund: `> approvalDeadline` (strict-after). No overlapping second. |
| 5 | Scheduled claims cannot execute early | **HOLDS** | `claimPayment` reverts `ClaimNotYetUnlocked` when `block.timestamp < claimUnlockTime`. Tests: 9 dedicated tests in `TestScheduledUnlock`. |
| 6 | One campaign cannot spend funds owed to another | **HOLDS** | Per-campaign logic; each claim/refund operates on a specific campaignId. Tests: `TestCrossCampaignIsolation`. |
| 7 | Remaining USDC always covers all outstanding obligations | **HOLDS** (after F-1 fix) | Balance-before/after check in `fundCampaign` ensures exact escrow. Full-claim and refund scenarios leave 0 residual (invariant tests confirm). |
| 8 | Failed token transfers do not mark payments as completed | **HOLDS** | CEI pattern: `creator.claimed = true` is set before `transfer`, but if `transfer` reverts or returns false (now caught), the entire transaction rolls back atomically. Tests: `test_claim_revert_transferReturnsFalse`, `TestTransferAtomicity`. |
| 9 | There is no admin withdrawal path for committed user funds | **HOLDS** | No `owner`, `Ownable`, `admin`, `withdraw`, `sweep`, or `rescue` function exists. Selector-probe test in `TestInvariants::test_invariant_noAdminWithdraw` confirms no matching function responds. |

---

## Reentrancy Assessment

`claimPayment` follows CEI (Checks-Effects-Interactions): `creator.claimed = true` is written before the `IERC20.transfer` call. A malicious ERC-20 that re-enters `claimPayment` from within `transfer` will find `creator.claimed == true` on re-entry and revert with `AlreadyClaimed`. The `TestReentrancy::test_reentrancy_claimPayment_protected` test exercises this path: only one payment exits the contract despite a re-entry attempt.

`refundBrand` similarly sets `campaign.status = Refunded` before the transfer; re-entry would find `InvalidCampaignStatus`.

OpenZeppelin's `ReentrancyGuard` was evaluated but not added, because CEI already provides equivalent protection without the extra gas cost on every call. If a future version introduces multiple external calls per transaction, `ReentrancyGuard` should be reconsidered.

---

## Duplicate Recipients

The contract allows the same wallet address to appear at multiple creator indices within one campaign. Each index is a separate escrow entry; the same wallet can claim both slots independently. This is a documented design decision — it lets brands split a single creator's allocation across multiple tranches with different amounts. The `test_createCampaign_duplicateRecipients_allowed` test documents and exercises this behaviour.

---

## What Is NOT Covered by This Review

- **Circle USDC blocklist.** If a creator wallet is blocklisted by Circle after a campaign is Approved, that creator's `claimPayment` will revert on the `transfer` call. The USDC remains locked in the contract forever (no recovery path). Brands should verify creator addresses before funding. The `replaceCreator` function mitigates this while status is Pending.
- **Live testnet state.** This review is based on source code only. It does not examine on-chain storage, past transactions, or actual USDC balances at any deployed address.
- **Gas limits.** With 20 creators and long deliverable strings, gas usage grows. No gas limit exhaustion attack vector was found, but large campaigns should be tested on mainnet conditions.
- **Off-chain processes.** KYC, creator verification, multisig key management, and incident response procedures are outside scope.
- **Frontend.** The React app UI was not reviewed for security issues.
