/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Supports Arc Testnet (default) and Arc Mainnet (VITE_NETWORK=mainnet).
 * Both chains are always registered so ConnectKit can switch between them.
 * Explicit RPC URLs prevent wallet-cached stale endpoints from being used
 * (MetaMask may cache old rpc.testnet.arc.network — see RPC fix 2026-10-20).
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet as arcTestnetBase, arc as arcMainnetBase } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Official RPC endpoints — Arc documentation + live-verified
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.io'
const ARC_MAINNET_RPC = 'https://rpc.mainnet.arc.io'

/**
 * Override chain objects so only the verified RPC is used.
 * This prevents wagmi from falling back to whatever the injected wallet
 * advertises for these chain IDs.
 */
export const arcTestnet = {
  ...arcTestnetBase,
  rpcUrls: {
    default: { http: [ARC_TESTNET_RPC] },
    public:  { http: [ARC_TESTNET_RPC] },
  },
} as const

export const arcMainnet = {
  ...arcMainnetBase,
  rpcUrls: {
    default: { http: [ARC_MAINNET_RPC] },
    public:  { http: [ARC_MAINNET_RPC] },
  },
} as const

// Pre-register both chain RPC URLs for trace event labelling
registerChain(arcTestnet.id, ARC_TESTNET_RPC)
registerChain(arcMainnet.id, ARC_MAINNET_RPC)

export const config = createConfig({
  // Both Arc chains always registered — lets ConnectKit switch networks
  chains: [arcTestnet, arcMainnet, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]:  http(ARC_TESTNET_RPC),
    [arcMainnet.id]:  http(ARC_MAINNET_RPC),
    [mainnet.id]:     http(), // ENS resolution
  },
})
