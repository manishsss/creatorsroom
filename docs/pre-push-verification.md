# Pre-push Verification Report
Date: 2026-10-31

## Campaign lifecycle (actual deployed behaviour)

```
createCampaign()  →  Pending
fundCampaign()    →  Active          (USDC enters escrow; balance-before/after guard)
submitDeliverable()                  (creator attaches URL; no state change)
approveAndPayAll()  →  Approved      (immediate-pay only; claimUnlockTime == 0)
  — OR —
approveCampaign()   →  Approved      (scheduled-unlock; claimUnlockTime > 0)
claimPayment()                       (creator pulls after unlock time)
refundBrand()       →  Refunded      (brand only; after approvalDeadline; Active only)
```

Difference from earlier documentation: step 5 is NOT always "approve then each creator claims separately." When `claimUnlockTime == 0` (the default for all new campaigns), `approveAndPayAll()` pushes USDC directly to every creator in the approval transaction. No per-creator claim is needed. Scheduled-unlock campaigns (`claimUnlockTime > 0`) still use `approveCampaign()` + per-creator `claimPayment()`.

---

## 1. Contract Logic

| Check | Result | Evidence |
|---|---|---|
| Recipient addresses validated (no zero address) | PASSED | `ZeroCreatorAddress(i)` revert in createCampaign L167 |
| Amounts validated (no zero amount) | PASSED | `ZeroCreatorAmount(i)` revert L168 |
| Max 20 creators enforced | PASSED | `InvalidCreatorCount` revert L157 |
| Recipients + amounts frozen after funding | PASSED | replaceCreator guards `status == Pending` L240 |
| Deadlines frozen after creation | PASSED | All deadlines stored at creation; no setter exists |
| Funding collects exactly budget once | PASSED | balance-before/after guard L217–222; `status != Pending` blocks re-fund L204 |
| Only brand can fund | PASSED | `OnlyBrand` check L205 |
| Only brand can approve | PASSED | `OnlyBrand` checks in approveCampaign L272, approveAndPayAll L307 |
| Approval before deadline (strict-before) | PASSED | `block.timestamp >= approvalDeadline` reverts L277, L308 |
| approveAndPayAll only for immediate-pay | PASSED | `ScheduledUnlockCampaign` revert L313 |
| CEI in approveAndPayAll | PASSED | status + all `claimed=true` set before external loop L316–320 |
| No creator paid without transfer success | PASSED | `TransferFailed` revert in both approveAndPayAll L329 and claimPayment L363 |
| Duplicate payment blocked (approveAndPayAll) | PASSED | Status transitions to Approved before transfers; second call hits `InvalidCampaignStatus` |
| Duplicate claim blocked (claimPayment) | PASSED | `AlreadyClaimed` revert L357 |
| Scheduled unlock enforced on-chain | PASSED | `ClaimNotYetUnlocked` revert L351 |
| Only creator can claim | PASSED | `OnlyCreator` check L356 |
| Refund only after deadline | PASSED | `ApprovalDeadlineNotPassed` L374 |
| Refund blocked if Approved | PASSED | `InvalidCampaignStatus(Active, actual)` L372 |
| Refund blocked if already Refunded | PASSED | same status check |
| Cross-campaign isolation | PASSED | 85 tests include `TestCrossCampaignIsolation` suite |
| No admin/owner/withdrawal path | PASSED | No `owner`, no admin functions, no `selfdestruct`; immutable USDC address only |
| Reentrancy | PASSED | CEI pattern throughout; `TestReentrancy` suite passes |
| Fee-on-transfer token guard | PASSED | balance-before/after diff check in fundCampaign |
| Boundary timestamps | PASSED | `TestScheduledUnlock`, boundary tests in TestApprove |

## 2. Frontend Integration

