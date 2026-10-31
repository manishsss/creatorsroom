import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from '@/contracts/config'

export { USDC_DECIMALS }

/** Format a raw USDC bigint (6 decimals) as "1,250.00" */
export function formatUsdc(raw: bigint): string {
  const str = formatUnits(raw, USDC_DECIMALS)
  const [int, dec = ''] = str.split('.')
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${intFormatted}.${dec.padEnd(2, '0').slice(0, 2)}`
}

/**
 * Parse a user-typed decimal string into raw USDC units (bigint, 6 decimals).
 * Returns null on any invalid input; callers must check for null before using.
 *
 * Rejection rules (not silently rounded or coerced):
 *   - Empty / whitespace-only
 *   - Scientific notation (e.g. 1e6)
 *   - Negative values
 *   - Non-numeric characters
 *   - More than 6 decimal places → caller should show "Use up to 6 decimal places."
 *   - Zero or negative after parsing
 *
 * Precision contract (verified by unit tests):
 *   "0.60"       → 600000n
 *   "0.40"       → 400000n
 *   "0.000001"   → 1n
 *   "1.0000009"  → null  (7 decimal places — rejected, never rounded)
 *   "-1"         → null
 *   "1e6"        → null
 */
export function parseUsdcInput(input: string): bigint | null {
  const t = input.trim()
  if (!t || t === '.') return null
  // Reject scientific notation and negative values
  if (/[eE+\-]/.test(t)) return null
  // Only digits and an optional single decimal point
  if (!/^\d*\.?\d*$/.test(t)) return null
  // Reject more than USDC_DECIMALS (6) decimal places — never round financial input
  const dotIdx = t.indexOf('.')
  if (dotIdx !== -1 && t.length - dotIdx - 1 > USDC_DECIMALS) return null
  try {
    const v = parseUnits(t, USDC_DECIMALS)
    if (v <= 0n) return null
    return v
  } catch {
    return null
  }
}

/** Return an error message if a USDC amount string has too many decimal places. */
export function usdcDecimalError(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  const dotIdx = t.indexOf('.')
  if (dotIdx !== -1 && t.length - dotIdx - 1 > USDC_DECIMALS) {
    return `Use up to ${USDC_DECIMALS} decimal places.`
  }
  return null
}

/** Truncate an address: 0x1234…abcd */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Unix timestamp (secs) → short locale string */
export function formatDeadline(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Format a unix timestamp for display with both the user's local timezone
 * and a UTC reference.
 * Example: "Nov 12, 2026 at 3:00 PM (UTC 15:00)"
 */
export function formatTimestampWithUtc(ts: number): string {
  const d = new Date(ts * 1000)
  const local = d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  const utcH = String(d.getUTCHours()).padStart(2, '0')
  const utcM = String(d.getUTCMinutes()).padStart(2, '0')
  return `${local} (UTC ${utcH}:${utcM})`
}

/** "datetime-local" input string → unix secs */
export function localDateToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000)
}

/** unix secs → "datetime-local" input string */
export function unixToLocalDate(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Campaign status ────────────────────────────────────────────────────
/** Raw enum values from the contract (0-3) */
export type CampaignStatusCode = 0 | 1 | 2 | 3

/** Internal canonical names — used as keys */
export type CampaignStatus = 'Pending' | 'Active' | 'Approved' | 'Refunded'

/** Map contract uint8 → internal status */
export function statusFromCode(code: number): CampaignStatus {
  return (['Pending', 'Active', 'Approved', 'Refunded'] as const)[code] ?? 'Pending'
}

// Keep legacy export name so existing callers still compile
export const statusLabel = statusFromCode

/**
 * User-facing label for a campaign.
 * Uses on-chain status plus deadline context for richer meaning.
 */
export function displayStatus(
  status: CampaignStatus,
  now: number,
  fundDeadline: number,
  approvalDeadline: number,
): string {
  if (status === 'Pending') {
    if (now > fundDeadline) return 'Expired'
    return 'Awaiting Funding'
  }
  if (status === 'Active') {
    if (now > approvalDeadline) return 'Expired'
    return 'Funded'
  }
  if (status === 'Approved') return 'Approved'
  if (status === 'Refunded') return 'Refunded'
  return status
}

export function statusColor(s: string): string {
  switch (s) {
    case 'Active':
    case 'Funded':    return '#1061a6'
    case 'Approved':  return '#1a6e40'
    case 'Refunded':  return '#6b5c42'
    case 'Expired':   return '#b52a3a'
    default:          return '#9a8c78'   // Pending / Awaiting Funding
  }
}

// ── Error messages ────────────────────────────────────────────────────
export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  const code = (error as { code?: number })?.code

  if (msg.includes('user rejected') || code === 4001)
    return 'Signature rejected — no transaction was sent.'
  if (msg.includes('insufficient') || msg.includes('exceeds balance'))
    return 'Insufficient USDC balance.'
  if (msg.includes('approvaldeadlinepassed'))
    return 'The approval deadline has already passed. The brand must reclaim instead.'
  if (msg.includes('funddeadlinepassed'))
    return 'The funding deadline has passed — this campaign can no longer be funded.'
  if (msg.includes('approvaldeadlinenotpassed'))
    return 'The approval deadline has not yet passed. Reclaim becomes available after the deadline.'
  if (msg.includes('claimnotyetunlocked'))
    return 'Payout is locked. The scheduled unlock time has not yet been reached.'
  if (msg.includes('alreadyclaimed'))
    return 'This payment has already been claimed.'
  if (msg.includes('onlybrand'))
    return 'Only the campaign brand wallet can perform this action.'
  if (msg.includes('onlycreator'))
    return 'Only the registered creator wallet can perform this action.'
  if (msg.includes('invalidcampaignstatus'))
    return 'This action is not available for the current campaign state.'
  if (msg.includes('transferfrom') || msg.includes('transfer'))
    return 'USDC transfer failed — check your balance and allowance.'
  if (msg.includes('reverted')) {
    const m = msg.match(/reason="([^"]+)"/)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction failed. Please try again.'
  }
  if (msg.includes('network') || msg.includes('timeout'))
    return 'Network error — check your connection and try again.'
  return 'Something went wrong. Please try again.'
}
