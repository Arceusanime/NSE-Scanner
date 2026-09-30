import type { Health, HistoryEntry, MonitorResponse, ScannerFilters, ScannerResponse, Stock, VolumeProfile } from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string | { message?: string } }
    throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}
function scannerParams(filters: ScannerFilters) {
  const params = new URLSearchParams({ date: filters.date, bucket: String(filters.bucket), topLevels: String(filters.topLevels), sort: filters.sort, order: filters.order, direction: filters.direction, minVolume: String(filters.minVolume), limit: filters.limit, liquidityThreshold: String(filters.liquidityThreshold) })
  if (filters.sector !== 'All sectors') params.set('sector', filters.sector)
  if (filters.query) params.set('query', filters.query)
  return params
}
export const api = {
  base: API_BASE,
  health(signal?: AbortSignal) { return request<Health>('/health', signal) },
  stocks(signal?: AbortSignal) { return request<{ stocks: Stock[] }>('/stocks', signal).then((payload) => payload.stocks) },
  scanner(filters: ScannerFilters, signal?: AbortSignal) { return request<ScannerResponse>(`/scanner?${scannerParams(filters)}`, signal) },
  profile(symbol: string, filters: ScannerFilters, signal?: AbortSignal) {
    return request<VolumeProfile>(`/volume-profile/${encodeURIComponent(symbol)}?date=${encodeURIComponent(filters.date)}&bucket=${filters.bucket}&topLevels=${filters.topLevels}`, signal)
  },
  /** Optional endpoints are used when a provider exposes collection/history metadata. */
  monitor(signal?: AbortSignal) { return request<MonitorResponse>('/monitor', signal) },
  history(signal?: AbortSignal) { return request<HistoryEntry[] | { history?: HistoryEntry[]; entries?: HistoryEntry[] }>('/history', signal).then((payload) => Array.isArray(payload) ? payload : payload.history || payload.entries || []) },
  async tryMonitor(signal?: AbortSignal) { try { return await this.monitor(signal) } catch { return null } },
  async tryHistory(signal?: AbortSignal) { try { return await this.history(signal) } catch { return [] } },
}
export function streamUrl(symbol: string, filters: ScannerFilters) {
  const params = scannerParams(filters)
  params.set('symbol', symbol)
  return `${API_BASE}/live/stream?${params}`
}
