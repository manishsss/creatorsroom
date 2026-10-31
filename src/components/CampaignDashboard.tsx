/**
 * Campaign detail page — two-column desktop layout.
 * Left: campaign info, creator/payment table, deliverable links, tx history.
 * Right: funding status, budget, deadlines, actions for the connected wallet.
 *
 * Payment status is always read from the blockchain (creator.claimed).
 * Deliverable links are stored on-chain as calldata (in DeliverableSubmitted events
 * and in the getCreator view). Submitting a link is metadata — it does NOT release funds.
 */
import { useState, useEffect } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useSwitchChain, useReadContract, useReadContracts, usePublicClient,
} from 'wagmi'
import { erc20Abi, parseAbiItem } from 'viem'
import { toast } from 'sonner'
import {
  Loader2, ExternalLink, Check, Clock, Link2,
  AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Info, Lock, Timer,
} from 'lucide-react'
import { CREATORS_ROOM_PAY_ABI, CONTRACT_ADDRESS, ACTIVE_CHAIN_ID, IS_MAINNET, USDC_ADDRESS, buildTxExplorerUrl, buildAddressExplorerUrl } from '@/contracts/config'
import {
  formatUsdc, shortAddr, formatDeadline, formatTimestampWithUtc, parseOnchainError,
  statusFromCode, displayStatus, statusColor,
  type CampaignStatus,
} from '@/utils/format'
import { TokenUSDC } from '@web3icons/react'

const NOW = Math.floor(Date.now() / 1000)
// USDC_ADDRESS imported from @/contracts/config
const CONTRACT = { address: CONTRACT_ADDRESS, abi: CREATORS_ROOM_PAY_ABI, chainId: ACTIVE_CHAIN_ID } as const

type TxPhase = 'idle' | 'wallet' | 'confirming' | 'done'
interface TxRecord { label: string; hash: `0x${string}`; phase: TxPhase }
interface LogEntry { name: string; hash: `0x${string}`; blockNumber: bigint }

interface Props { campaignId: number; onBack: () => void }

