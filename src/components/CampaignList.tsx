/**
 * Campaigns page — two tabs: "Created by you" and "You're a recipient".
 * Summary stats derived from live contract state only — never estimated.
 * Desktop: structured table. Mobile: card list.
 *
 * Payment model (v4 contract):
 *   - Campaigns WITHOUT scheduled unlock: brand calls approveAndPayAll()
 *     which pays all creators in the same tx. No creator claim needed.
 *   - Campaigns WITH scheduled unlock: brand calls approveCampaign(),
 *     then each creator calls claimPayment() after the unlock date.
 */
import { useState } from 'react'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import {
  Loader2, Plus, RefreshCw, ArrowRight,
  Wallet, Lock, CheckCircle2, Clock,
} from 'lucide-react'
import {
  CREATORS_ROOM_PAY_ABI, CONTRACT_ADDRESS, ACTIVE_CHAIN_ID,
  IS_MAINNET, MAINNET_CONTRACT_DEPLOYED,
} from '@/contracts/config'
import {
  formatUsdc, shortAddr, formatDeadline,
  statusFromCode, displayStatus, statusColor,
  type CampaignStatus,
} from '@/utils/format'

const CONTRACT = { address: CONTRACT_ADDRESS, abi: CREATORS_ROOM_PAY_ABI, chainId: ACTIVE_CHAIN_ID } as const
const NOW = Math.floor(Date.now() / 1000)

interface CampaignSummary {
  id: number
  brand: string
  title: string
  fundDeadline: number
  approvalDeadline: number
  claimUnlockTime: number
  status: CampaignStatus
  totalBudget: bigint
  myCreatorIndex: number
  myAllocation: bigint
  myClaimed: boolean
}

type Tab = 'brand' | 'creator'

interface Props {
  onSelect: (id: number) => void
  onCreateNew: () => void
}

