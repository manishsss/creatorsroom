/**
 * Hook to read all campaigns from the CreatorsRoomPay contract.
 * Reads campaignCount, then fetches each campaign + its creators.
 */
import { useReadContract, useReadContracts } from 'wagmi'
import { CREATORS_ROOM_PAY_ABI, CONTRACT_ADDRESS, ACTIVE_CHAIN_ID } from '@/contracts/config'
import { statusLabel, type CampaignStatus } from '@/utils/format'

export interface CreatorData {
  wallet: string
  amount: bigint
  deliverable: string
  claimed: boolean
}

export interface CampaignData {
  id: number
  brand: string
  title: string
  description: string
  fundDeadline: number
  approvalDeadline: number
  status: CampaignStatus
  statusCode: number
  totalBudget: bigint
  creators: CreatorData[]
}

const CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi: CREATORS_ROOM_PAY_ABI,
  chainId: ACTIVE_CHAIN_ID,
} as const

export function useCampaignCount() {
  return useReadContract({
    ...CONTRACT,
    functionName: 'campaignCount',
  })
}

/** Read a single campaign's top-level fields */
export function useCampaign(campaignId: number) {
  return useReadContract({
    ...CONTRACT,
    functionName: 'campaigns',
    args: [BigInt(campaignId)],
    query: { enabled: campaignId >= 0 },
  })
}

/** Read creator count for a campaign */
export function useCreatorCount(campaignId: number) {
  return useReadContract({
    ...CONTRACT,
    functionName: 'getCreatorCount',
    args: [BigInt(campaignId)],
    query: { enabled: campaignId >= 0 },
  })
}

/** Read a single creator slot */
export function useCreator(campaignId: number, index: number) {
  return useReadContract({
    ...CONTRACT,
    functionName: 'getCreator',
    args: [BigInt(campaignId), BigInt(index)],
    query: { enabled: campaignId >= 0 && index >= 0 },
  })
}

/** Read all creators for a campaign given a known count */
export function useCreators(campaignId: number, count: number) {
  const contracts = Array.from({ length: count }, (_, i) => ({
    ...CONTRACT,
    functionName: 'getCreator' as const,
    args: [BigInt(campaignId), BigInt(i)] as [bigint, bigint],
  }))

  return useReadContracts({
    contracts,
    query: { enabled: count > 0 },
  })
}

/** Build a CampaignData from raw contract tuple results */
export function parseCampaignTuple(
  id: number,
  tuple: readonly [string, string, string, bigint, bigint, number, bigint] | undefined,
  creators: CreatorData[],
): CampaignData | null {
  if (!tuple) return null
  const [brand, title, description, fundDeadline, approvalDeadline, statusCode, totalBudget] = tuple
  return {
    id,
    brand,
    title,
    description,
    fundDeadline: Number(fundDeadline),
    approvalDeadline: Number(approvalDeadline),
    status: statusLabel(statusCode),
    statusCode,
    totalBudget,
    creators,
  }
}
