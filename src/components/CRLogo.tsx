/**
 * Creators Room logo mark — faithful SVG recreation of the official CR mark.
 * Black rounded-square background, cream C, orange R with shared spine.
 * Usage:
 *   <CRLogo size={32} />          — icon only (sidebar collapsed / mobile)
 *   <CRLogo size={32} wordmark /> — icon + "Creators Room Pay" text (sidebar)
 */

interface Props {
  size?: number
  wordmark?: boolean
  className?: string
}

export function CRLogo({ size = 32, wordmark = false, className }: Props) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      {/* ── Icon mark ─────────────────────────────────────── */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0, borderRadius: size * 0.18 }}
        aria-hidden="true"
      >
        {/* Black background */}
        <rect width="100" height="100" rx="18" fill="#111111" />

        {/*
          C glyph — cream, open on the right.
          Built from a thick rounded arc shape.
        */}
        <path
          d="M52 24
             C40 24 28 33 28 50
             C28 67 40 76 52 76
             L52 64
             C45 64 40 57.5 40 50
             C40 42.5 45 36 52 36
             Z"
          fill="#F5F0E8"
        />

        {/*
          R glyph — orange, shares the vertical spine with C.
          Spine: x=52, top bowl, leg kicking right.
        */}
        {/* Vertical spine */}
        <rect x="52" y="24" width="12" height="52" rx="2" fill="#F5A623" />

        {/* Bowl — top-right curved bump */}
        <path
          d="M64 24
             C76 24 76 44 64 44
             L52 44
             L52 24
             Z"
          fill="#F5A623"
        />

        {/* Inner bowl cutout (black) to make it hollow */}
        <path
          d="M64 30
             C72 30 72 38 64 38
             L58 38
             L58 30
             Z"
          fill="#111111"
        />

        {/* Leg — diagonal kick from bowl bottom-right */}
        <path
          d="M64 44 L75 76 L63 76 L53 47 Z"
          fill="#F5A623"
        />
      </svg>

      {/* ── Wordmark text ──────────────────────────────────── */}
      {wordmark && (
        <div>
          <span
            className="block text-sm font-semibold leading-tight"
            style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            Creators Room
          </span>
        </div>
      )}
    </div>
  )
}
