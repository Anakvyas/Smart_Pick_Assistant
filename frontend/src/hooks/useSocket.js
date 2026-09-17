import { useEffect, useRef, useState } from 'react'
import { wsUrl } from '../config'

/**
 * A WebSocket connection that reconnects on its own after a drop, and
 * reports connection state so pages can show "connecting…" / "live" text
 * without each page re-implementing the retry loop.
 */
export function useSocket(path, onMessage) {
  const [status, setStatus] = useState('connecting')
  const wsRef = useRef(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  useEffect(() => {
    let cancelled = false
    let retryTimer = null
    let ws = null

    const connect = () => {
      if (cancelled) return
      ws = new WebSocket(wsUrl(path))
      wsRef.current = ws

      ws.onopen = () => setStatus('open')
      ws.onclose = () => {
        setStatus('reconnecting')
        retryTimer = setTimeout(connect, 1000)
      }
      ws.onerror = () => {
        try { ws.close() } catch { /* already closing */ }
      }
      ws.onmessage = (ev) => onMessageRef.current?.(ev.data)
    }

    connect()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [path])

  const send = (data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
      return true
    }
    return false
  }

  return { status, send }
}