export function CampaignDashboard({ campaignId, onBack: _onBack }: Props) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  // ── Contract reads ─────────────────────────────────────────────────
  const { data: campaignTuple, refetch: refetchCampaign } = useReadContract({
    ...CONTRACT, functionName: 'campaigns', args: [BigInt(campaignId)],
  })
  const { data: creatorCountData, refetch: refetchCount } = useReadContract({
    ...CONTRACT, functionName: 'getCreatorCount', args: [BigInt(campaignId)],
  })
  const count = Number(creatorCountData ?? 0n)

  const creatorCalls = Array.from({ length: count }, (_, i) => ({
    ...CONTRACT, functionName: 'getCreator' as const,
    args: [BigInt(campaignId), BigInt(i)] as [bigint, bigint],
  }))
  const { data: creatorsData, refetch: refetchCreators } = useReadContracts({
    contracts: creatorCalls,
    query: { enabled: count > 0 },
  })

  const refetchAll = () => { void refetchCampaign(); void refetchCount(); void refetchCreators() }

  // ── Event log ──────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })

  const fetchLogs = async () => {
    if (!publicClient) return
    setLogsLoading(true)
    try {
      const topicId = BigInt(campaignId)
      const events = [
        'event CampaignCreated(uint256 indexed campaignId, address indexed brand, uint256 totalBudget)',
        'event CampaignFunded(uint256 indexed campaignId, uint256 totalBudget)',
        'event CampaignApproved(uint256 indexed campaignId)',
        'event BrandRefunded(uint256 indexed campaignId, address indexed brand, uint256 amount)',
        'event PaymentClaimed(uint256 indexed campaignId, uint256 indexed creatorIndex, address indexed creator, uint256 amount)',
        'event DeliverableSubmitted(uint256 indexed campaignId, uint256 indexed creatorIndex, address indexed creator, string link)',
      ] as const

      const head = await publicClient.getBlockNumber()
      const from = head > 5000n ? head - 5000n : 0n
      const allLogs: LogEntry[] = []
      for (const eventSig of events) {
        const parsed = parseAbiItem(eventSig)
        const eventLogs = await publicClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: parsed,
          args: { campaignId: topicId } as Record<string, unknown>,
          fromBlock: from,
          toBlock: 'latest',
        })
        for (const l of eventLogs) {
          allLogs.push({ name: parsed.name, hash: l.transactionHash ?? '0x', blockNumber: l.blockNumber ?? 0n })
        }
      }
      allLogs.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1))
      setLogs(allLogs)
    } catch { /* non-fatal */ }
    setLogsLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showLogs && logs.length === 0 && !logsLoading) { void fetchLogs() } }, [showLogs])

  // ── TX state ───────────────────────────────────────────────────────
  const [txRecords, setTxRecords] = useState<TxRecord[]>([])
  const [fundPhase, setFundPhase] = useState<'idle' | 'approving' | 'funding'>('idle')
  const [deliverableInputs, setDeliverableInputs] = useState<Record<number, string>>({})

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })
  const { writeContract: approveWrite, data: approveHash, isPending: approvePending } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })

  // Read existing allowance so handleFund can skip approve when sufficient
  const { data: existingAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', CONTRACT_ADDRESS],
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address && !!campaignTuple },
  })
  const { writeContract: fundWrite, data: fundHash, isPending: fundPending } = useWriteContract()
  const { isLoading: fundConfirming, isSuccess: fundSuccess } = useWaitForTransactionReceipt({ hash: fundHash })

  const pushTx = (label: string, hash: `0x${string}`, phase: TxPhase) =>
    setTxRecords(prev => [{ label, hash, phase }, ...prev.slice(0, 9)])

  const isFundingLoading = fundPhase !== 'idle' || approvePending || approveConfirming || fundPending || fundConfirming

  // ── Side-effects for the two-step fund flow ────────────────────────
  // These MUST be in useEffect — calling setters unconditionally during
  // render causes infinite re-render loops (the white-screen crash).
  useEffect(() => {
    if (approveSuccess && fundPhase === 'approving') {
      setFundPhase('funding')
      fundWrite({ ...CONTRACT, functionName: 'fundCampaign', args: [BigInt(campaignId)] }, {
        onError: (e) => { toast.error(parseOnchainError(e)); setFundPhase('idle') },
        onSuccess: (h) => { pushTx('Campaign funded', h, 'confirming'); setTimeout(refetchAll, 3000) },
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveSuccess])

  useEffect(() => {
    if (fundSuccess && fundPhase === 'funding') {
      setFundPhase('idle')
      toast.success('Campaign funded — creators can now submit deliverables.')
      setTimeout(refetchAll, 2000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundSuccess])

  useEffect(() => {
    if (txSuccess && txHash) {
      setTxRecords(prev => prev.map(r => r.hash === txHash ? { ...r, phase: 'done' } : r))
      setTimeout(refetchAll, 500)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess, txHash])

  // Loading guard
  if (!campaignTuple) {
    return (
      <div className="flex items-center gap-3 py-16">
        <Loader2 className="size-5 animate-spin" style={{ color: 'var(--subtle)' }} />
        <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading campaign…</span>
      </div>
    )
  }

  // ── Derive campaign data ────────────────────────────────────────────
  const [brand, title, description, fundDeadlineBig, approvalDeadlineBig, claimUnlockTimeBig, statusCode, totalBudget] = campaignTuple
  const fundDeadline = Number(fundDeadlineBig)
  const approvalDeadline = Number(approvalDeadlineBig)
  const claimUnlockTime = Number(claimUnlockTimeBig)
  const status: CampaignStatus = statusFromCode(Number(statusCode))
  const ds = displayStatus(status, NOW, fundDeadline, approvalDeadline)
  const dsColor = statusColor(ds)
  const isBrand = address?.toLowerCase() === brand.toLowerCase()
  const approvalPassed = NOW > approvalDeadline
  const fundDeadlinePassed = NOW > fundDeadline

  // ── Fund flow ──────────────────────────────────────────────────────
  const handleFund = () => {
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    const allowanceSufficient = existingAllowance !== undefined && existingAllowance >= totalBudget
    if (allowanceSufficient) {
      // Skip approve — existing allowance already covers the budget
      setFundPhase('funding')
      fundWrite({ ...CONTRACT, functionName: 'fundCampaign', args: [BigInt(campaignId)] }, {
        onError: (e) => { toast.error(parseOnchainError(e)); setFundPhase('idle') },
        onSuccess: (h) => { pushTx('Campaign funded', h, 'confirming'); setTimeout(refetchAll, 3000) },
      })
    } else {
      setFundPhase('approving')
      approveWrite({
        address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
        args: [CONTRACT_ADDRESS, totalBudget], chainId: ACTIVE_CHAIN_ID,
      }, {
        onError: (e) => { toast.error(parseOnchainError(e)); setFundPhase('idle') },
      })
    }
  }

  const doWrite = (fn: Parameters<typeof writeContract>[0], label: string) => {
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }
    writeContract(fn, {
      onSuccess: (h) => { pushTx(label, h, 'confirming'); setTimeout(refetchAll, 3000) },
      onError: (e) => toast.error(parseOnchainError(e)),
    })
  }

  return (
    <div className="space-y-6">

      {/* ── Campaign header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: `${dsColor}14`, color: dsColor }}
            >
              {ds}
            </span>
            {isBrand && (
              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}>
                Your campaign
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>Campaign #{campaignId}</span>
          </div>
          <h2 className="text-2xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{description}</p>
          )}
        </div>
        <button
          onClick={refetchAll}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-gray-100"
          style={{ color: 'var(--subtle)', border: '1px solid var(--border)' }}
        >
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>

      {/* ── Two-column layout ────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

        {/* ── Left column: main content ────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* Creator / payment table */}
          <Section title={`Recipients (${count})`}>
            {count === 0 && (
              <p className="py-4 text-sm" style={{ color: 'var(--subtle)' }}>No creators loaded yet.</p>
            )}
            {count > 0 && (
              <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
                {/* Table header */}
                <div
                  className="grid grid-cols-[minmax(0,1fr)_100px_100px_auto] gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', color: 'var(--subtle)' }}
                >
                  <span>Wallet</span>
                  <span className="text-right">Allocation</span>
                  <span className="text-center">Status</span>
                  <span />
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: count }, (_, i) => {
                    const res = creatorsData?.[i]
                    if (!res || res.status !== 'success') return null
                    const [wallet, amount, deliverable, claimed] = res.result as [`0x${string}`, bigint, string, boolean]
                    const isMe = address?.toLowerCase() === wallet.toLowerCase()
                    return (
                      <CreatorRow
                        key={i}
                        index={i}
                        campaignId={campaignId}
                        wallet={wallet}
                        amount={amount}
                        deliverable={deliverable}
                        claimed={claimed}
                        isMe={isMe}
                        campaignStatus={status}
                        claimUnlockTime={claimUnlockTime}
                        deliverableInput={deliverableInputs[i] ?? ''}
                        onDeliverableInput={v => setDeliverableInputs(p => ({ ...p, [i]: v }))}
                        onRefetch={refetchAll}
                        wrongChain={wrongChain}
                        onSwitchChain={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* Deliverable metadata note */}
            <div
              className="mt-3 flex items-start gap-2 rounded-lg p-3"
              style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)' }}
            >
              <Info className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--info)' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--info)' }}>
                Deliverable links are stored as calldata in on-chain events (<code>DeliverableSubmitted</code>)
                and in the <code>getCreator()</code> view. Submitting a link is metadata only — it does{' '}
                <strong>not</strong> constitute approval or entitle a creator to payment.
                Only the brand&apos;s <strong>Approve creator payouts</strong> transaction releases funds.
              </p>
            </div>
          </Section>

          {/* Transaction history */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <button
              onClick={() => setShowLogs(v => !v)}
              className="flex w-full items-center justify-between px-5 py-4"
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Transaction history</span>
              {showLogs
                ? <ChevronUp className="size-4" style={{ color: 'var(--subtle)' }} />
                : <ChevronDown className="size-4" style={{ color: 'var(--subtle)' }} />}
            </button>
            {showLogs && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <div className="px-5 pt-3 pb-1">
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                    Last 5,000 blocks · {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
                  </p>
                </div>
                {logsLoading && (
                  <div className="flex items-center gap-2 px-5 py-4">
                    <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>Fetching events…</span>
                  </div>
                )}
                {!logsLoading && logs.length === 0 && (
                  <p className="px-5 py-4 text-xs" style={{ color: 'var(--subtle)' }}>No events found in recent blocks.</p>
                )}
                {!logsLoading && logs.length > 0 && (
                  <div className="px-5 pb-4 space-y-1">
                    {logs.map((l, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>{eventLabel(l.name)}</p>
                          <p className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>Block #{l.blockNumber.toString()}</p>
                        </div>
                        {l.hash !== '0x' && (
                          <a href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, l.hash)} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
                            style={{ color: 'var(--accent)' }}>
                            View <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="px-5 pb-4">
                  <button onClick={() => void fetchLogs()}
                    className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: 'var(--muted)' }}>
                    <RefreshCw className="size-3" /> Refresh events
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: status + actions ───────────────────────── */}
        <div className="space-y-4">

          {/* Budget */}
          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="mb-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>Total budget</p>
            <div className="flex items-baseline gap-2">
              <TokenUSDC variant="branded" size={18} />
              <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                {formatUsdc(totalBudget)}
              </span>
              <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
              {count} recipient{count !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Deadlines */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Deadlines</p>
            <DeadlineRow label="Fund by" date={formatDeadline(fundDeadline)} passed={fundDeadlinePassed} />
            <DeadlineRow label="Approve by" date={formatDeadline(approvalDeadline)} passed={approvalPassed} />
            {claimUnlockTime > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Timer className="size-3.5" style={{ color: NOW >= claimUnlockTime ? 'var(--success)' : 'var(--accent)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Scheduled unlock</span>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={NOW >= claimUnlockTime
                      ? { background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }
                      : { background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.22)' }
                    }>
                    {NOW >= claimUnlockTime ? 'Unlocked' : 'Locked'}
                  </span>
                </div>
                <p className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
                  {formatTimestampWithUtc(claimUnlockTime)}
                </p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>
                  Creators must send a claim transaction after this time. Funds do not move automatically.
                </p>
              </div>
            )}
          </div>

          {/* Brand info */}
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Brand</p>
            <div className="flex items-center justify-between gap-2">
              <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{shortAddr(brand)}</span>
              <a href={buildAddressExplorerUrl(ACTIVE_CHAIN_ID, brand)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                Explorer <ExternalLink className="size-3" />
              </a>
            </div>
          </div>

          {/* ── Brand actions ───────────────────────────────────────── */}
          {isBrand && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Brand actions</p>

              {/* Fund — recovery path for campaigns created without funding */}
              {status === 'Pending' && !fundDeadlinePassed && (
                <div className="space-y-3">
                  <ActionDescription>
                    This campaign was created but not yet funded.
                    Lock <strong className="tabular-nums">{formatUsdc(totalBudget)} USDC</strong> in escrow to activate it.
                    You may need to approve the USDC allowance first if you have not done so already.
                  </ActionDescription>
                  <ActionButton
                    loading={isFundingLoading}
                    loadingLabel={approvePending ? 'Confirm USDC allowance…' : approveConfirming ? 'Allowance confirming…' : fundPending ? 'Confirm funding…' : 'Funding…'}
                    onClick={handleFund}
                  >
                    Fund campaign
                  </ActionButton>
                  {fundHash && (
                    <TxLink hash={fundHash} label="Fund transaction" phase={fundConfirming ? 'confirming' : 'done'} />
                  )}
                </div>
              )}

              {status === 'Pending' && fundDeadlinePassed && (
                <StatusNote variant="warning">The funding deadline has passed. This campaign can no longer be funded.</StatusNote>
              )}

              {/* Approve — two paths depending on whether a scheduled unlock is set */}
              {status === 'Active' && !approvalPassed && claimUnlockTime === 0 && (
                <div className="space-y-3">
                  <ActionDescription>
                    Review the recipient list and amounts below, then approve.{' '}
                    Each creator&apos;s USDC allocation will be sent to their wallet in the same transaction.{' '}
                    <strong>This cannot be undone.</strong>
                  </ActionDescription>
                  {/* Show recipient + amount preview before signing */}
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <div className="px-3 py-2" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>
                        Payments to be sent
                      </p>
                    </div>
                    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {Array.from({ length: count }, (_, i) => {
                        const res = creatorsData?.[i]
                        if (!res || res.status !== 'success') return null
                        const [wallet, amount] = res.result as [`0x${string}`, bigint, string, boolean]
                        return (
                          <div key={i} className="flex items-center justify-between px-3 py-2.5">
                            <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                              {wallet.slice(0, 6)}…{wallet.slice(-4)}
                            </span>
                            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--success)' }}>
                              {formatUsdc(amount)} USDC
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <ActionButton
                    loading={isPending || isConfirming}
                    loadingLabel="Sending payments…"
                    onClick={() => doWrite({ ...CONTRACT, functionName: 'approveAndPayAll', args: [BigInt(campaignId)] }, 'Payments sent to all creators')}
                    color="var(--success)"
                  >
                    Approve &amp; pay creators
                  </ActionButton>
                </div>
              )}

              {/* Scheduled-unlock: brand approves, creators claim later */}
              {status === 'Active' && !approvalPassed && claimUnlockTime > 0 && (
                <div className="space-y-3">
                  <ActionDescription>
                    Approve completed work to release each allocation.
                    Because this campaign has a scheduled unlock, creators will claim individually after{' '}
                    <strong>{new Date(claimUnlockTime * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>.{' '}
                    Funds do not move automatically — each creator must send a claim transaction.{' '}
                    <strong>Approval cannot be undone.</strong>
                  </ActionDescription>
                  <ActionButton
                    loading={isPending || isConfirming}
                    loadingLabel="Confirming…"
                    onClick={() => doWrite({ ...CONTRACT, functionName: 'approveCampaign', args: [BigInt(campaignId)] }, 'Work approved — creators can claim after unlock')}
                    color="var(--success)"
                  >
                    Approve completed work
                  </ActionButton>
                </div>
              )}

              {/* Claim expired refund */}
              {status === 'Active' && approvalPassed && (
                <div className="space-y-3">
                  <StatusNote variant="warning">
                    Approval deadline passed without approval. You may reclaim the full budget.
                  </StatusNote>
                  <ActionButton
                    loading={isPending || isConfirming}
                    loadingLabel="Confirming…"
                    onClick={() => doWrite({ ...CONTRACT, functionName: 'refundBrand', args: [BigInt(campaignId)] }, 'Budget reclaimed')}
                    color="var(--danger)"
                  >
                    Claim expired refund
                  </ActionButton>
                </div>
              )}

              {/* Pending TX feedback */}
              {txRecords.filter(r => r.phase === 'confirming' || r.phase === 'done').slice(0, 1).map(r => (
                <TxLink key={r.hash} hash={r.hash} label={r.label} phase={r.phase} />
              ))}
            </div>
          )}

          {/* Wrong chain nudge */}
          {wrongChain && isConnected && (
            <button
              onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID })}
              className="w-full rounded-lg py-2.5 text-sm font-semibold transition-colors hover:opacity-90"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.22)' }}
            >
              {IS_MAINNET ? 'Switch to Arc Mainnet' : 'Switch to Arc Testnet'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Per-creator row ────────────────────────────────────────────────────
interface CreatorRowProps {
  index: number
  campaignId: number
  wallet: `0x${string}`
  amount: bigint
  deliverable: string
  claimed: boolean
  isMe: boolean
  campaignStatus: CampaignStatus
  claimUnlockTime: number
  deliverableInput: string
  onDeliverableInput: (v: string) => void
  onRefetch: () => void
  wrongChain: boolean
  onSwitchChain: () => void
}

function CreatorRow({
  index, campaignId, wallet, amount, deliverable, claimed,
  isMe, campaignStatus, claimUnlockTime, deliverableInput, onDeliverableInput, onRefetch, wrongChain, onSwitchChain,
}: CreatorRowProps) {
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const unlockReached = claimUnlockTime === 0 || NOW >= claimUnlockTime
  const canSubmit = campaignStatus === 'Active' && isMe
  const canClaim  = campaignStatus === 'Approved' && isMe && !claimed

  // Must be in useEffect — calling onRefetch() during render causes infinite loops
  useEffect(() => {
    if (isSuccess) onRefetch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const handleClaim = () => {
    if (wrongChain) { onSwitchChain(); return }
    writeContract(
      { ...CONTRACT, functionName: 'claimPayment', args: [BigInt(campaignId), BigInt(index)] },
      { onError: (e) => toast.error(parseOnchainError(e)), onSuccess: () => setTimeout(onRefetch, 2500) },
    )
  }

  const handleSubmit = () => {
    if (wrongChain) { onSwitchChain(); return }
    const link = deliverableInput.trim()
    if (!link) { toast.error('Please enter a deliverable URL.'); return }
    writeContract(
      { ...CONTRACT, functionName: 'submitDeliverable', args: [BigInt(campaignId), BigInt(index), link] },
      {
        onError: (e) => toast.error(parseOnchainError(e)),
        onSuccess: () => { toast.success('Deliverable link stored on chain.'); setTimeout(onRefetch, 2500) },
      },
    )
  }

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_100px_100px_auto] items-start gap-3 px-4 py-3.5"
      style={isMe ? { background: 'var(--accent-tint)' } : {}}
    >
      {/* Wallet */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-center font-semibold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--border)', color: 'var(--muted)', fontSize: '10px' }}>
            {index + 1}
          </span>
          <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{shortAddr(wallet)}</span>
          {isMe && <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>You</span>}
        </div>

        {/* Deliverable link */}
        {deliverable && (
          <div className="mt-2 ml-7">
            <a
              href={deliverable}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors hover:opacity-80"
              style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)', color: 'var(--info)' }}
            >
              <Link2 className="size-3 shrink-0" />
              <span className="truncate">{deliverable}</span>
              <ExternalLink className="ml-auto size-3 shrink-0" />
            </a>
          </div>
        )}

        {/* Submit deliverable input */}
        {canSubmit && !deliverable && (
          <div className="mt-2 ml-7 flex gap-1.5">
            <input
              type="url"
              value={deliverableInput}
              onChange={e => onDeliverableInput(e.target.value)}
              placeholder="https://deliverable-link.com"
              className="flex-1 rounded-md px-2.5 py-1.5 text-xs"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
            />
            <button
              disabled={isPending || isConfirming || !deliverableInput.trim()}
              onClick={handleSubmit}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--info)' }}
            >
              {(isPending || isConfirming) ? <Loader2 className="size-3 animate-spin" /> : 'Submit'}
            </button>
          </div>
        )}
      </div>

      {/* Allocation */}
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
          {formatUsdc(amount)}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--subtle)' }}>USDC</p>
      </div>

      {/* Status */}
      <div className="flex justify-center">
        <span className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold"
          style={claimed
            ? { background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-border)' }
            : { background: 'var(--bg)', color: 'var(--subtle)', border: '1px solid var(--border)' }
          }>
          {claimed
            ? (claimUnlockTime === 0 && campaignStatus === 'Approved' ? 'Paid' : 'Claimed')
            : 'Unclaimed'}
        </span>
      </div>

      {/* Claim action */}
      <div className="flex justify-end">
        {canClaim && (
          unlockReached ? (
            <button
              disabled={isPending || isConfirming}
              onClick={handleClaim}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--success)', minHeight: '36px' }}
            >
              {(isPending || isConfirming)
                ? <Loader2 className="size-3.5 animate-spin" />
                : <><Check className="size-3.5" /> Claim payment</>
              }
            </button>
          ) : (
            <div
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold"
              style={{ background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }}
            >
              <Lock className="size-3.5" />
              Locked
            </div>
          )
        )}
        {wrongChain && isMe && (campaignStatus === 'Active' || campaignStatus === 'Approved') && (
          <button
            onClick={onSwitchChain}
            className="rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors hover:opacity-80"
            style={{ background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.22)' }}
          >
            Switch network
          </button>
        )}
      </div>
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function DeadlineRow({ label, date, passed }: { label: string; date: string; passed: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Clock className="size-3.5" style={{ color: passed ? 'var(--danger)' : 'var(--subtle)' }} />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      </div>
      <span className="text-xs font-medium tabular-nums" style={{ color: passed ? 'var(--danger)' : 'var(--ink-2)' }}>
        {date}
      </span>
    </div>
  )
}

function ActionDescription({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{children}</p>
  )
}

function ActionButton({
  loading, loadingLabel, onClick, children, color,
}: {
  loading: boolean
  loadingLabel?: string
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      disabled={loading}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: color ?? 'var(--accent)', minHeight: '44px' }}
    >
      {loading
        ? <><Loader2 className="size-4 animate-spin" />{loadingLabel ?? 'Confirming…'}</>
        : children}
    </button>
  )
}

function StatusNote({ children, variant }: { children: React.ReactNode; variant: 'warning' | 'info' }) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg p-3"
      style={variant === 'warning'
        ? { background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }
        : { background: 'var(--info-bg)', border: '1px solid var(--info-border)' }
      }
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" style={{ color: variant === 'warning' ? 'var(--warning)' : 'var(--info)' }} />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>{children}</p>
    </div>
  )
}

function TxLink({ hash, label, phase }: { hash: `0x${string}`; label: string; phase: TxPhase }) {
  if (hash === '0x') return null
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2.5"
      style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
      {phase === 'confirming'
        ? <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--success)' }} />
        : <Check className="size-3.5" style={{ color: 'var(--success)' }} />
      }
      <span className="flex-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
        {phase === 'confirming' ? 'Confirming on chain…' : label}
      </span>
      <a href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, hash)} target="_blank" rel="noreferrer"
        className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-70"
        style={{ color: 'var(--accent)' }}>
        View <ExternalLink className="size-3" />
      </a>
    </div>
  )
}

function eventLabel(name: string): string {
  switch (name) {
    case 'CampaignCreated':      return 'Campaign created'
    case 'CampaignFunded':       return 'Campaign funded'
    case 'CampaignApproved':     return 'Creator payouts approved'
    case 'BrandRefunded':        return 'Budget reclaimed'
    case 'PaymentClaimed':       return 'Payment claimed'
    case 'DeliverableSubmitted': return 'Deliverable submitted'
    default:                     return name
  }
}
