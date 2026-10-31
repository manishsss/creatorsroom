/**
 * Network configuration for CreatorsRoomPay.
 *
 * Network selection: set VITE_NETWORK=mainnet to point the app at Arc Mainnet.
 * Defaults to testnet. Both configs live here so testnet is never overwritten
 * by a mainnet deploy — they are always kept separate.
 *
 * MAINNET CONTRACT:
 *   Deploy CreatorsRoomPay.sol with constructor arg 0x3600000000000000000000000000000000000000
 *   using your own wallet via:
 *     forge create contracts/CreatorsRoomPay.sol:CreatorsRoomPay \
 *       --rpc-url https://rpc.mainnet.arc.io \
 *       --private-key <YOUR_KEY> \
 *       --constructor-args 0x3600000000000000000000000000000000000000
 *   Then set VITE_MAINNET_CONTRACT_ADDRESS to the deployed address and rebuild.
 *
 * TESTNET CONTRACT (v3, 2026-10-20):
 *   0xf4be6dea250a917f95966489732eed0efa74be1a
 *   tx: 0x8d67e1b19cd91ad8273e0bdb68130042ffe33b10c7ebc5ed8422b0dc10217110
 */

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_MAINNET_CHAIN_ID = 5042

// ── Testnet ────────────────────────────────────────────────────────────
// v4 (2026-10-29): added approveAndPayAll() for immediate-payment flow
// tx: 0x1a190e52c6c7f9e86c0fa09c0b4a720a70ed5ea5cc360e756c634e8a54b07514
const TESTNET_CONTRACT_ADDRESS = '0xa7de927c7168dd320f0657803beebb687c7e8098' as `0x${string}`

// ── Mainnet ────────────────────────────────────────────────────────────
// Set VITE_MAINNET_CONTRACT_ADDRESS after deploying via forge create.
// Until set, the app shows a "not yet deployed" notice on the mainnet network.
const MAINNET_CONTRACT_ADDRESS = (
  import.meta.env.VITE_MAINNET_CONTRACT_ADDRESS ?? ''
) as `0x${string}`

// ── Active network selection ───────────────────────────────────────────
// VITE_NETWORK=mainnet → Arc Mainnet  |  anything else (or unset) → Arc Testnet
export const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'

export const ACTIVE_CHAIN_ID = IS_MAINNET ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID
export const CONTRACT_ADDRESS = IS_MAINNET ? MAINNET_CONTRACT_ADDRESS : TESTNET_CONTRACT_ADDRESS
export const MAINNET_CONTRACT_DEPLOYED = IS_MAINNET && MAINNET_CONTRACT_ADDRESS.length === 42

// Legacy alias — keeps all existing component imports compiling unchanged
export const ARC_TESTNET_CHAIN_ID_COMPAT = ARC_TESTNET_CHAIN_ID

// ── USDC ───────────────────────────────────────────────────────────────
// Same address on both Arc Testnet and Arc Mainnet
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`
export const USDC_DECIMALS = 6

// ── Explorer helpers ───────────────────────────────────────────────────
const EXPLORER_BASE = IS_MAINNET
  ? 'https://explorer.arc.io'
  : 'https://explorer.testnet.arc.io'

export function buildTxExplorerUrl(_chainId: number, hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`
}

export function buildAddressExplorerUrl(_chainId: number, address: string): string {
  return `${EXPLORER_BASE}/address/${address}`
}

