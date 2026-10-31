# Arc Studio Hackathon — Submission Checklist

## Product name

**Creators Room Pay** — Brand-to-creator USDC campaign escrow on Arc

---

## Short product description

Creators Room Pay is a trustless escrow platform for digital marketing campaigns. Brands deposit USDC into a smart contract against a list of up to 20 creators with fixed allocations and deadlines. Creators submit deliverable links on-chain. The brand approves the campaign before the approval deadline, permanently committing each creator's payment. Creators then claim their own USDC allocation. If the brand misses the deadline, they reclaim the full budget. An optional Scheduled Unlock feature lets brands set a future date before which no creator can claim, enforced on-chain. No middlemen, no platform fees, no custodians — just a Solidity state machine on Arc Testnet backed by USDC.

---

## Arc Studio app URL

<!-- Replace with your Arc Studio project URL after opening the project -->
`https://studio.arc.io/projects/<YOUR_PROJECT_ID>`

---

## Live app URL

Deploy to Netlify or Hugging Face from Arc Studio (Integrations menu → Connect Netlify / Connect Hugging Face → Deploy). Paste the live URL here after deployment.

`https://<YOUR_APP>.netlify.app`  or  `https://huggingface.co/spaces/<YOUR_HF_HANDLE>/<YOUR_SPACE>`

---

## Repository

<!-- Push to GitHub using Arc Studio → GitHub integration (Integrations menu → Push to GitHub) -->
`https://github.com/<YOUR_HANDLE>/creators-room-pay`

**Repository must contain:**
- [ ] `contracts/CreatorsRoomPay.sol` — verified source
- [ ] `contracts/test/CreatorsRoomPay.t.sol` — 75 passing tests
- [ ] `src/` — React + wagmi frontend
- [ ] `README.md` — setup + usage
- [ ] `docs/security-review.md` — structured review findings

---

## Contract addresses

| Version | Chain | Address | Explorer |
|---|---|---|---|
| v3 (current, post-audit) | Arc Testnet | `0xf4be6dea250a917f95966489732eed0efa74be1a` | [View](https://explorer.testnet.arc.io/address/0xf4be6dea250a917f95966489732eed0efa74be1a) |
| v2 (Scheduled Unlock) | Arc Testnet | `0x3fdabd335cef458d6977b5f0f694f207e960d448` | [View](https://explorer.testnet.arc.io/address/0x3fdabd335cef458d6977b5f0f694f207e960d448) |
| v1 (initial) | Arc Testnet | `0x452dfc6a03392f5cc3ab472af7cc6025c3e8e380` | [View](https://explorer.testnet.arc.io/address/0x452dfc6a03392f5cc3ab472af7cc6025c3e8e380) |

**Mainnet contract address:** NOT YET DEPLOYED — see `docs/mainnet-deploy.md` for instructions. Do not invent or use a placeholder address.

---

## Genuine testnet transaction links

These are real transactions produced during development on Arc Testnet.

| Event | Transaction |
|---|---|
| Deploy v1 | [`0x6ef7d3d1...`](https://explorer.testnet.arc.io/tx/0x6ef7d3d1ac4a9873d2deed0afcc8b44f7d518f16f014bf7da514e782e3b0a204) |
| Deploy v2 | [`0x21d3a33f...`](https://explorer.testnet.arc.io/tx/0x21d3a33fb0aca7238c876bfea12f3b41460f961d1c30dd24320d0ffeaafd0cb7) |
| Deploy v3 | [`0x8d67e1b1...`](https://explorer.testnet.arc.io/tx/0x8d67e1b19cd91ad8273e0bdb68130042ffe33b10c7ebc5ed8422b0dc10217110) |

**User-generated campaign transactions** (fund, approve, claim): run the E2E demo in the live app and copy the transaction hashes from the Tracing panel or Arc Testnet explorer. Do not invent hashes.

**Mainnet transactions:** NONE. No mainnet deployment has been made. See the deployment guide before broadcasting any mainnet transaction.

---

## Two-minute demo script

### Context (30 s)

"Creators Room Pay is a fully onchain brand-to-creator payment platform built in Arc Studio in a single session. Brands deposit USDC into a Solidity escrow. Creators get paid only when the brand approves — no platform fees, no intermediaries, no trust required."

### Arc Studio build (45 s)

1. Open Arc Studio and show the chat history: `describe the contract → audit → fix → deploy` in one thread.
2. Point at the Contracts panel — live ABI, deployment address, read-only state.
3. Show the Tracing panel — every RPC call and transaction from the live preview, decoded.
4. Mention: three deploys, two audit findings fixed, 75 Foundry tests passing.

### Payment flow demo (45 s)

1. Connect a wallet in the preview.
2. Create a campaign: three creator wallets, total 100 USDC, one-week deadline, 48-hour scheduled unlock.
3. Approve USDC allowance + fund in two transactions (show pending status in the UI).
4. Switch to a creator wallet. Show "Payout locked" badge while unlock time is in the future.
5. Brand approves the campaign — status flips to Approved.
6. After the scheduled unlock (or warp for demo): creator claims. Show Claimed badge.
7. Open Arc Testnet explorer — show the real on-chain transactions.

### Wrap (0 s — cut here)

"All payment logic is on-chain. The UI just reads state. Nothing is simulated."

---

## What remains unverified

- **Mainnet deployment.** The contract is testnet-only. No mainnet address or mainnet transactions exist yet.
- **Formal verification.** No symbolic execution or formal proof has been run.
- **Professional audit.** The structured review in `docs/security-review.md` is not a professional audit by a registered security firm.
- **USDC blocklist edge case.** If a creator wallet is USDC-blocklisted after campaign approval, their payment is permanently locked. No on-chain recovery path exists.
- **Frontend security.** The React app was not reviewed for XSS, CSRF, or key management vulnerabilities.
