# Mainnet Deployment Guide — CreatorsRoomPay v4

This guide covers deploying `CreatorsRoomPay` v4 (with `approveAndPayAll`) to Arc Mainnet.
Arc Studio cannot deploy to mainnet — you run these commands from your own machine with your own wallet.

---

## Verified mainnet facts (checked 2026-10-29)

| Parameter | Value |
|---|---|
| Chain ID | 5042 (0x13b2) |
| RPC | https://rpc.mainnet.arc.io |
| USDC address | 0x3600000000000000000000000000000000000000 |
| USDC symbol / decimals | USDC / 6 (verified live) |
| Current gas price | 25 Gwei |
| Explorer | https://explorer.arc.io |

---

## Prerequisites

- [Foundry](https://getfoundry.sh) installed (`forge --version`)
- A wallet with at least **0.10 USDC** on Arc Mainnet (covers deploy gas with buffer)
- The project cloned locally: `git clone <your-repo-url> && cd <project>`

---

## Step 1 — Build the contract

```bash
forge build
```

Confirm: `Compiler run successful` with no errors.

---

## Step 2 — Deploy

```bash
forge create contracts/CreatorsRoomPay.sol:CreatorsRoomPay \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $PRIVATE_KEY \
  --constructor-args 0x3600000000000000000000000000000000000000 \
  --broadcast
```

Put your private key in an environment variable — never paste it directly into the command:
```bash
export PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

Expected output:
```
Deployer: 0x<your-wallet>
Deployed to: 0x<contract-address>
Transaction hash: 0x<tx-hash>
```

Estimated cost: **~0.05 USDC** at 25 Gwei / 2,000,000 gas.

---

## Step 3 — Record and verify

After deploy, confirm the transaction:
```bash
cast receipt <TX_HASH> --rpc-url https://rpc.mainnet.arc.io
```

Check that:
- `status` is `1` (success)
- `contractAddress` matches the `Deployed to:` address above

Confirm the USDC address stored in the contract:
```bash
cast call <CONTRACT_ADDRESS> "usdc()(address)" --rpc-url https://rpc.mainnet.arc.io
# should return: 0x3600000000000000000000000000000000000000
```

---

## Step 4 — Wire the app

Add to `/home/user/app/.env` (or your deployment environment):
```
VITE_NETWORK=mainnet
VITE_MAINNET_CONTRACT_ADDRESS=0x<YOUR_DEPLOYED_ADDRESS>
```

Rebuild:
```bash
bun run build
```

The app will now show "Arc Mainnet" and use the deployed contract.

---

## Step 5 — Update project records

Update `contracts/contract-metadata/CreatorsRoomPay-mainnet.json`:
```json
{
  "network": "arc-mainnet",
  "chainId": 5042,
  "contractAddress": "0x<YOUR_DEPLOYED_ADDRESS>",
  "txHash": "0x<TX_HASH>",
  "constructorArgs": ["0x3600000000000000000000000000000000000000"],
  "deployedAt": "<ISO_DATE>",
  "version": "v4",
  "notes": "Added approveAndPayAll for immediate-payment flow. 85/85 tests pass."
}
```

Update `AGENTS.md` with the mainnet address.

---

## Step 6 — Source verification (optional)

Arc Testnet explorer supports Blockscout-style contract verification.
On mainnet, navigate to `https://explorer.arc.io/address/<CONTRACT_ADDRESS>`,
click "Verify & Publish", select "Solidity (Single file)", compiler v0.8.20,
optimizer enabled (200 runs), and paste the source from `contracts/CreatorsRoomPay.sol`.

---

## Constructor arguments (for verification)

ABI-encoded constructor arg for `_usdc = 0x3600000000000000000000000000000000000000`:
```
0x0000000000000000000000003600000000000000000000000000000000000000
```

---

## Post-deploy smoke test

Run these read-only checks against the live contract (no USDC needed):
```bash
# Campaign count should be 0
cast call <CONTRACT_ADDRESS> "campaignCount()(uint256)" --rpc-url https://rpc.mainnet.arc.io

# USDC address should match
cast call <CONTRACT_ADDRESS> "usdc()(address)" --rpc-url https://rpc.mainnet.arc.io

# Max creators
cast call <CONTRACT_ADDRESS> "MAX_CREATORS()(uint256)" --rpc-url https://rpc.mainnet.arc.io
# expected: 20
```

---

## Security reminders

- This contract has no owner, no admin, no upgrade mechanism, and no sweep function.
- Funds are held in escrow per-campaign. No one can access them except the registered brand (refund) or creators (claim/approveAndPayAll).
- The contract was reviewed by two independent auditors (max severity). See `docs/security-review.md`.
- This guide does not substitute for a professional audit before going live with significant funds.