export function CampaignList({ onSelect, onCreateNew }: Props) {
  const { address, isConnected } = useAccount()
  const walletReady = isConnected || !!address
  const [tab, setTab] = useState<Tab>('brand')

  // ── Contract reads ────────────────────────────────────────────
  const { data: countData, isLoading: countLoading, refetch: refetchCount } = useReadContract({
    ...CONTRACT,
    functionName: 'campaignCount',
    query: { enabled: !!CONTRACT_ADDRESS },
  })
  const count = Number(countData ?? 0n)

  const campaignCalls = Array.from({ length: count }, (_, i) => ({
    ...CONTRACT, functionName: 'campaigns' as const, args: [BigInt(i)] as [bigint],
  }))
  const { data: campaignData, isLoading: campaignsLoading, refetch: refetchCampaigns } = useReadContracts({
    contracts: campaignCalls, query: { enabled: count > 0 },
  })

  const creatorCountCalls = Array.from({ length: count }, (_, i) => ({
    ...CONTRACT, functionName: 'getCreatorCount' as const, args: [BigInt(i)] as [bigint],
  }))
  const { data: creatorCountData, isLoading: creatorCountsLoading, refetch: refetchCreatorCounts } = useReadContracts({
    contracts: creatorCountCalls, query: { enabled: count > 0 && walletReady },
  })

  const flatCreatorCalls: { address: `0x${string}`; abi: typeof CREATORS_ROOM_PAY_ABI; chainId: number; functionName: 'getCreator'; args: [bigint, bigint] }[] = []
  const creatorCallMap: { campaignId: number; idx: number }[] = []
  if (walletReady && creatorCountData) {
    creatorCountData.forEach((res, ci) => {
      if (res.status !== 'success') return
      const n = Number(res.result)
      for (let j = 0; j < n; j++) {
        flatCreatorCalls.push({ ...CONTRACT, functionName: 'getCreator', args: [BigInt(ci), BigInt(j)] })
        creatorCallMap.push({ campaignId: ci, idx: j })
      }
    })
  }
  const { data: flatCreatorData, isLoading: flatCreatorsLoading, refetch: refetchFlatCreators } = useReadContracts({
    contracts: flatCreatorCalls, query: { enabled: flatCreatorCalls.length > 0 },
  })

  // ── Build summaries ──────────────────────────────────────────
  const myCreatorIndexMap: Record<number, { idx: number; amount: bigint; claimed: boolean }> = {}
  if (address && flatCreatorData) {
    flatCreatorData.forEach((res, i) => {
      if (res.status !== 'success') return
      const [wallet, amount, , claimed] = res.result as [`0x${string}`, bigint, string, boolean]
      if (wallet.toLowerCase() === address.toLowerCase()) {
        const { campaignId, idx } = creatorCallMap[i]
        if (myCreatorIndexMap[campaignId] === undefined) {
          myCreatorIndexMap[campaignId] = { idx, amount, claimed }
        }
      }
    })
  }

  const allCampaigns: CampaignSummary[] = []
  campaignData?.forEach((res, i) => {
    if (res.status !== 'success') return
    const [brand, title, , fundDeadlineBig, approvalDeadlineBig, claimUnlockTimeBig, statusCode, totalBudget] =
      res.result as [`0x${string}`, string, string, bigint, bigint, bigint, number, bigint]
    const entry = myCreatorIndexMap[i]
    allCampaigns.push({
      id: i, brand, title,
      fundDeadline: Number(fundDeadlineBig),
      approvalDeadline: Number(approvalDeadlineBig),
      claimUnlockTime: Number(claimUnlockTimeBig),
      status: statusFromCode(Number(statusCode)),
      totalBudget,
      myCreatorIndex: entry?.idx ?? -1,
      myAllocation: entry?.amount ?? 0n,
      myClaimed: entry?.claimed ?? false,
    })
  })

  const brandCampaigns = address
    ? allCampaigns.filter(c => c.brand.toLowerCase() === address.toLowerCase())
    : []
  const creatorCampaigns = allCampaigns.filter(c => c.myCreatorIndex !== -1)

  // ── Stats ─────────────────────────────────────────────────────
  // Funds locked: Active brand campaigns
  const lockedFunds = brandCampaigns
    .filter(c => c.status === 'Active')
    .reduce((s, c) => s + c.totalBudget, 0n)

  // Claimable: Approved campaigns where creator hasn't claimed and unlock time passed
  // (only relevant when claimUnlockTime > 0, i.e. scheduled-unlock campaigns)
  const claimableByMe = creatorCampaigns
    .filter(c =>
      c.status === 'Approved' &&
      !c.myClaimed &&
      c.claimUnlockTime > 0 &&
      NOW >= c.claimUnlockTime
    )
    .reduce((s, c) => s + c.myAllocation, 0n)

  // Received: Approved campaigns where creator was directly paid (claimUnlockTime === 0 + claimed)
  const receivedByMe = creatorCampaigns
    .filter(c => c.status === 'Approved' && c.myClaimed && c.claimUnlockTime === 0)
    .reduce((s, c) => s + c.myAllocation, 0n)

  // Has any scheduled-unlock creator activity?
  const hasScheduledActivity = creatorCampaigns.some(c => c.claimUnlockTime > 0)

  const awaitingApproval = brandCampaigns.filter(c => {
    const ds = displayStatus(c.status, NOW, c.fundDeadline, c.approvalDeadline)
    return ds === 'Funded'
  }).length

  const refetchAll = () => {
    void refetchCount()
    void refetchCampaigns()
    void refetchCreatorCounts()
    void refetchFlatCreators()
  }

  const isLoading = countLoading || (count > 0 && campaignsLoading) || creatorCountsLoading || flatCreatorsLoading
  const activeCampaigns = tab === 'brand' ? brandCampaigns : creatorCampaigns
  const hasCampaigns = activeCampaigns.length > 0

  if (!walletReady) return null
  if (IS_MAINNET && !MAINNET_CONTRACT_DEPLOYED) return null

  return (
    <div style={{ maxWidth: '1120px' }} className="w-full space-y-5">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold leading-tight" style={{ fontSize: '28px', color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Campaigns
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Fund campaigns, review work and pay creators in USDC.
          </p>
        </div>
        {/* Header button only shown when campaigns exist */}
        {(hasCampaigns || !isLoading) && brandCampaigns.length > 0 && (
          <button
            onClick={onCreateNew}
            className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: 'var(--accent)' }}
          >
            <Plus className="size-4" /> Create campaign
          </button>
        )}
      </div>

      {/* ── Summary strip ───────────────────────────────────── */}
      {!isLoading && (
        <div
          className="grid grid-cols-1 divide-y overflow-hidden rounded-xl sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <StatStrip
            icon={<Lock className="size-3.5" />}
            label="Funds locked"
            value={formatUsdc(lockedFunds)}
            unit="USDC"
          />
          {hasScheduledActivity ? (
            <StatStrip
              icon={<Clock className="size-3.5" />}
              label="Claimable by you"
              value={formatUsdc(claimableByMe)}
              unit="USDC"
              accent={claimableByMe > 0n}
            />
          ) : (
            <StatStrip
              icon={<CheckCircle2 className="size-3.5" />}
              label="Received by you"
              value={formatUsdc(receivedByMe)}
              unit="USDC"
              accent={receivedByMe > 0n}
            />
          )}
          <StatStrip
            icon={<Wallet className="size-3.5" />}
            label="Awaiting your approval"
            value={String(awaitingApproval)}
            unit={awaitingApproval === 1 ? 'campaign' : 'campaigns'}
            accent={awaitingApproval > 0}
          />
        </div>
      )}
      {isLoading && (
        <div
          className="h-[72px] animate-pulse rounded-xl"
          style={{ background: 'var(--border)' }}
        />
      )}

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div
          className="flex gap-0.5 rounded-lg p-0.5"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', display: 'inline-flex' }}
        >
          <TabButton active={tab === 'brand'} onClick={() => setTab('brand')}>
            Created by you
            {brandCampaigns.length > 0 && (
              <span
                className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={tab === 'brand'
                  ? { background: 'var(--accent)', color: 'white' }
                  : { background: 'var(--border)', color: 'var(--muted)' }}
              >
                {brandCampaigns.length}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === 'creator'} onClick={() => setTab('creator')}>
            You&apos;re a recipient
            {creatorCampaigns.length > 0 && (
              <span
                className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={tab === 'creator'
                  ? { background: 'var(--accent)', color: 'white' }
                  : { background: 'var(--border)', color: 'var(--muted)' }}
              >
                {creatorCampaigns.length}
              </span>
            )}
          </TabButton>
        </div>

        {count > 0 && !isLoading && (
          <button
            onClick={refetchAll}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100"
            style={{ color: 'var(--subtle)' }}
          >
            <RefreshCw className="size-3" /> Refresh
          </button>
        )}
      </div>

      {/* ── Loading ─────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center gap-2 py-6">
          <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading campaigns…</span>
        </div>
      )}

      {/* ── Empty states ─────────────────────────────────────── */}
      {!isLoading && activeCampaigns.length === 0 && (
        tab === 'brand'
          ? <BrandEmptyState onCreate={onCreateNew} />
          : <RecipientEmptyState />
      )}

      {/* ── Campaign table ───────────────────────────────────── */}
      {!isLoading && activeCampaigns.length > 0 && (
        <div
          className="overflow-hidden rounded-xl"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          {/* Table header — desktop */}
          <div
            className="hidden grid-cols-[minmax(0,2fr)_110px_130px_130px_160px_32px] items-center gap-4 px-5 py-3 md:grid"
            style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
          >
            {['Campaign', 'Status', 'Budget', tab === 'creator' ? 'Your allocation' : '', 'Next deadline', ''].map((h, i) => (
              <span key={i} className={`text-[11px] font-semibold uppercase tracking-wide ${i >= 2 && i <= 3 ? 'text-right' : ''}`} style={{ color: 'var(--subtle)' }}>{h}</span>
            ))}
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {activeCampaigns.map(c => (
              <CampaignRow
                key={c.id}
                campaign={c}
                isBrand={c.brand.toLowerCase() === (address?.toLowerCase() ?? '')}
                showAllocation={tab === 'creator'}
                onClick={() => onSelect(c.id)}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function StatStrip({
  icon, label, value, unit, accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  accent?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: accent ? 'var(--accent)' : 'var(--subtle)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium leading-none mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
        <div className="flex items-baseline gap-1">
          <span
            className="text-xl font-semibold tabular-nums leading-none"
            style={{ color: accent ? 'var(--accent)' : 'var(--ink)', letterSpacing: '-0.02em' }}
          >
            {value}
          </span>
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>{unit}</span>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
      style={active
        ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
        : { color: 'var(--muted)' }}
    >
      {children}
    </button>
  )
}

function CampaignRow({
  campaign, isBrand, showAllocation, onClick,
}: {
  campaign: CampaignSummary
  isBrand: boolean
  showAllocation: boolean
  onClick: () => void
}) {
  const { id, title, brand, status, totalBudget, myAllocation, myClaimed, fundDeadline, approvalDeadline, claimUnlockTime } = campaign
  const ds = displayStatus(status, NOW, fundDeadline, approvalDeadline)
  const color = statusColor(ds)

  const nextDeadline =
    status === 'Pending' ? `Fund by ${formatDeadline(fundDeadline)}` :
    status === 'Active' && NOW <= approvalDeadline ? `Approve by ${formatDeadline(approvalDeadline)}` :
    ds

  // Label for creator allocation status
  const allocationLabel = claimUnlockTime > 0
    ? (myClaimed ? 'Claimed' : 'Claimable')
    : (myClaimed ? 'Paid' : 'Pending')

  return (
    <button
      onClick={onClick}
      className="group w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2"
      style={{ ['--tw-ring-color' as string]: 'var(--accent)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-tint)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
      onFocus={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-tint)' }}
      onBlur={e => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      {/* Desktop */}
      <div className="hidden grid-cols-[minmax(0,2fr)_110px_130px_130px_160px_32px] items-center gap-4 px-5 py-3.5 md:grid">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
            {isBrand ? `Campaign #${id}` : `Brand: ${shortAddr(brand)} · #${id}`}
          </p>
        </div>
        <div>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: `${color}18`, color }}
          >
            {ds}
          </span>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{formatUsdc(totalBudget)}</p>
          <p className="text-[10px]" style={{ color: 'var(--subtle)' }}>USDC</p>
        </div>
        <div className="text-right">
          {showAllocation && myAllocation > 0n ? (
            <>
              <p className="text-sm font-semibold tabular-nums" style={{ color: myClaimed ? 'var(--subtle)' : 'var(--ink)' }}>
                {formatUsdc(myAllocation)}
              </p>
              <p className="text-[10px]" style={{ color: myClaimed ? 'var(--success)' : 'var(--subtle)' }}>
                {allocationLabel}
              </p>
            </>
          ) : <span />}
        </div>
        <div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{nextDeadline}</p>
        </div>
        <div className="flex justify-end">
          <ArrowRight
            className="size-4 opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5"
            style={{ color: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* Mobile card */}
      <div className="flex items-start justify-between gap-3 px-4 py-4 md:hidden">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: `${color}18`, color }}
            >
              {ds}
            </span>
            <span className="text-xs tabular-nums font-medium" style={{ color: 'var(--muted)' }}>
              {formatUsdc(totalBudget)} USDC
            </span>
            {showAllocation && myAllocation > 0n && (
              <span className="text-xs tabular-nums" style={{ color: myClaimed ? 'var(--success)' : 'var(--accent)' }}>
                {formatUsdc(myAllocation)} {allocationLabel.toLowerCase()}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>{nextDeadline}</p>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--accent)' }} />
      </div>
    </button>
  )
}

function BrandEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div className="grid gap-0 lg:grid-cols-2">

        {/* Left: CTA */}
        <div className="flex flex-col justify-center px-8 py-10">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Your next campaign starts here
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            Set up recipients and allocations, fund the budget in USDC escrow, then approve work
            to pay creators directly — all onchain with no intermediary.
          </p>
          <div className="mt-6">
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="size-4" /> Create campaign
            </button>
          </div>
        </div>

        {/* Right: steps */}
        <div
          className="flex flex-col justify-center gap-4 px-8 py-10 lg:border-l"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {[
            {
              n: 1,
              title: 'Set recipients and amounts',
              desc: 'Add up to 20 creator wallets with fixed USDC allocations.',
            },
            {
              n: 2,
              title: 'Fund the campaign',
              desc: 'Lock the full budget in the escrow contract — one USDC transfer.',
            },
            {
              n: 3,
              title: 'Approve work and pay creators',
              desc: 'One transaction approves the work and sends USDC to every creator.',
            },
          ].map(({ n, title, desc }) => (
            <div key={n} className="flex gap-3">
              <div
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}
              >
                {n}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}

function RecipientEmptyState() {
  return (
    <div
      className="rounded-xl px-8 py-12 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <Wallet className="size-5" style={{ color: 'var(--subtle)' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>No campaign payments yet</p>
      <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
        Campaigns that include your connected wallet as a recipient will appear here.
      </p>
    </div>
  )
}
