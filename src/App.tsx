import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { X, AlertTriangle } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { CampaignList } from '@/components/CampaignList'
import { CreateCampaign } from '@/components/CreateCampaign'
import { CampaignDashboard } from '@/components/CampaignDashboard'
import { CRLogo } from '@/components/CRLogo'
import { IS_MAINNET, MAINNET_CONTRACT_DEPLOYED } from '@/contracts/config'

export type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'campaign'; id: number }

export default function App() {
  const { isConnected, address } = useAccount()
  // address is set before isConnected settles on reconnect — use either
  const walletReady = isConnected || !!address
  const [view, setView] = useState<View>({ kind: 'list' })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const pageTitle =
    view.kind === 'create'   ? 'New Campaign' :
    view.kind === 'campaign' ? `Campaign #${view.id}` :
                               'Campaigns'

  return (
    <div className="flex min-h-dvh" style={{ background: 'var(--bg)' }}>

      {/* ── Mobile nav overlay ─────────────────────────────────────── */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ── How it works modal — rendered at root so it's never clipped ── */}
      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} />}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-56 flex-col
          transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0 lg:z-auto
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <Sidebar
          view={view}
          onNavigate={(v) => { setView(v); setMobileNavOpen(false) }}
          onHowItWorks={() => { setMobileNavOpen(false); setShowHowItWorks(true) }}
        />
      </aside>

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Topbar */}
        <Topbar
          pageTitle={pageTitle}
          view={view}
          onBack={() => setView({ kind: 'list' })}
          onMenuOpen={() => setMobileNavOpen(true)}
        />

        {/* Workspace */}
        <main className="flex-1 p-4 lg:p-8">
          <div className="mx-auto w-full max-w-5xl">

            {/* Mainnet contract not yet deployed — block all contract reads */}
            {IS_MAINNET && !MAINNET_CONTRACT_DEPLOYED && (
              <div className="mb-6 flex items-start gap-3 rounded-xl p-5"
                style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
                <AlertTriangle className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--warning)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
                    Mainnet contract not deployed yet
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--warning)' }}>
                    Set <code className="mono">VITE_MAINNET_CONTRACT_ADDRESS</code> in <code className="mono">.env</code> after
                    deploying via <code className="mono">forge create</code>, then rebuild the app.
                    See <code className="mono">docs/mainnet-deploy-v4.md</code> for the exact command.
                  </p>
                </div>
              </div>
            )}

            {/* Not-connected landing — show only on list view when no wallet */}
            {!walletReady && view.kind === 'list' && (
              <LandingCard onCreate={() => setView({ kind: 'create' })} />
            )}

            {view.kind === 'list' && (
              <CampaignList
                onSelect={(id) => setView({ kind: 'campaign', id })}
                onCreateNew={() => setView({ kind: 'create' })}
              />
            )}

            {view.kind === 'create' && (
              <CreateCampaign onCreated={() => setView({ kind: 'list' })} />
            )}

            {view.kind === 'campaign' && (
              <CampaignDashboard
                campaignId={view.id}
                onBack={() => setView({ kind: 'list' })}
              />
            )}

          </div>
        </main>
      </div>
    </div>
  )
}

// ── Not-connected landing ──────────────────────────────────────────────
function LandingCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="mb-6 rounded-xl p-8 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="mx-auto mb-4 flex justify-center">
        <CRLogo size={56} />
      </div>
      <h1 className="mb-2 text-xl font-semibold" style={{ color: 'var(--ink)' }}>
        Creators Room Pay
      </h1>
      <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
        Fund creator campaigns in USDC. Set recipients, lock the budget in escrow, approve work
        and let creators claim their payment — fully onchain.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <ConnectButton />
        <button
          onClick={onCreate}
          className="rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
          style={{ border: '1px solid var(--border)', color: 'var(--ink-2)' }}
        >
          See how it works
        </button>
      </div>

      {/* How it works */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { n: '1', title: 'Set recipients and amounts', body: 'Add up to 20 creator wallets with fixed USDC allocations.' },
          { n: '2', title: 'Fund the campaign', body: 'Lock the total budget in the escrow contract with two transactions.' },
          { n: '3', title: 'Approve so creators can claim', body: 'Creators submit deliverables; you approve to release funds.' },
        ].map(s => (
          <div key={s.n} className="rounded-lg p-4 text-left" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div
              className="mb-3 flex size-7 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)' }}
            >
              {s.n}
            </div>
            <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.title}</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConnectButton() {
  return <ConnectKitButton label="Connect Wallet" />
}

// ── How it works modal ─────────────────────────────────────────────────
// Rendered at the App root so it escapes the sidebar's fixed/clipped container
function HowItWorksModal({ onClose }: { onClose: () => void }) {
  const steps = [
    {
      title: 'Brand creates a campaign',
      body: 'Set a title, two deadlines (fund-by and approve-by), up to 20 creator wallets with fixed USDC amounts, and an optional scheduled unlock date.',
    },
    {
      title: 'Brand funds the campaign',
      body: 'Two wallet transactions: approve the USDC allowance, then transfer the full budget into the escrow contract. Funding is all-or-nothing.',
    },
    {
      title: 'Creators submit deliverables',
      body: 'Creators submit a URL stored as on-chain calldata. This is metadata only — it does not release funds.',
    },
    {
      title: 'Brand approves payouts',
      body: 'Must happen before the approve-by deadline. Approval is permanent; the budget cannot be reclaimed after approval.',
    },
    {
      title: 'Creators claim payment',
      body: 'Each creator sends a claim transaction to receive their USDC. If a scheduled unlock date was set, they must wait until it passes. Funds do not move automatically.',
    },
    {
      title: 'Expired refund',
      body: 'If the brand does not approve before the deadline, the brand (only) can reclaim the full budget with one transaction.',
    },
  ]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/25"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-md rounded-xl p-6 overflow-y-auto"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
          maxHeight: 'calc(100dvh - 48px)',
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            How Creators Room Pay works
          </h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="size-4" style={{ color: 'var(--muted)' }} />
          </button>
        </div>
        <div className="space-y-5">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent)', border: '1px solid rgba(185,71,8,0.18)' }}
              >
                {i + 1}
              </div>
              <div>
                <p className="mb-0.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)' }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
