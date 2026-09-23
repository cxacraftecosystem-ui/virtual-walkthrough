'use client'

/** "Print this guide" — the only client-side piece of the guide page. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="guide-btn" onClick={() => window.print()}>
      {label}
    </button>
  )
}
