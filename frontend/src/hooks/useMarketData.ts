import { useCallback, useEffect, useRef, useState } from 'react'
import { api, streamUrl } from '../api'
import type { HistoryEntry, LiveState, LiveUpdate, MonitorResponse, ScannerFilters, ScannerResponse, Stock, VolumeProfile } from '../types'

/** Aborts old requests and ignores late responses when filters or screens change. */
export function useFetch<T>(loader: (signal: AbortSignal) => Promise<T>, key: string, enabled = true) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; data: T | null; loading: boolean; error: string | null }>({ key, data: null, loading: enabled, error: null })
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setResult({ key, data: null, loading: true, error: null })
    loaderRef.current(controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data, loading: false, error: null })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setResult({ key, data: null, loading: false, error: reason instanceof Error ? reason.message : 'Unable to load data' })
    })
    return () => controller.abort()
  }, [key, revision, enabled])
  return { data: result.key === key ? result.data : null, loading: enabled && (result.key !== key || result.loading), error: result.key === key ? result.error : null, reload }
}

export function useStocks() { return useFetch<Stock[]>((signal) => api.stocks(signal), 'stocks') }
export function useMonitor() { return useFetch<MonitorResponse | null>((signal) => api.tryMonitor(signal), 'monitor') }
export function useHistory() { return useFetch<HistoryEntry[]>((signal) => api.tryHistory(signal), 'history') }
export function useScanner(filters: ScannerFilters, enabled = true) {
  return useFetch<ScannerResponse>((signal) => api.scanner(filters, signal), JSON.stringify(filters), enabled)
}
export function useProfile(symbol: string, filters: ScannerFilters, enabled: boolean) {
  return useFetch<VolumeProfile>((signal) => api.profile(symbol, filters, signal), `${symbol}:${filters.date}:${filters.bucket}:${filters.topLevels}`, enabled)
}

/** EventSource automatically reconnects; it never reports a connection before data arrives. */
export function useSimulatedLive(enabled: boolean, symbol: string, filters: ScannerFilters) {
  const [state, setState] = useState<LiveState>({ connected: false, updatedAt: null, error: null })
  const [packet, setPacket] = useState<{ key: string; payload: LiveUpdate } | null>(null)
  const key = `${symbol}:${JSON.stringify(filters)}`
  useEffect(() => {
    if (!enabled) { setState({ connected: false, updatedAt: null, error: null }); setPacket(null); return }
    let disposed = false
    setPacket(null)
    setState({ connected: false, updatedAt: null, error: null })
    const source = new EventSource(streamUrl(symbol, filters))
    const receive = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as LiveUpdate
        if (disposed || !Array.isArray(payload.rows)) return
        setPacket({ key, payload })
        setState({ connected: true, updatedAt: new Date(), error: null })
      } catch { /* Non-data heartbeat events do not alter the last valid snapshot. */ }
    }
    source.addEventListener('update', receive as EventListener)
    source.onerror = () => { if (!disposed) setState((old) => ({ ...old, connected: false, error: 'Simulation disconnected — reconnecting…' })) }
    return () => { disposed = true; source.close() }
  }, [enabled, key])
  return { state, data: enabled && packet?.key === key ? packet.payload : null }
}
