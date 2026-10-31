import { LayoutGrid, Info, ExternalLink } from 'lucide-react'
import { CONTRACT_ADDRESS, ACTIVE_CHAIN_ID, IS_MAINNET, buildAddressExplorerUrl } from '@/contracts/config'
import { shortAddr } from '@/utils/format'
import { CRLogo } from '@/components/CRLogo'
import type { View } from '@/App'

interface Props {
  view: View
  onNavigate: (v: View) => void
  onHowItWorks: () => void
}

export function Sidebar({ view, onNavigate, onHowItWorks }: Props) {
  const explorerUrl =
    CONTRACT_ADDRESS.length === 42
      ? buildAddressExplorerUrl(ACTIVE_CHAIN_ID, CONTRACT_ADDRESS)
      : null

  return (
    <div className="flex h-full flex-col">

      {/* Wordmark */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <CRLogo size={32} />
          <div>
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              Creators Room
            </p>
            <span
              className="mt-0.5 inline-block rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
              style={IS_MAINNET
                ? { background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }
                : { background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.22)' }}
            >
              {IS_MAINNET ? 'Mainnet' : 'Testnet'}
            </span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3">
        <SidebarItem
          icon={<LayoutGrid className="size-4" />}
          label="Campaigns"
          active={view.kind === 'list' || view.kind === 'campaign'}
          onClick={() => onNavigate({ kind: 'list' })}
        />
        <SidebarItem
          icon={<Info className="size-4" />}
          label="How it works"
          active={false}
          onClick={onHowItWorks}
        />
      </nav>

      {/* Footer: contract info */}
      <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Network
          </p>
          <p className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
            {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}
          </p>
        </div>
        {CONTRACT_ADDRESS.length === 42 && (
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
              Contract
            </p>
            <div className="flex items-center gap-1.5">
              <span className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                {shortAddr(CONTRACT_ADDRESS)}
              </span>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center transition-opacity hover:opacity-70"
                  style={{ color: 'var(--accent)' }}
                  aria-label="View contract on explorer"
                >
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function SidebarItem({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      style={active
        ? { background: 'var(--accent-tint)', color: 'var(--accent)' }
        : { color: 'var(--muted)' }}
    >
      {icon}
      {label}
    </button>
  )
}
