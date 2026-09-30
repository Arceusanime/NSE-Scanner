import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PricePoint, VolumeLevel, VolumeProfile } from '../types'
import { compactNumber, formatNumber, formatPrice } from './ui'

function chartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{typeof label === 'number' ? formatPrice(label) : label}</strong>{payload.map((entry, index) => <span key={`${entry.name || 'value'}-${index}`}><i />{entry.name}: {entry.name === 'volume' ? compactNumber(entry.value) : formatPrice(entry.value)}</span>)}</div>
}

export function VolumeProfileChart({ profile }: { profile: VolumeProfile }) {
  const levels = [...(profile.levels || profile.topLevels || [...(profile.aboveLevels || []), ...(profile.belowLevels || [])])].sort((a, b) => a.price - b.price)
  const max = Math.max(...levels.map((level) => level.volume), 1)
  const previousOpen = profile.previousOpen ?? undefined
  return <div className="volume-profile-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={levels} layout="vertical" margin={{ top: 8, right: 22, bottom: 8, left: 8 }} barCategoryGap="18%"><CartesianGrid horizontal={false} stroke="#202838" /><XAxis type="number" hide domain={[0, max * 1.1]} /><YAxis type="category" dataKey="price" orientation="right" width={66} tickFormatter={(value) => formatPrice(Number(value))} tick={{ fill: '#8a96aa', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: '#1b2433' }} content={chartTooltip} /><Bar dataKey="volume" radius={[2, 3, 3, 2]}>{levels.map((level) => <Cell key={level.price} fill={level.price === previousOpen ? '#6c86f5' : level.side === 'ABOVE' ? '#3d8f70' : level.side === 'BELOW' ? '#a45058' : '#37517c'} fillOpacity={level.price === previousOpen ? 1 : 0.78} />)}</Bar>{previousOpen !== undefined && <ReferenceLine y={previousOpen} stroke="#6c86f5" strokeDasharray="4 4" label={{ value: 'PREV OPEN', fill: '#829afc', fontSize: 9, position: 'insideTopLeft' }} />}</BarChart></ResponsiveContainer></div>
}

export function IntradayChart({ series = [], profile, showOpen = true, showAbove = true, showBelow = true, showCurrent = true }: { series?: PricePoint[]; profile: VolumeProfile; showOpen?: boolean; showAbove?: boolean; showBelow?: boolean; showCurrent?: boolean }) {
  if (!series.length) return <div className="chart-empty"><span>Intraday series unavailable</span><small>Connect an exact trade feed to view price overlays.</small></div>
  const values = series.map((point) => point.price)
  const levelValues = [...(profile.aboveLevels || []), ...(profile.belowLevels || [])].map((level) => level.price)
  const min = Math.min(...values, ...levelValues)
  const max = Math.max(...values, ...levelValues)
  const open = profile.previousDayOpen ?? profile.previousOpen
  return <div className="intraday-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 18, right: 14, bottom: 0, left: 0 }}><CartesianGrid stroke="#202838" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#69758a', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={34} /><YAxis domain={[min - (max - min) * 0.15, max + (max - min) * 0.15 || max + 1]} tickFormatter={(value) => `₹${Number(value).toFixed(0)}`} tick={{ fill: '#69758a', fontSize: 10 }} axisLine={false} tickLine={false} width={45} /><Tooltip content={chartTooltip} /><Line dataKey="price" name="current price" type="monotone" stroke="#8da3ff" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#e8b863', stroke: '#080b12', strokeWidth: 2 }} />{showOpen && open !== null && open !== undefined && <ReferenceLine y={open} stroke="#6c86f5" strokeDasharray="5 5" label={{ value: 'Previous open', fill: '#829afc', fontSize: 10, position: 'insideTopRight' }} />}{showAbove && (profile.aboveLevels || []).map((level) => <ReferenceLine key={`above-${level.price}`} y={level.price} stroke="#5dce9b" strokeDasharray="3 3" label={{ value: `A${level.rank ?? ''} ${formatPrice(level.price)}`, fill: '#5dce9b', fontSize: 9, position: 'insideTopLeft' }} />)}{showBelow && (profile.belowLevels || []).map((level) => <ReferenceLine key={`below-${level.price}`} y={level.price} stroke="#ef777e" strokeDasharray="3 3" label={{ value: `B${level.rank ?? ''} ${formatPrice(level.price)}`, fill: '#ef777e', fontSize: 9, position: 'insideBottomLeft' }} />)}{showCurrent && profile.currentPrice !== null && profile.currentPrice !== undefined && <ReferenceLine y={profile.currentPrice} stroke="#e8b863" label={{ value: `Current ${formatPrice(profile.currentPrice)}`, fill: '#e8b863', fontSize: 9, position: 'insideTopRight' }} />}</LineChart></ResponsiveContainer></div>
}

export function MiniSparkline({ series = [] }: { series?: PricePoint[] }) {
  if (series.length < 2) return <span className="spark-placeholder" />
  return <div className="mini-spark"><ResponsiveContainer width="100%" height="100%"><LineChart data={series}><Line dataKey="price" stroke="#8298ff" strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer></div>
}

export function ProfileLegend() {
  return <div className="profile-legend"><span><i className="legend-bar" />Executed quantity by price</span><span><i className="legend-prev" />Previous open</span><span><i className="legend-above" />Above levels</span><span><i className="legend-below" />Below levels</span></div>
}

export function levelShare(level: VolumeLevel, total: number) { return total ? `${((level.volume / total) * 100).toFixed(1)}%` : '—' }
