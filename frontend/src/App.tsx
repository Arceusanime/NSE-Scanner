import { useEffect, useState } from 'react'
import { api } from './api'
import { Layout, type AppView } from './components/layout'
import { ErrorState, LoadingState } from './components/ui'
import { useFetch, useHistory, useMonitor, useProfile, useScanner, useSimulatedLive, useStocks } from './hooks/useMarketData'
import { Dashboard } from './pages/Dashboard'
import { Profile } from './pages/Profile'
import { Scanner } from './pages/Scanner'
import { Settings, Stocks } from './pages/Stocks'
import { History, Monitor } from './pages/Monitor'
import type { Health } from './types'
import type { ScannerFilters } from './types'
import './styles.css'
import './theme.css'

function readHash(): { view: AppView; symbol: string } {
  const [view, symbol] = window.location.hash.replace('#/', '').split('/')
  return { view: ['dashboard', 'scanner', 'profile', 'stocks', 'monitor', 'history', 'settings'].includes(view) ? view as AppView : 'dashboard', symbol: symbol || 'RELIANCE' }
}
const initialFilters: ScannerFilters = { date: '', bucket: 0.05, topLevels: 3, sector: 'All sectors', query: '', sort: 'pointGap', order: 'desc', direction: 'all', minVolume: 0, limit: 'all', liquidityThreshold: 100000 }

export default function App() {
  const [location, setLocation] = useState(readHash)
  const { view, symbol } = location
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [filters, setFilters] = useState<ScannerFilters>(initialFilters)
  const health = useFetch((signal) => api.health(signal), 'health')
  const monitor = useMonitor()
  const history = useHistory()
  useEffect(() => { if (health.data?.defaultDate) setFilters((old) => old.date ? old : { ...old, date: health.data!.defaultDate || '' }) }, [health.data])
  useEffect(() => { const listener = () => setLocation(readHash()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  const scanner = useScanner(filters, Boolean(filters.date))
  const stocks = useStocks()
  const profileQuery = useProfile(symbol, filters, view === 'profile' && Boolean(filters.date))
  const live = useSimulatedLive(liveEnabled && Boolean(filters.date), symbol, filters)
  const response = live.data || scanner.data
  const profile = live.data?.profile || profileQuery.data
  const changeFilters = (next: ScannerFilters) => { setFilters({ ...next, date: next.date || health.data?.defaultDate || filters.date }) }
  const navigate = (next: AppView) => { window.location.hash = `/${next}${next === 'profile' ? `/${symbol}` : ''}` }
  const openProfile = (nextSymbol: string) => { window.location.hash = `/profile/${nextSymbol}` }
  const toggleLive = () => {
    if (liveEnabled) { scanner.reload(); profileQuery.reload() }
    setLiveEnabled((value) => !value)
  }
  const liveState = live.state
  const loading = !live.data && scanner.loading
  return <Layout view={view} onNavigate={navigate} live={liveEnabled} liveState={liveState} onToggleLive={toggleLive}>
    {health.error ? <ErrorState message={health.error} retry={health.reload} /> : !filters.date ? <LoadingState label="Connecting to the mock market-data engine" /> : <>
      {liveEnabled && <div className="simulation-notice" role="status">SIMULATED LIVE · Synthetic trades are being appended to the local mock session. Not an NSE feed.{liveState.error && <span>{liveState.error}</span>}</div>}
      {view === 'dashboard' && (scanner.error && !live.data ? <ErrorState message={scanner.error} retry={scanner.reload} /> : <Dashboard response={response} loading={loading} onOpenScanner={() => navigate('scanner')} onSelect={openProfile} />)}
      {view === 'scanner' && <Scanner filters={filters} setFilters={changeFilters} response={response} stocks={stocks.data || []} loading={loading} error={live.data ? null : scanner.error} retry={scanner.reload} onSelect={openProfile} />}
      {view === 'profile' && <Profile profile={profile} loading={!live.data?.profile && profileQuery.loading} error={live.data?.profile ? null : profileQuery.error} retry={profileQuery.reload} live={liveEnabled} liveState={liveState} filters={filters} setFilters={changeFilters} onBack={() => navigate('scanner')} onToggleLive={toggleLive} onSelectAnother={() => navigate('scanner')} />}
      {view === 'stocks' && <Stocks stocks={stocks.data || []} loading={stocks.loading} error={stocks.error} retry={stocks.reload} onSelect={openProfile} />}
      {view === 'monitor' && <Monitor health={health.data as Health | null} monitor={monitor.data} response={response} loading={monitor.loading} error={monitor.error} retry={monitor.reload} />}
      {view === 'history' && <History entries={history.data || []} loading={history.loading} onRefresh={history.reload} />}
      {view === 'settings' && <Settings />}
    </>}
  </Layout>
}
