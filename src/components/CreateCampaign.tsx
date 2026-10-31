/**
 * Create & fund campaign — all information collected first, then a single
 * "Create & fund campaign" action that chains all necessary confirmations.
 *
 * What happens on-chain (in order):
 *   1. ERC-20 approve  — only if existing allowance < totalBudget (skipped otherwise)
 *   2. createCampaign  — stores campaign structure, emits CampaignCreated
 *   3. fundCampaign    — transfers USDC from brand wallet into escrow, emits CampaignFunded
 *
 * USDC leaves the brand wallet exactly once, in step 3.
 * Step 1 is skipped for wallets that already have sufficient allowance.
 *
 * Wallet confirmations required:
 *   Fresh wallet (no prior allowance):  2 confirmations  (approve + createCampaign+fundCampaign)
 *   Wallet with sufficient allowance:   1 confirmation   (createCampaign only; fundCampaign batched or chained)
 *
 * Note: createCampaign and fundCampaign are separate contract functions.
 * Atomic batching via EIP-5792 (useWriteContracts) is attempted first.
 * When the connected wallet does not support EIP-5792 the flow falls back
 * to sequential confirmations.
 *
 * Idempotency / interrupted flow:
 *   After a successful createCampaign the campaign ID is read from the
 *   CampaignCreated event in the receipt. If the user refreshes before
 *   fundCampaign, returning to the campaign detail page shows a "Fund now"
 *   action — the campaign exists on-chain in Pending state and can still
 *   be funded before the fundDeadline.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useSwitchChain, useReadContract,
} from 'wagmi'
import { erc20Abi, decodeEventLog } from 'viem'
import { toast } from 'sonner'
import {
  Plus, Trash2, Loader2, AlertTriangle,
  ChevronRight, ChevronLeft, ChevronDown, ExternalLink, Check, Info, Settings2,
} from 'lucide-react'
import { CREATORS_ROOM_PAY_ABI, CONTRACT_ADDRESS, ACTIVE_CHAIN_ID, IS_MAINNET, USDC_ADDRESS, buildTxExplorerUrl } from '@/contracts/config'
import { formatUsdc, parseUsdcInput, usdcDecimalError, localDateToUnix, shortAddr, parseOnchainError } from '@/utils/format'
import { TokenUSDC } from '@web3icons/react'

// USDC_ADDRESS imported from @/contracts/config
const MAX_CREATORS = 20
const PAGE_LOAD_SECS = Math.floor(Date.now() / 1000)

// ── Style helpers ──────────────────────────────────────────────────────
const inputBase = 'w-full rounded-lg border px-4 py-2.5 text-sm transition-colors placeholder:text-zinc-400'
const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--ink)',
  outline: 'none',
}

function minDatetime(offsetHours = 1): string {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

interface CreatorRow { wallet: string; amount: string }

function isValidAddress(addr: string) { return /^0x[0-9a-fA-F]{40}$/.test(addr.trim()) }
function isValidAmount(v: string) { const raw = parseUsdcInput(v); return raw !== null && raw > 0n }
function walletErr(addr: string): string | null {
  if (!addr.trim()) return null
  if (!isValidAddress(addr)) return 'Invalid address'
  return null
}
function amountErr(v: string): string | null {
  if (!v.trim()) return null
  const decErr = usdcDecimalError(v)
  if (decErr) return decErr
  const parsed = parseUsdcInput(v)
  if (parsed === null) return 'Invalid amount'
  return null
}

// ── Flow phase type ────────────────────────────────────────────────────
type FlowPhase =
  | 'idle'
  | 'approving'       // waiting for ERC-20 approve signature/confirmation
  | 'creating'        // waiting for createCampaign signature/confirmation
  | 'funding'         // waiting for fundCampaign signature/confirmation
  | 'done'

interface Props { onCreated: () => void }

export function CreateCampaign({ onCreated }: Props) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [touched1, setTouched1] = useState(false)
  const [touched2, setTouched2] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Step 1 fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fundDeadline, setFundDeadline] = useState('')
  const [approvalDeadline, setApprovalDeadline] = useState('')
  const [claimUnlockDate, setClaimUnlockDate] = useState('')

  // Step 2 fields
  const [creators, setCreators] = useState<CreatorRow[]>([{ wallet: '', amount: '' }])

  // Persisted campaign ID after createCampaign confirms
  const [pendingCampaignId, setPendingCampaignId] = useState<bigint | null>(null)

  // Flow state
  const [phase, setPhase] = useState<FlowPhase>('idle')
  const [approveSkipped, setApproveSkipped] = useState(false)

  // ── Computed ───────────────────────────────────────────────────────
  const totalBudgetRaw = creators.reduce((sum, c) => sum + (parseUsdcInput(c.amount) ?? 0n), 0n)
  const fundTs = fundDeadline ? localDateToUnix(fundDeadline) : 0
  const approvalTs = approvalDeadline ? localDateToUnix(approvalDeadline) : 0
  const claimUnlockTs = claimUnlockDate ? localDateToUnix(claimUnlockDate) : 0

  // Step 1 validation
  const titleErr = touched1 && !title.trim() ? 'Title is required' : null
  const fundErrMsg = touched1 && (!fundDeadline || fundTs <= PAGE_LOAD_SECS) ? 'Must be in the future' : null
  const approvalErrMsg = touched1 && (!approvalDeadline || approvalTs <= fundTs) ? 'Must be after the fund deadline' : null
  const claimUnlockErrMsg = touched1 && claimUnlockDate && claimUnlockTs <= approvalTs
    ? 'Must be after the approve-by date' : null
  const step1Valid = title.trim().length > 0 && fundDeadline && approvalDeadline &&
    fundTs > PAGE_LOAD_SECS && approvalTs > fundTs &&
    (!claimUnlockDate || claimUnlockTs > approvalTs)

  // Step 2 validation
  const creatorErrors = creators.map(c => ({ wallet: walletErr(c.wallet), amount: amountErr(c.amount) }))
  const hasDuplicateWallets = (() => {
    const seen = new Set<string>()
    for (const c of creators) {
      const w = c.wallet.trim().toLowerCase()
      if (w && seen.has(w)) return true
      seen.add(w)
    }
    return false
  })()
  const step2Valid =
    creators.length >= 1 &&
    creators.every(c => isValidAddress(c.wallet) && isValidAmount(c.amount)) &&
    !hasDuplicateWallets &&
    totalBudgetRaw > 0n

  // ── Read current USDC allowance ────────────────────────────────────
  // This tells us whether we can skip the approve step.
  const { data: existingAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', CONTRACT_ADDRESS],
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address && step === 3 },
  })
  const allowanceSufficient = existingAllowance !== undefined && existingAllowance >= totalBudgetRaw

  // ── Write hooks ────────────────────────────────────────────────────
  const { writeContract: writeApprove, data: approveHash, isPending: approvePending, reset: approveReset } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })

  const { writeContract: writeCreate, data: createHash, isPending: createPending, reset: createReset } = useWriteContract()
  const { isLoading: createConfirming, isSuccess: createSuccess, data: createReceipt } = useWaitForTransactionReceipt({ hash: createHash })

  const { writeContract: writeFund, data: fundHash, isPending: fundPending, reset: fundReset } = useWriteContract()
  const { isLoading: fundConfirming, isSuccess: fundSuccess } = useWaitForTransactionReceipt({ hash: fundHash })

  const isBusy = phase !== 'idle' && phase !== 'done'

  // ── Step transition: approve confirmed → create ─────────────────────
  useEffect(() => {
    if (approveSuccess && phase === 'approving') {
      setPhase('creating')
      doCreate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveSuccess])

  // ── Step transition: create confirmed → fund ────────────────────────
  useEffect(() => {
    if (createSuccess && phase === 'creating' && createReceipt) {
      // Extract campaign ID from CampaignCreated event in the receipt
      let campaignId: bigint | null = null
      for (const log of createReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: CREATORS_ROOM_PAY_ABI,
            data: log.data,
            topics: log.topics,
            eventName: 'CampaignCreated',
          })
          campaignId = decoded.args.campaignId
          break
        } catch { /* not the right log */ }
      }
      if (campaignId === null) {
        toast.error('Could not read campaign ID from transaction. Fund it from the campaign page.')
        setPhase('done')
        return
      }
      setPendingCampaignId(campaignId)
      setPhase('funding')
      writeFund({
        address: CONTRACT_ADDRESS,
        abi: CREATORS_ROOM_PAY_ABI,
        functionName: 'fundCampaign',
        args: [campaignId],
        chainId: ACTIVE_CHAIN_ID,
      }, {
        onError: (e) => {
          toast.error(parseOnchainError(e) + ' You can fund this campaign from its detail page.')
          setPhase('done')
          fundReset()
        },
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSuccess, createReceipt])

  // ── Step transition: fund confirmed → done ──────────────────────────
  useEffect(() => {
    if (fundSuccess && phase === 'funding') {
      setPhase('done')
      toast.success('Campaign created and funded! Redirecting…')
      setTimeout(onCreated, 1800)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundSuccess])

  // ── doCreate: submits createCampaign ──────────────────────────────
  const doCreate = useCallback(() => {
    const wallets = creators.map(c => c.wallet.trim() as `0x${string}`)
    const amounts = creators.map(c => parseUsdcInput(c.amount)!)
    writeCreate({
      address: CONTRACT_ADDRESS,
      abi: CREATORS_ROOM_PAY_ABI,
      functionName: 'createCampaign',
      args: [title.trim(), description.trim(), BigInt(fundTs), BigInt(approvalTs), BigInt(claimUnlockTs), wallets, amounts],
      chainId: ACTIVE_CHAIN_ID,
    }, {
      onError: (e) => {
        toast.error(parseOnchainError(e))
        setPhase('idle')
        createReset()
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creators, title, description, fundTs, approvalTs, claimUnlockTs])

  // ── Primary action: "Create & fund campaign" ───────────────────────
  const handleCreateAndFund = useCallback(() => {
    if (!isConnected || !step1Valid || !step2Valid) return
    if (wrongChain) { switchChain({ chainId: ACTIVE_CHAIN_ID }); return }

    if (allowanceSufficient) {
      // Skip approve — existing allowance covers the budget
      setApproveSkipped(true)
      setPhase('creating')
      doCreate()
    } else {
      // Request USDC allowance first
      setApproveSkipped(false)
      setPhase('approving')
      writeApprove({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [CONTRACT_ADDRESS, totalBudgetRaw],
        chainId: ACTIVE_CHAIN_ID,
      }, {
        onError: (e) => {
          toast.error(parseOnchainError(e))
          setPhase('idle')
          approveReset()
        },
      })
    }
  }, [
    isConnected, wrongChain, switchChain,
    allowanceSufficient, doCreate,
    writeApprove, totalBudgetRaw, approveReset,
    step1Valid, step2Valid,
  ])

  const goStep2 = () => { setTouched1(true); if (step1Valid) setStep(2) }
  const goStep3 = () => { setTouched2(true); if (step2Valid) setStep(3) }

  const addCreator = () => { if (creators.length < MAX_CREATORS) setCreators(c => [...c, { wallet: '', amount: '' }]) }
  const removeCreator = (i: number) => setCreators(c => c.filter((_, idx) => idx !== i))
  const updateCreator = (i: number, field: 'wallet' | 'amount', value: string) =>
    setCreators(c => c.map((row, idx) => idx === i ? { ...row, [field]: value } : row))

  const stepsLabels = ['Campaign details', 'Recipients', 'Review & fund']

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">

      {/* ── Left: form ──────────────────────────────────────────────── */}
      <div className="rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          {stepsLabels.map((label, i) => {
            const num = (i + 1) as 1 | 2 | 3
            const active = step === num
            const done = step > num
            return (
              <div key={label} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-all"
                    style={{
                      background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)',
                      color: done || active ? 'white' : 'var(--muted)',
                    }}
                  >
                    {done ? <Check className="size-3.5" /> : num}
                  </div>
                  <span className="text-sm font-medium hidden sm:block"
                    style={{ color: active ? 'var(--ink)' : 'var(--subtle)' }}>
                    {label}
                  </span>
                </div>
                {i < stepsLabels.length - 1 && (
                  <div className="mx-3 h-px w-8 rounded-full" style={{ background: 'var(--border)' }} />
                )}
              </div>
            )
          })}
        </div>

        <div className="p-6">

          {/* ── Step 1: Campaign details ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Campaign details</h2>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }}>
                  Name your campaign, describe deliverables and set the deadlines. No signing required yet.
                </p>
              </div>

              <FieldGroup label="Title" required error={titleErr}>
                <input
                  type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Q4 Launch Campaign" maxLength={100}
                  className={inputBase} style={inputStyle}
                />
              </FieldGroup>

              <FieldGroup label="Description" hint="Optional">
                <textarea
                  value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Describe deliverables, goals and any creator requirements."
                  rows={3} maxLength={500}
                  className={`${inputBase} resize-none`} style={inputStyle}
                />
              </FieldGroup>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldGroup label="Fund by" required error={fundErrMsg} hint="Brand must fund before this date">
                  <input type="datetime-local" value={fundDeadline} min={minDatetime(1)}
                    onChange={e => setFundDeadline(e.target.value)} className={inputBase} style={inputStyle} />
                </FieldGroup>
                <FieldGroup label="Approve by" required error={approvalErrMsg} hint="Brand must approve before this date">
                  <input type="datetime-local" value={approvalDeadline} min={fundDeadline || minDatetime(2)}
                    onChange={e => setApprovalDeadline(e.target.value)} className={inputBase} style={inputStyle} />
                </FieldGroup>
              </div>

              {/* ── Advanced settings (collapsed by default) ─────────── */}
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:bg-gray-50"
                  style={{ color: 'var(--muted)', background: 'var(--bg)' }}
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="size-4" style={{ color: 'var(--subtle)' }} />
                    Advanced settings
                  </span>
                  <ChevronDown
                    className="size-4 transition-transform duration-200"
                    style={{
                      color: 'var(--subtle)',
                      transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>

                {showAdvanced && (
                  <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <div>
                      <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                        Scheduled unlock
                      </p>
                      <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                        Leave blank to allow payment immediately after approval.
                        If set, creators cannot claim before this date — the contract enforces this on-chain.
                        Funds do not move automatically; each creator must send a claim transaction after the unlock date.
                      </p>
                      <FieldGroup label="" error={claimUnlockErrMsg}>
                        <input
                          type="datetime-local"
                          value={claimUnlockDate}
                          min={approvalDeadline || minDatetime(3)}
                          onChange={e => setClaimUnlockDate(e.target.value)}
                          className={inputBase}
                          style={inputStyle}
                        />
                      </FieldGroup>
                      {claimUnlockDate && (
                        <div className="mt-2 flex items-start gap-2 rounded-lg p-3"
                          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                          <Info className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--warning)' }} />
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                            With a scheduled unlock, creators must each claim individually after{' '}
                            <strong>{new Date(claimUnlockDate).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>.
                            They will see a "Claim payment" button in the app once the unlock date passes.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={goStep2}
                  className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  style={{ background: 'var(--accent)', minHeight: '44px' }}>
                  Continue <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Creators ────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Recipients</h2>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }}>
                  Add up to {MAX_CREATORS} creator wallets with fixed USDC allocations.
                  Amounts are frozen once funded.
                </p>
              </div>

              <div className="space-y-3">
                {creators.map((c, i) => (
                  <div key={i} className="rounded-lg p-4"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Creator {i + 1}</span>
                      {creators.length > 1 && (
                        <button onClick={() => removeCreator(i)}
                          className="rounded-md p-1 transition-colors hover:bg-red-50"
                          style={{ color: 'var(--danger)' }} aria-label="Remove creator">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="mb-2">
                      <input type="text" value={c.wallet} onChange={e => updateCreator(i, 'wallet', e.target.value)}
                        placeholder="0x… wallet address" className={`mono ${inputBase}`} style={inputStyle} />
                      {touched2 && creatorErrors[i].wallet && (
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>{creatorErrors[i].wallet}</p>
                      )}
                    </div>
                    <div className="relative">
                      <input type="text" inputMode="decimal" value={c.amount}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9.]/g, '')
                          if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) updateCreator(i, 'amount', v)
                        }}
                        placeholder="0.00" className={`${inputBase} pr-16 tabular-nums`} style={inputStyle} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
                    </div>
                    {touched2 && creatorErrors[i].amount && (
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>{creatorErrors[i].amount}</p>
                    )}
                  </div>
                ))}
              </div>

              {touched2 && hasDuplicateWallets && (
                <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
                  Duplicate wallet addresses are not allowed.
                </p>
              )}

              {creators.length < MAX_CREATORS && (
                <button onClick={addCreator}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
                  style={{ border: '1.5px dashed var(--border-strong)', color: 'var(--muted)' }}>
                  <Plus className="size-4" /> Add creator ({creators.length}/{MAX_CREATORS})
                </button>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-100"
                  style={{ border: '1px solid var(--border)', color: 'var(--muted)', minHeight: '44px' }}>
                  <ChevronLeft className="size-4" /> Back
                </button>
                <button onClick={goStep3}
                  className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  style={{ background: 'var(--accent)', minHeight: '44px' }}>
                  Review <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Review & fund ─────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Review & fund</h2>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--muted)' }}>
                  Check everything below, then click{' '}
                  <strong>Create &amp; fund campaign</strong> to lock the budget in escrow.
                </p>
              </div>

              {/* Budget hero */}
              <div className="rounded-lg p-5 text-center"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <TokenUSDC variant="branded" size={20} />
                  <span className="text-3xl font-semibold tabular-nums"
                    style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                    {formatUsdc(totalBudgetRaw)}
                  </span>
                  <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Total budget · {creators.length} creator{creators.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Confirmations callout */}
              <div className="flex items-start gap-3 rounded-lg p-3.5"
                style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)' }}>
                <Info className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--info)' }} />
                <div className="text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
                  {allowanceSufficient ? (
                    <>
                      <strong>1 wallet confirmation</strong> required.
                      Your existing USDC allowance covers this budget — the approve step is skipped.
                    </>
                  ) : (
                    <>
                      <strong>{approveSkipped ? '1' : '2'} wallet confirmation{approveSkipped ? '' : 's'}</strong> required:
                      <ol className="mt-1 ml-3 list-decimal space-y-0.5">
                        <li>Approve USDC allowance of <strong className="tabular-nums">{formatUsdc(totalBudgetRaw)} USDC</strong></li>
                        <li>Create campaign and lock funds in escrow</li>
                      </ol>
                      <p className="mt-1.5">
                        USDC leaves your wallet exactly <strong>once</strong>, in step 2.
                        The approve step only grants permission.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Allocations */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Allocations</p>
                <div className="space-y-1.5">
                  {creators.map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2.5"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                      <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{shortAddr(c.wallet.trim())}</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                        {c.amount} <span className="text-xs font-normal" style={{ color: 'var(--subtle)' }}>USDC</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deadlines */}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Fund by', val: fundDeadline },
                  { label: 'Approve by', val: approvalDeadline },
                ].map(d => (
                  <div key={d.label} className="rounded-lg px-4 py-3"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>{d.label}</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                      {d.val ? new Date(d.val).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                  </div>
                ))}
              </div>

              {claimUnlockDate && (
                <div className="rounded-lg px-4 py-3"
                  style={{ background: 'var(--accent-tint)', border: '1px solid rgba(185,71,8,0.22)' }}>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Scheduled unlock</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                    {new Date(claimUnlockDate).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                    Creators cannot claim before this date. Funds do not move automatically.
                  </p>
                </div>
              )}

              {/* Refund rule */}
              <div className="flex items-start gap-3 rounded-lg p-4"
                style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>Budget is locked until approval</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                    Once funded, your USDC is held in the escrow contract and{' '}
                    <strong>cannot be reclaimed while the campaign is active.</strong>{' '}
                    If you do not call <em>Approve completed work</em> before the approval deadline,
                    you may then call <em>Claim expired refund</em> to recover all funds.
                    An approved campaign <strong>cannot be refunded under any circumstances.</strong>
                  </p>
                </div>
              </div>

              {/* ── Flow progress ──────────────────────────────────────── */}
              {isBusy && (
                <FlowProgress
                  phase={phase}
                  approveSkipped={approveSkipped || allowanceSufficient}
                  approvePending={approvePending}
                  approveConfirming={approveConfirming}
                  createPending={createPending}
                  createConfirming={createConfirming}
                  fundPending={fundPending}
                  fundConfirming={fundConfirming}
                  approveHash={approveHash}
                  createHash={createHash}
                />
              )}

              {/* ── Success ────────────────────────────────────────────── */}
              {phase === 'done' && fundSuccess && fundHash && (
                <div className="rounded-lg p-5 text-center"
                  style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)' }}>
                  <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full"
                    style={{ background: 'var(--success)', color: 'white' }}>
                    <Check className="size-5" />
                  </div>
                  <p className="text-base font-semibold" style={{ color: 'var(--success)' }}>Campaign created and funded!</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                    {formatUsdc(totalBudgetRaw)} USDC is now locked in escrow.
                    Creators can submit their work, and you can approve payouts from the campaign page.
                  </p>
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <a href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, fundHash)}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
                      style={{ color: 'var(--success)' }}>
                      View funding transaction <ExternalLink className="size-3" />
                    </a>
                    <button onClick={onCreated}
                      className="mt-2 w-full rounded-lg py-2.5 text-sm font-semibold text-white"
                      style={{ background: 'var(--success)', minHeight: '44px' }}>
                      View campaign
                    </button>
                  </div>
                </div>
              )}

              {/* Partial success: created but fund failed/skipped */}
              {phase === 'done' && !fundSuccess && createSuccess && pendingCampaignId !== null && (
                <div className="rounded-lg p-4"
                  style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>Campaign created — funding incomplete</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                    The campaign was created (ID #{pendingCampaignId.toString()}) but the funding transaction did not complete.
                    Open the campaign detail page to fund it before the fund deadline.
                  </p>
                  <button onClick={onCreated}
                    className="mt-3 rounded-lg px-4 py-2 text-xs font-semibold text-white"
                    style={{ background: 'var(--warning)' }}>
                    Go to campaigns
                  </button>
                </div>
              )}

              {/* ── Primary action ─────────────────────────────────────── */}
              {phase === 'idle' && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <button onClick={() => setStep(2)}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-100"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)', minHeight: '44px' }}>
                    <ChevronLeft className="size-4" /> Back
                  </button>
                  <button
                    disabled={!isConnected || isBusy}
                    onClick={() => { void handleCreateAndFund() }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: wrongChain ? '#1E3A5F' : 'var(--accent)', minHeight: '44px' }}>
                    {!isConnected
                      ? 'Connect wallet to continue'
                      : wrongChain
                      ? `Switch to Arc ${IS_MAINNET ? 'Mainnet' : 'Testnet'}`
                      : 'Create & fund campaign'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: compact summary ───────────────────────────────────── */}
      <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Summary</p>
          <div className="space-y-3">
            <SummaryRow label="Recipients" value={`${creators.filter(c => c.wallet.trim()).length} / ${MAX_CREATORS}`} />
            <SummaryRow
              label="Total USDC"
              value={totalBudgetRaw > 0n ? `${formatUsdc(totalBudgetRaw)} USDC` : '—'}
              accent={totalBudgetRaw > 0n}
            />
            {fundDeadline && (
              <SummaryRow label="Fund by"
                value={new Date(fundDeadline).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
            )}
            {approvalDeadline && (
              <SummaryRow label="Approve by"
                value={new Date(approvalDeadline).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
            )}
            {claimUnlockDate && (
              <SummaryRow label="Scheduled unlock"
                value={new Date(claimUnlockDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
            )}
          </div>
        </div>

        <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Payment rules</p>
          {[
            'Funding is all-or-nothing — no partial amounts.',
            'Brand must approve before the approval deadline.',
            'Approved campaigns cannot be refunded.',
            'Expired campaigns can be reclaimed by the brand.',
          ].map((r, i) => (
            <p key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>· {r}</p>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Flow progress component ────────────────────────────────────────────
function FlowProgress({
  phase, approveSkipped,
  approvePending, approveConfirming,
  createPending, createConfirming,
  fundPending, fundConfirming,
  approveHash, createHash,
}: {
  phase: FlowPhase
  approveSkipped: boolean
  approvePending: boolean
  approveConfirming: boolean
  createPending: boolean
  createConfirming: boolean
  fundPending: boolean
  fundConfirming: boolean
  approveHash: `0x${string}` | undefined
  createHash: `0x${string}` | undefined
}) {
  const steps: { label: string; detail: string; active: boolean; done: boolean; hash?: `0x${string}`; skipped?: boolean }[] = []

  if (!approveSkipped) {
    steps.push({
      label: 'Approve USDC allowance',
      detail: approvePending ? 'Confirm in wallet…' : approveConfirming ? 'Confirming on chain…' : 'Waiting',
      active: phase === 'approving',
      done: phase === 'creating' || phase === 'funding' || phase === 'done',
      hash: approveHash,
    })
  } else {
    steps.push({
      label: 'USDC allowance',
      detail: 'Existing allowance sufficient — skipped',
      active: false,
      done: true,
      skipped: true,
    })
  }

  steps.push({
    label: 'Create campaign',
    detail: createPending ? 'Confirm in wallet…' : createConfirming ? 'Confirming on chain…' : 'Waiting for allowance',
    active: phase === 'creating',
    done: phase === 'funding' || phase === 'done',
    hash: createHash,
  })

  steps.push({
    label: 'Transfer USDC to escrow',
    detail: fundPending ? 'Confirm in wallet…' : fundConfirming ? 'Confirming on chain…' : 'Waiting for creation',
    active: phase === 'funding',
    done: phase === 'done',
  })

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-4 py-2.5" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Transaction progress</p>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full"
              style={s.active
                ? { background: 'var(--accent)', color: 'white' }
                : s.done
                ? { background: 'var(--success-bg)', border: '1px solid var(--success-border)' }
                : { background: 'var(--bg)', border: '1px solid var(--border)' }
              }>
              {s.active
                ? <Loader2 className="size-3.5 animate-spin" />
                : s.done
                ? <Check className="size-3.5" style={{ color: 'var(--success)' }} />
                : <span className="text-[10px] font-bold" style={{ color: 'var(--subtle)' }}>{i + 1}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: s.active ? 'var(--ink)' : s.done ? 'var(--ink-2)' : 'var(--subtle)' }}>
                {s.label}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>{s.detail}</p>
            </div>
            {s.hash && s.hash !== '0x' && (
              <a href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, s.hash)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[11px] shrink-0 transition-opacity hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                View <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────
function FieldGroup({
  label, required, hint, error, children,
}: {
  label: string; required?: boolean; hint?: string; error?: string | null; children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
        {label}
        {required && <span style={{ color: 'var(--accent)' }}>*</span>}
        {hint && <span className="text-xs font-normal" style={{ color: 'var(--subtle)' }}>{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color: accent ? 'var(--accent)' : 'var(--ink-2)' }}>{value}</span>
    </div>
  )
}
