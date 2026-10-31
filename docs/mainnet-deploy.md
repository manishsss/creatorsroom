# Mainnet Deployment Guide — CreatorsRoomPay

> **WARNING.** Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you outside of Arc Studio. You are solely responsible for any losses, errors, or other consequences. Obtain an independent professional audit before deploying to mainnet.

---

## Pre-deployment checklist

- [ ] Independent professional security audit completed and all Critical/High findings resolved.
- [ ] Tested end-to-end on Arc Testnet (or the target chain's testnet) with all user flows.
- [ ] Foundry test suite passes with 0 failures (`forge test`).
- [ ] Contract source verified on the target chain explorer.
- [ ] Deployment wallet is a hardware wallet or multisig (not a hot key).
- [ ] Deployer has sufficient native gas token for the deploy transaction.
- [ ] You have confirmed the USDC contract address for the target chain (see below).

---

## Official USDC addresses (Circle-verified)

| Chain | Chain ID | USDC Address | Source |
|---|---|---|---|
| Arc Mainnet | 5042001 | `0x3600000000000000000000000000000000000000` | [Arc docs](https://docs.arc.io) |
| Ethereum Mainnet | 1 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | [Circle developers](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | [Circle developers](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| Arbitrum One | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | [Circle developers](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| Polygon PoS | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | [Circle developers](https://developers.circle.com/stablecoins/usdc-contract-addresses) |

> Always verify addresses against the official Circle developer documentation at https://developers.circle.com/stablecoins/usdc-contract-addresses immediately before deploying. Do not rely on any address listed here without re-confirming it from the official source at the time of deployment.

---

## Deployment steps

### 1. Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 2. Clone the repository and install dependencies

```bash
git clone <your-repo-url>
cd creators-room-pay
forge install
```

### 3. Set environment variables

```bash
export DEPLOYER_PRIVATE_KEY="0x..."   # Your hardware wallet or multisig key — NEVER commit this
export RPC_URL="https://rpc.arc.io"   # Replace with your target chain RPC
export USDC_ADDRESS="0x3600000000000000000000000000000000000000"  # Verify before use
```

### 4. Dry-run (simulate without broadcasting)

```bash
forge create contracts/CreatorsRoomPay.sol:CreatorsRoomPay \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args "$USDC_ADDRESS" \
  --dry-run
```

Review the output. Confirm the constructor argument is the correct USDC address.

### 5. Deploy

```bash
forge create contracts/CreatorsRoomPay.sol:CreatorsRoomPay \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args "$USDC_ADDRESS" \
  --verify                              # if the chain's explorer supports it
```

Note the printed contract address and transaction hash.

### 6. Verify source on the explorer (if not auto-verified)

```bash
forge verify-contract \
  <DEPLOYED_ADDRESS> \
  contracts/CreatorsRoomPay.sol:CreatorsRoomPay \
  --rpc-url "$RPC_URL" \
  --constructor-args $(cast abi-encode "constructor(address)" "$USDC_ADDRESS")
```

### 7. Update the frontend

In `src/contracts/config.ts`, update `CONTRACT_ADDRESS` and `ARC_TESTNET_CHAIN_ID` to the mainnet values. Change `src/config.ts` to include the mainnet chain. Rebuild with `bun run build`.

### 8. Post-deploy smoke test

Using a separate wallet (not the deployer), create a campaign with a small amount, fund it, approve it, and claim. Confirm on the explorer that all four transactions (create, approve-USDC, fund, claim) are visible and correct before announcing the deployment.

---

## What the deployer does NOT own

`CreatorsRoomPay` has no `owner`, no `Ownable`, and no admin role. The deployer wallet has no special privileges after deployment. There is no way for the deployer to withdraw user funds, modify campaigns, or change any contract parameters. All authority is per-campaign: only the brand that called `createCampaign` can fund and approve that campaign.