| Check | Result | Evidence |
|---|---|---|
| ABI matches contract v4 | PASSED | All functions, errors, events verified line-by-line against .sol |
| Network: VITE_NETWORK=mainnet | PASSED | .env confirmed |
| Chain ID: 5042 (Arc Mainnet) | PASSED | `eth_chainId` → 5042 |
| Contract address correct | PASSED | `0x46C58f235e0B90F3f91BF7118d01BD60d81E237A` in .env + config.ts |
| usdc() returns 0x3600...0000 | PASSED | Live eth_call confirmed |
| USDC_DECIMALS = 6 | PASSED | config.ts L51 |
| Amounts use parseUnits/formatUnits(6) | PASSED | format.ts, all input/output paths |
| Allowance check before approve | PASSED | CreateCampaign reads allowance via useReadContract; skips approve if sufficient |
| Allowance and fund are distinct steps | PASSED | FlowPhase: 'approving' → 'creating' → 'funding' clearly separated |
| Duplicate-click protection | PASSED | Phase state machine gates all buttons; disabled during 'approving'/'creating'/'funding' |
| Success only after confirmed receipt | PASSED | useWaitForTransactionReceipt; phase='done' only in isSuccess handler |
| Tx error recovery | PASSED | setPhase('idle') in catch blocks; toast.error with parseOnchainError |
| RPC overrides wallet | PASSED | config.ts explicit http() transports override MetaMask RPC |
| RPC failure ≠ zero balance | PASSED | CampaignList returns null (not zeros) while countLoading; no isLoading→zero fallback |
| Wallet switch clears state | PASSED | All reads use `address` from useAccount; wagmi re-runs queries on account change |
| Wrong network shows switch prompt | PASSED | `wrongChain` guard in CampaignDashboard and CreateCampaign |
| Payment copy accurate | PASSED | "Approve work and pay creators" for immediate-pay; "creators claim" for scheduled |
| Explorer URLs correct | PASSED | mainnet: explorer.arc.io, testnet: explorer.testnet.arc.io; switch via IS_MAINNET |
| vercel.json SPA routing | PASSED | `"source": "/(.*)"` → `"/index.html"` |

## 3. End-to-end

| Check | Result | Evidence |
|---|---|---|
| Create + fund + approve + pay (immediate) | NOT TESTED (automated) | No testnet tx this session. Flow covered by 10 TestApproveAndPayAll Foundry tests. |
| Create + fund + approve + claim (scheduled) | NOT TESTED (automated) | Covered by TestScheduledUnlock Foundry suite. |
| Duplicate funding rejected | PASSED (Foundry) | TestFund suite |
| Unauthorized approve rejected | PASSED (Foundry) | TestApprove suite |
| Expired refund | PASSED (Foundry) | TestRefund suite |
| Mainnet campaignCount() = 0 | PASSED (live) | eth_call confirmed |
| Campaign state survives refresh | PASSED (design) | All state read from chain on every mount; no localStorage dependency |

## 4. Release Quality

| Check | Result | Evidence |
|---|---|---|
| forge test | PASSED — 85/85 | `Ran 13 test suites: 85 tests passed, 0 failed` |
| lint (oxlint) | PASSED — 0 errors | check.sh output |
| typecheck (tsc --noEmit) | PASSED — 0 errors | check.sh output |
| Production build | PASSED | `✓ built in 15.16s`; chunk-size warning only (no errors) |
| .env not tracked | PASSED | .gitignore covers `.env`; git status shows ?? (untracked) |
| .circle/ not tracked | PASSED | .gitignore covers `.circle/` |
| Private keys in source | PASSED (none) | No private key literals found; all wallet ops via injected wallet |
| Nested repo creatorsroom/.git | FIXED | Added `creatorsroom/` to .gitignore |
| Source archives (.tar.gz/.zip) | FIXED | Added to .gitignore |
| ABI comment "v2" stale | FIXED | Updated to "v4" in config.ts |
| README payment description accurate | FIXED | README updated to describe both payment modes |
| env.example complete | PASSED | Both required VITE_ vars documented |

## Issues found and fixed this session

1. **ABI comment stale** — said "v2 exactly"; updated to "v4".
2. **`creatorsroom/` nested git repo** — would be tracked by outer repo on push; added to .gitignore.
3. **Source archives** — `creatorsroom-source.tar.gz`, `creatorsroom-clean.tar.gz`, `creatorsroom-source.zip` not ignored; added to .gitignore.
4. **README** — described only the claim-based flow; updated to document both immediate-pay and scheduled-unlock paths accurately.

## Known limitations (not blocking)

- **No browser integration testing.** The duplicate-click, network-switch, and error-recovery checks above are code-level audits, not recorded browser sessions.
- **Mainnet contract not explorer-verified.** Source is not submitted to explorer.arc.io. The bytecode is present and callable (13,272 bytes confirmed), and the ABI is known-correct from the local build, but the explorer has no source mapping.
- **Chunk size warning** in production build. wagmi/viem/connectkit bundle exceeds 500 KB. Not a correctness issue; normal for this stack.

## Recommendation

**Ready to push.** All automated checks pass. The two critical pre-push blockers (.gitignore gaps for `.env` and `creatorsroom/`) are now fixed. Payment logic and ABI are correct. No private keys or secrets are staged.
