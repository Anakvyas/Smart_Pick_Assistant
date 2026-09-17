import { useState } from 'react'
import { fieldRows } from '../lib/productFields'
import './ResultPanel.css'

/**
 * The single place a scan/upload result gets turned into UI — a structured
 * "spec sheet" of every field the backend found, the decoded barcodes as
 * chips, and (collapsed by default) the exact JSON the backend returned, so
 * a developer or a curious user can see precisely what came back without
 * the app hiding anything behind the pretty view.
 */
export default function ResultPanel({ result, placeholder }) {
  const [showRaw, setShowRaw] = useState(false)

  if (!result) {
    return placeholder ? <div className="result-panel result-panel-empty">{placeholder}</div> : null
  }

  const rows = fieldRows(result)
  const codes = result.codes || []
  // Drop `image` (a huge base64 JPEG) before pretty-printing — useless
  // noise in a "raw JSON" debug view.
  const jsonSafe = { ...result }
  delete jsonSafe.image

  return (
    <div className="result-panel">
      {codes.length > 0 && (
        <div className="result-codes">
          {codes.map((c, i) => (
            <span key={i} className="code-chip">{c.kind} · {c.value}</span>
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="result-fields">
          {rows.map(([key, label, value]) => (
            <div className="result-row" key={key}>
              <span className="result-key">{label}</span>
              <span className="result-value">{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="result-empty-msg">
          {result.message || (result.valid ? 'no label fields recognised' : 'nothing detected')}
        </p>
      )}

      <button type="button" className="raw-toggle" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? '▾ hide raw JSON' : '▸ view raw JSON'}
      </button>
      {showRaw && <pre className="raw-json">{JSON.stringify(jsonSafe, null, 2)}</pre>}
    </div>
  )
}
