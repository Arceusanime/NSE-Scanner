import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Profile } from '../src/pages/Profile'
import type { ScannerFilters, VolumeProfile } from '../src/types'

vi.mock('../src/components/charts', () => ({
  IntradayChart: () => null, ProfileLegend: () => null, VolumeProfileChart: () => null,
  levelShare: () => '50%',
}))

const filters: ScannerFilters = {
  date: '2026-09-28', bucket: 1, topLevels: 1, sector: 'All sectors', query: '',
  sort: 'pointGap', order: 'desc', direction: 'all', minVolume: 0,
  limit: 'all', liquidityThreshold: 100000,
}
const lower = { price: 100, volume: 50, tradeCount: 1, volumePercent: 50 }
const higher = { price: 110, volume: 50, tradeCount: 1, volumePercent: 50 }
const profile: VolumeProfile = {
  symbol: 'TEST', name: 'Test company', sector: 'Test', date: filters.date,
  previousSessionDate: '2026-09-25', previousDayOpen: 109, previousOpen: 109,
  hvtp: 110, hvtpVolume: 50, hvtpLevels: [110, 100], signedGap: 1, pointGap: 1,
  gapPercent: 0.92, currentPrice: 110, currentVsHvtp: 0, totalVolume: 100,
  tradeCount: 2, bucket: 1, status: 'ok', topLevels: [higher], levels: [lower, higher],
  dataMode: 'mock', calculationMode: 'exact', priceSeries: [],
}

function markup(data = profile) {
  const noop = () => {}
  return renderToStaticMarkup(<Profile profile={data} loading={false} error={null} retry={noop}
    live={false} liveState={{ connected: false, updatedAt: null, error: null }}
    filters={filters} setFilters={noop} onBack={noop} onToggleLive={noop} onSelectAnother={noop} />)
}

describe('Profile presentation', () => {
  it('uses the selected backend top levels, including backend tie order', () => {
    const html = markup()
    expect(html.match(/class="level-row"/g)).toHaveLength(1)
    expect(html).toContain('Top 1 levels, ranked by the backend.')
    expect(html).toContain('₹110.00')
    expect(html).not.toContain('₹100.00')
  })

  it('uses the backend signed gap rather than recomputing it in the UI', () => {
    const html = markup({ ...profile, signedGap: null, pointGap: null })
    expect(html).toContain('Signed gap —')
    expect(html).not.toContain('Signed gap +1')
  })
})
