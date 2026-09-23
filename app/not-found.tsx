import Link from 'next/link'
import './landing/landing.css'

export default function NotFound() {
  return (
    <main className="lp" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '2rem 1rem' }}>
      <div className="lp-wrap">
        <p className="lp-eyebrow">Page not found</p>
        <h1 style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 400, fontSize: 'clamp(2rem, 6vw, 3.5rem)', margin: '0.5rem 0 1.5rem' }}>
          This room is not part of the exhibition.
        </h1>
        <p style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="lp-btn lp-btn--primary" href="/gallery">
            Enter the museum
          </Link>
          <Link className="lp-btn" href="/">
            Home
          </Link>
        </p>
      </div>
    </main>
  )
}
