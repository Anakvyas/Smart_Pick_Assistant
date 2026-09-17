import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Rendered client-side (instead of an image from a public QR API) so the
// local-network URL a phone needs to scan never leaves the device.
export default function QrCode({ value, size = 128, label }) {
  const [dataUrl, setDataUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, { width: size, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => { cancelled = true }
  }, [value, size])

  return (
    <div className="qr-code">
      {dataUrl
        ? <img src={dataUrl} width={size} height={size} alt={label || value} />
        : <div className="qr-code-placeholder" style={{ width: size, height: size }} />}
      {label && <div className="qr-code-label">{label}</div>}
    </div>
  )
}
