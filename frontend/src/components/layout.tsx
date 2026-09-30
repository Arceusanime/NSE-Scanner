import { Activity, BarChart3, Bolt, LayoutDashboard, ListFilter, Settings2, SlidersHorizontal, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'
import { DataBadge, LiveBadge } from './ui'

export type AppView = 'dashboard' | 'scanner' | 'profile' | 'stocks' | 'monitor' | 'history' | 'settings'

const nav: { id: AppView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'Scanner', icon: ListFilter },
  { id: 'profile', label: 'Levels & charts', icon: BarChart3 },
  { id: 'stocks', label: 'Instrument universe', icon: Activity },
  { id: 'monitor', label: 'Data monitor', icon: Wifi },
  { id: 'history', label: 'History', icon: Activity },
]

export function Layout({ view, onNavigate, children, live, liveState, onToggleLive }: { view: AppView; onNavigate: (view: AppView) => void; children: ReactNode; live: boolean; liveState?: { connected: boolean }; onToggleLive: () => void }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Bolt size={19} fill="currentColor" /></div><div><strong>flowstate</strong><span>NSE MARKET INTEL</span></div></div>
      <div className="market-status"><span className="status-pulse" />Data source <strong>MOCK</strong><small>Not a live exchange session</small></div>
      <nav className="main-nav" aria-label="Primary navigation">
        <div className="nav-label">WORKSPACE</div>
        {nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} aria-label={label} onClick={() => onNavigate(id)}><Icon size={17} /><span>{label}</span></button>)}
        <div className="nav-label nav-label-spaced">SYSTEM</div>
        <button className={view === 'settings' ? 'active' : ''} aria-label="Settings" onClick={() => onNavigate('settings')}><Settings2 size={17} /><span>Settings</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="connection"><Wifi size={15} /><span>API connection</span><i /></div><small>v0.1.0 · Local terminal</small></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="mobile-brand"><div className="brand-mark"><Bolt size={17} fill="currentColor" /></div><strong>flowstate</strong></div><div className="topbar-right"><DataBadge /><button className={`live-toggle ${live ? 'enabled' : ''}`} onClick={onToggleLive}><span className="toggle-knob" />Simulated live</button><LiveBadge connected={liveState?.connected ?? false} /><button className="icon-button" aria-label="Display settings" onClick={() => onNavigate('settings')}><SlidersHorizontal size={17} /></button></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>
}
