import { ConnectKitButton } from 'connectkit'
import { ChevronLeft, Menu, RefreshCw } from 'lucide-react'
import { IS_MAINNET } from '@/contracts/config'
// IS_MAINNET used for conditional testnet badge
import { CRLogo } from '@/components/CRLogo'
import type { View } from '@/App'

interface Props {
  pageTitle: string
  view: View
  onBack: () => void
  onMenuOpen: () => void
}

export function Topbar({ pageTitle, view, onBack, onMenuOpen }: Props) {
  const showBack = view.kind !== 'list'

  return (
    <header
      className="flex items-center justify-between px-4 py-3 lg:px-8"
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        minHeight: '56px',
      }}
    >
      {/* Left: hamburger (mobile) + breadcrumb */}
      <div className="flex items-center gap-3">
        {/* Mobile menu toggle */}
        <button
          onClick={onMenuOpen}
          className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-gray-100 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" style={{ color: 'var(--muted)' }} />
        </button>

        {/* Logo mark — visible on mobile only (sidebar hidden) */}
        <div className="lg:hidden">
          <CRLogo size={28} />
        </div>

        {/* Back button or page heading */}
        {showBack ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium transition-colors hover:opacity-70"
            style={{ color: 'var(--muted)' }}
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">Campaigns</span>
          </button>
        ) : null}

        <h1
          className="text-sm font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          {pageTitle}
        </h1>

        {/* Network badge — testnet only */}
        {!IS_MAINNET && (
          <span
            className="hidden rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline-block"
            style={{ background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.22)' }}
          >
            Arc Testnet
          </span>
        )}
      </div>

      {/* Right: wallet */}
      <div className="flex items-center gap-2">
        <ConnectKitButton />
      </div>
    </header>
  )
}

// Re-export RefreshCw for components that want a page-toolbar refresh button
export { RefreshCw }