// ABI — matches CreatorsRoomPay.sol v4 exactly
export const CREATORS_ROOM_PAY_ABI = [
  // --- errors ---
  { type: 'error', name: 'ZeroAddressUSDC', inputs: [] },
  { type: 'error', name: 'CampaignNotFound', inputs: [{ name: 'campaignId', type: 'uint256' }] },
  { type: 'error', name: 'EmptyTitle', inputs: [] },
  { type: 'error', name: 'InvalidFundDeadline', inputs: [{ name: 'fundDeadline', type: 'uint64' }, { name: 'currentTime', type: 'uint256' }] },
  { type: 'error', name: 'InvalidApprovalDeadline', inputs: [{ name: 'approvalDeadline', type: 'uint64' }, { name: 'fundDeadline', type: 'uint64' }] },
  { type: 'error', name: 'InvalidClaimUnlockTime', inputs: [{ name: 'claimUnlockTime', type: 'uint64' }, { name: 'approvalDeadline', type: 'uint64' }] },
  { type: 'error', name: 'ClaimNotYetUnlocked', inputs: [{ name: 'claimUnlockTime', type: 'uint64' }, { name: 'currentTime', type: 'uint256' }] },
  { type: 'error', name: 'InvalidCreatorCount', inputs: [{ name: 'count', type: 'uint256' }] },
  { type: 'error', name: 'CreatorAmountLengthMismatch', inputs: [{ name: 'walletsLength', type: 'uint256' }, { name: 'amountsLength', type: 'uint256' }] },
  { type: 'error', name: 'ZeroCreatorAddress', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'ZeroCreatorAmount', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'InvalidCampaignStatus', inputs: [{ name: 'expected', type: 'uint8' }, { name: 'actual', type: 'uint8' }] },
  { type: 'error', name: 'OnlyBrand', inputs: [{ name: 'caller', type: 'address' }, { name: 'brand', type: 'address' }] },
  { type: 'error', name: 'FundDeadlinePassed', inputs: [{ name: 'fundDeadline', type: 'uint64' }, { name: 'currentTime', type: 'uint256' }] },
  { type: 'error', name: 'ApprovalDeadlinePassed', inputs: [{ name: 'approvalDeadline', type: 'uint64' }, { name: 'currentTime', type: 'uint256' }] },
  { type: 'error', name: 'ApprovalDeadlineNotPassed', inputs: [{ name: 'approvalDeadline', type: 'uint64' }, { name: 'currentTime', type: 'uint256' }] },
  { type: 'error', name: 'ZeroTotalBudget', inputs: [] },
  { type: 'error', name: 'TransferFromFailed', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  { type: 'error', name: 'TransferFailed', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  { type: 'error', name: 'InvalidCreatorIndex', inputs: [{ name: 'index', type: 'uint256' }, { name: 'creatorCount', type: 'uint256' }] },
  { type: 'error', name: 'OnlyCreator', inputs: [{ name: 'caller', type: 'address' }, { name: 'creatorWallet', type: 'address' }] },
  { type: 'error', name: 'EmptyDeliverableLink', inputs: [] },
  { type: 'error', name: 'AlreadyClaimed', inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'creatorIndex', type: 'uint256' }] },
  { type: 'error', name: 'ScheduledUnlockCampaign', inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'claimUnlockTime', type: 'uint64' }] },
  // --- events ---
  {
    type: 'event', name: 'CampaignCreated',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'brand', type: 'address', indexed: true },
      { name: 'totalBudget', type: 'uint256', indexed: false },
      { name: 'claimUnlockTime', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CampaignFunded',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'totalBudget', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'DeliverableSubmitted',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'creatorIndex', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'link', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CampaignApproved',
    inputs: [{ name: 'campaignId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event', name: 'PaymentClaimed',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'creatorIndex', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'BrandRefunded',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'brand', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CreatorReplaced',
    inputs: [
      { name: 'campaignId', type: 'uint256', indexed: true },
      { name: 'creatorIndex', type: 'uint256', indexed: true },
      { name: 'newWallet', type: 'address', indexed: true },
    ],
  },
  // --- constructor ---
  { type: 'constructor', inputs: [{ name: '_usdc', type: 'address' }], stateMutability: 'nonpayable' },
  // --- state variables ---
  {
    type: 'function', name: 'usdc', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'campaignCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    // campaigns() now returns claimUnlockTime as the 6th field (uint64)
    type: 'function', name: 'campaigns', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'brand', type: 'address' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'fundDeadline', type: 'uint64' },
      { name: 'approvalDeadline', type: 'uint64' },
      { name: 'claimUnlockTime', type: 'uint64' },
      { name: 'status', type: 'uint8' },
      { name: 'totalBudget', type: 'uint256' },
    ],
  },
  // --- write functions ---
  {
    // createCampaign now takes claimUnlockTime (uint64) as the 5th positional argument
    type: 'function', name: 'createCampaign', stateMutability: 'nonpayable',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'fundDeadline', type: 'uint64' },
      { name: 'approvalDeadline', type: 'uint64' },
      { name: 'claimUnlockTime', type: 'uint64' },
      { name: 'creatorWallets', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [{ name: 'campaignId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'fundCampaign', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'submitDeliverable', stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'creatorIndex', type: 'uint256' },
      { name: 'link', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'approveCampaign', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'claimPayment', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'creatorIndex', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'refundBrand', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [],
  },
  {
    // approveAndPayAll: approve campaign and immediately push all allocations to creators.
    // Only callable when claimUnlockTime == 0 (immediate-payment campaigns).
    type: 'function', name: 'approveAndPayAll', stateMutability: 'nonpayable',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'replaceCreator', stateMutability: 'nonpayable',
    inputs: [
      { name: 'campaignId', type: 'uint256' },
      { name: 'creatorIndex', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
    ],
    outputs: [],
  },
  // --- view helpers ---
  {
    type: 'function', name: 'getCreatorCount', stateMutability: 'view',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'getCreator', stateMutability: 'view',
    inputs: [{ name: 'campaignId', type: 'uint256' }, { name: 'index', type: 'uint256' }],
    outputs: [
      { name: 'wallet', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deliverable', type: 'string' },
      { name: 'claimed', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'getCampaignStatus', stateMutability: 'view',
    inputs: [{ name: 'campaignId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const
