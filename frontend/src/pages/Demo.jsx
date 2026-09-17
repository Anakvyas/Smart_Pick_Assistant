import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ResultPanel from '../components/ResultPanel'
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

      {state.status === 'loading' && <p className="state">loading demo products…</p>}
      {state.status === 'error' && <p className="state error">Couldn't load demo products: {state.error}</p>}
      {state.status === 'done' && state.products.length === 0 && (
        <p className="state">
          No demo products yet — run <code>backend/demo/gen_demo.py</code> to generate them.
        </p>
      )}

      <div className="demo-grid">
        {state.products.map((p) => (
          <div className="demo-card" key={p.id}>
            <img src={httpUrl(p.image)} alt={p.name || p.id} />
            <ResultPanel result={p} />
          </div>
        ))}
      </div>
    </div>
  )
}
