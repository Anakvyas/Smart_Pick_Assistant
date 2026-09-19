import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ResultPanel from '../components/ResultPanel'
import BackgroundDecor from '../components/BackgroundDecor'
import { httpUrl } from '../config'
import './Demo.css'

/**
 * A static showcase of what a scan result looks like — real barcode, name,
 * company and weight (pulled once from Open Food Facts), plus a handful of
 * plausible expiry/batch/GSTIN/MRP values no public database tracks
 * per-barcode. Entirely separate from the live scan pipeline: nothing here
 * touches /ws/scan, /ws/display or the Detected items inventory.
 */
export default function Demo() {
  const [state, setState] = useState({ status: 'loading', products: [] })

  useEffect(() => {
    fetch(httpUrl('/api/demo'))
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`)
        return res.json()
      })
      .then((products) => setState({ status: 'done', products }))
      .catch((err) => setState({ status: 'error', products: [], error: err.message }))
  }, [])

  return (
    <div className="demo-page">
      <BackgroundDecor />
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          Smart Pick <span className="brand-sub">demo products</span>
        </div>
        <Link to="/" className="back-link">← live display</Link>
      </header>

      <p className="demo-note">
        Sample results shown without a camera — real barcode, name, company and weight
        (via Open Food Facts); expiry, batch, GSTIN and MRP are illustrative since no
        public database tracks those per barcode.
      </p>

      {state.status === 'loading' && (
        <div className="demo-grid">
          {[0, 1, 2].map((i) => (
            <div className="demo-card demo-card-skeleton" key={i}>
              <div className="skeleton demo-card-skeleton-img" />
              <div className="demo-card-skeleton-body">
                <div className="skeleton" style={{ width: '60%', height: 14 }} />
                <div className="skeleton" style={{ width: '85%', height: 12 }} />
                <div className="skeleton" style={{ width: '70%', height: 12 }} />
                <div className="skeleton" style={{ width: '50%', height: 12 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <p className="state error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          Couldn't load demo products: {state.error}
        </p>
      )}

      {state.status === 'done' && state.products.length === 0 && (
        <p className="state">
          No demo products yet — run <code>backend/demo/gen_demo.py</code> to generate them.
        </p>
      )}

      {state.status === 'done' && state.products.length > 0 && (
        <div className="demo-grid">
          {state.products.map((p) => (
            <div className="demo-card" key={p.id}>
              <img src={httpUrl(p.image)} alt={p.name || p.id} />
              <ResultPanel result={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
