import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Profile } from '../src/pages/Profile'
import type { ScannerFilters, VolumeProfile } from '../src/types'

vi.mock('../src/components/charts', () => ({
  IntradayChart: () => null, ProfileLegend: () => null, VolumeProfileChart: () => null,
  levelShare: () => '50%',
}))

const filters: ScannerFilters = {
  date: '2025-01-15', bucket: 1, topLevels: 3, sector: 'All sectors', query: '',
  sort: 'previousOpen', order: 'asc', direction: 'all', minVolume: 0,
  limit: 'all', liquidityThreshold: 0,
}

const partialProfile: VolumeProfile = {
  symbol: 'PARTIAL', name: 'Partial company', sector: 'Energy', date: filters.date,
  previousSessionDate: '2025-01-14', previousOpen: 100, previousDayOpen: 100,
  aboveLevels: [{ price: 101, volume: 30, tradeCount: 1, volumePercent: 60 }],
  belowLevels: [{ price: 99, volume: 20, tradeCount: 1, volumePercent: 40 }],
  // A V1 summary is allowed to omit legacy HVTP fields and a full `topLevels` array.
  topLevels: undefined, levels: undefined, hvtp: undefined, hvtpVolume: undefined,
  signedGap: 1, pointGap: 1, gapPercent: 1, currentPrice: 101, currentVsHvtp: null,
  totalVolume: 50, tradeCount: 2, bucket: 1, status: 'ok',
  dataMode: 'mock', calculationMode: 'exact', priceSeries: [],
}

describe('V1 frontend runtime contracts', () => {
  it('does not crash when the backend sends side levels without legacy topLevels', () => {
    expect(() => renderToStaticMarkup(<Profile profile={partialProfile} loading={false} error={null}
      retry={() => {}} live={false} liveState={{ connected: false, updatedAt: null, error: null }}
      filters={filters} setFilters={() => {}} onBack={() => {}} onToggleLive={() => {}}
      onSelectAnother={() => {}} />)).not.toThrow()
  })
})
