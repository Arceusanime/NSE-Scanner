import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, streamUrl } from '../src/api'
import type { ScannerFilters } from '../src/types'

const filters: ScannerFilters = {
  date: '2026-09-28', bucket: 5, topLevels: 3, sector: 'Banking', query: 'HDFC',
  sort: 'hvtpVolume', order: 'asc', direction: 'above', minVolume: 1000,
  limit: '10', liquidityThreshold: 100000,
}

afterEach(() => vi.unstubAllGlobals())

describe('API request contracts', () => {
  it('only sends supported profile parameters and encodes symbols', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await api.profile('M&M', filters)
    const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/api/volume-profile/M%26M')
    expect(Object.fromEntries(url.searchParams)).toEqual({ date: filters.date, bucket: '5', topLevels: '3' })
  })

  it('preserves scanner filters on the simulated live stream', () => {
    const url = new URL(streamUrl('HDFCBANK', filters), 'http://localhost')
    expect(url.pathname).toBe('/api/live/stream')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      date: filters.date, bucket: '5', topLevels: '3', sector: 'Banking', query: 'HDFC',
      sort: 'hvtpVolume', order: 'asc', direction: 'above', minVolume: '1000',
      limit: '10', liquidityThreshold: '100000', symbol: 'HDFCBANK',
    })
  })

  it('surfaces backend error messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Unknown stock symbol' }) }))
    await expect(api.profile('UNKNOWN', filters)).rejects.toThrow('Unknown stock symbol')
  })
})
