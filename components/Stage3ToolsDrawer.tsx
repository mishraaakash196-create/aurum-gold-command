'use client'

import NepaliDate from 'nepali-date-converter'
import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, Calculator, ChartNoAxesCombined, RefreshCw, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { calculateBuySell } from '@/engine/buySellCalculator'
import type { MarketSnapshot, OfficialRateHistoryRecord } from '@/lib/types'

type Language = 'en' | 'ne'
type Tab = 'calculator' | 'history'
const tr = (language: Language, en: string, ne: string) => language === 'ne' ? ne : en
function npDigits(value: string, language: Language) { return language === 'ne' ? value.replace(/[0-9]/g, (digit) => '०१२३४५६७८९'[Number(digit)]) : value }
function money(value: number | null | undefined, language: Language) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `रु ${npDigits(Math.round(value).toLocaleString('en-IN'), language)}`
}
function bsLabel(date: string, language: Language) {
  try {
    const adDate = new Date(`${date}T12:00:00+05:45`)
    const label = new NepaliDate(adDate).format('DD MMM YYYY', language === 'ne' ? 'np' : 'en')
    return npDigits(label, language)
  } catch { return npDigits(date, language) }
}

export default function Stage3ToolsDrawer({ open, onClose, market, alertThreshold, language = 'en' }: { open: boolean; onClose: () => void; market: MarketSnapshot | null; alertThreshold: number; language?: Language }) {
  const [tab, setTab] = useState<Tab>('calculator')
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [weight, setWeight] = useState('1')
  const [unit, setUnit] = useState<'tola' | 'gram'>('tola')
  const [karat, setKarat] = useState<'24k' | 'tejabi'>('24k')
  const [makingPct, setMakingPct] = useState('5')
  const [wastagePct, setWastagePct] = useState('2')
  const [period, setPeriod] = useState<7 | 30 | 365>(30)
  const [records, setRecords] = useState<OfficialRateHistoryRecord[]>([])
  const [totalStored, setTotalStored] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = async () => {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/official-rates?days=${period}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? 'Official-rate history is unavailable.')
      setRecords(Array.isArray(payload.records) ? payload.records : [])
      setTotalStored(Number(payload.totalStored) || 0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Official-rate history is unavailable.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open && tab === 'history') void fetchHistory() }, [open, tab, period])

  const calculation = useMemo(() => calculateBuySell({
    mode, weight: Number(weight), unit, karat,
    rate24kPerTolaNpr: market?.nepal.rate24kTola ?? null,
    rateTejabiPerTolaNpr: market?.nepal.rateTejabiOfficial ? market.nepal.rateTejabiTola : null,
    learnedTejabiRatio: market?.nepal.tejabiRatioState?.ratio ?? null,
    makingPct: Number(makingPct), wastagePct: Number(wastagePct),
  }), [mode, weight, unit, karat, market, makingPct, wastagePct])

  const chartRows = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.map((item, index) => {
      const previous = sorted[index - 1]
      const delta = previous ? item.rate24kTolaNpr - previous.rate24kTolaNpr : 0
      return { ...item, label: bsLabel(item.date, language), adLabel: npDigits(item.date, language), alert: Math.abs(delta) >= alertThreshold, delta }
    })
  }, [records, language, alertThreshold])
  const selectedOfficialTejabi = market?.nepal.rateTejabiManualEntry ? 'Manual entry · FENEGOSIDA transcription' : market?.nepal.rateTejabiOfficial ? 'Separate FENEGOSIDA quote' : 'No separate Tejabi fixing available'

  if (!open) return null
  return <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="accuracy-drawer stage3-drawer" role="dialog" aria-modal="true" aria-labelledby="stage3-tools-title">
      <div className="drawer-heading"><div><span className="drawer-kicker"><Calculator size={13} /> {tr(language, 'NEPAL MARKET TOOLS', 'नेपाल बजार उपकरण')}</span><h2 id="stage3-tools-title">{tr(language, 'Calculator & official history', 'क्याल्कुलेटर र आधिकारिक इतिहास')}</h2><p>{tr(language, 'Jewellery-cost scenarios and observed FENEGOSIDA fixing history; no forecast values are plotted as actuals.', 'गहनाको लागत परिदृश्य र फेनेगोसीडाका देखिएका दर मात्र; पूर्वानुमानलाई वास्तविक दरका रूपमा चार्टमा राखिँदैन।')}</p></div><button type="button" className="drawer-close" onClick={onClose} aria-label="Close tools"><X size={18} /></button></div>
      <div className="drawer-content">
        <div className="stage3-tabs" role="tablist" aria-label="Market tools"><button type="button" role="tab" aria-selected={tab === 'calculator'} className={tab === 'calculator' ? 'selected' : ''} onClick={() => setTab('calculator')}><Calculator size={14} />{tr(language, 'Buy / sell calculator', 'किनबेच क्याल्कुलेटर')}</button><button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}><ChartNoAxesCombined size={14} />{tr(language, 'Official rate history', 'आधिकारिक दर इतिहास')}</button></div>
        {tab === 'calculator' ? <>
          <div className="calculator-rate-strip"><span>{tr(language, 'LATEST 24K REFERENCE', 'पछिल्लो २४K सन्दर्भ')}</span><strong>{money(market?.nepal.rate24kTola, language)}<small> / tola</small></strong><small>{market?.nepal.rateSource ?? 'FENEGOSIDA rate unavailable'} · {market?.nepal.rateDate ?? 'no fixing date'}{market?.nepal.rate24kManualEntry ? ' · MANUAL ENTRY' : ''}</small></div>
          <div className="calculator-mode-row"><div className="segmented"><button className={mode === 'buy' ? 'selected' : ''} onClick={() => setMode('buy')}>{tr(language, 'BUY', 'किन्ने')}</button><button className={mode === 'sell' ? 'selected' : ''} onClick={() => setMode('sell')}>{tr(language, 'SELL', 'बेच्ने')}</button></div><div className="segmented"><button className={unit === 'tola' ? 'selected' : ''} onClick={() => setUnit('tola')}>TOLA</button><button className={unit === 'gram' ? 'selected' : ''} onClick={() => setUnit('gram')}>GRAM</button></div></div>
          <div className="calculator-form-grid">
            <label>{tr(language, 'WEIGHT', 'तौल')}<input type="number" min="0.01" max="10000" step="any" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
            <label>{tr(language, 'KARAT / RATE', 'क्यारेट / दर')}<select value={karat} onChange={(event) => setKarat(event.target.value as '24k' | 'tejabi')}><option value="24k">24K Hallmark</option><option value="tejabi">Tejabi</option></select></label>
            <label>{tr(language, 'MAKING CHARGE %', 'ज्याला %')}<input type="number" min="0" max="100" step="0.1" value={makingPct} onChange={(event) => setMakingPct(event.target.value)} /></label>
            <label>{tr(language, 'WASTAGE %', 'जर्ती %')}<input type="number" min="0" max="100" step="0.1" value={wastagePct} onChange={(event) => setWastagePct(event.target.value)} /></label>
          </div>
          <div className="calculator-provenance"><i />{selectedOfficialTejabi}{karat === 'tejabi' && !market?.nepal.rateTejabiOfficial ? ` · learned ratio ${(market?.nepal.tejabiRatioState?.ratio ?? 0) * 100}% estimate` : ''}</div>
          {calculation.valid ? <section className="calculator-result"><div className="calculator-result-heading"><div><span>{mode === 'buy' ? tr(language, 'ESTIMATED BUY TOTAL', 'अनुमानित खरिद जम्मा') : tr(language, 'INDICATIVE SELLBACK', 'सङ्केतात्मक बिक्री मूल्य')}</span><small>{calculation.sourceLabel}</small></div><strong>{money(calculation.totalNpr, language)}</strong></div><div className="calculator-breakdown"><span>{tr(language, 'Gold value', 'सुनको मूल्य')}<b>{money(calculation.goldValueNpr, language)}</b></span><span>{mode === 'buy' ? tr(language, 'Making charge', 'ज्याला') : tr(language, 'Making charge (not returned)', 'ज्याला (फिर्ता हुँदैन)')}<b>{money(calculation.makingNpr, language)}</b></span><span>{mode === 'buy' ? tr(language, 'Wastage', 'जर्ती') : tr(language, 'Wastage deduction', 'जर्ती कटौती')}<b>{mode === 'sell' ? '−' : ''}{money(calculation.wastageNpr, language)}</b></span><span>{tr(language, 'VAT', 'भ्याट')}<b>{money(calculation.vatNpr, language)}</b></span></div></section> : <div className="drawer-error"><AlertCircle size={15} />{calculation.error}</div>}
          <p className="calculator-caveat">{mode === 'buy' ? tr(language, 'Buy estimate applies user-entered making and wastage percentages, then 13% VAT to the subtotal. VAT and charges are configurable assumptions; not tax advice or a jeweller quote.', 'खरिद अनुमानमा राखिएको ज्याला र जर्तीपछि उप-जम्मामा १३% भ्याट लाग्छ। यी अनुमान मात्र हुन्; कर सल्लाह वा सुनचाँदी व्यवसायीको कोटेसन होइन।') : tr(language, 'Indicative resale subtracts user-entered wastage only; it excludes original making charges and VAT and does not model dealer buyback spreads. Verify with the jeweller.', 'बिक्री अनुमानबाट प्रयोगकर्ताले राखेको जर्ती मात्र घटाइन्छ; मूल ज्याला र भ्याट समावेश छैन र व्यापारीको खरिद-बिक्री अन्तर पनि छैन। सुनचाँदी व्यवसायीसँग पुष्टि गर्नुहोस्।')}</p>
        </> : <>
          <div className="history-toolbar"><div><span>{tr(language, 'STORED OFFICIAL OBSERVATIONS', 'सुरक्षित आधिकारिक अवलोकन')}</span><small>{tr(language, 'Automatic FENEGOSIDA points plus dated manual entries; automatic feed wins on duplicate dates.', 'स्वचालित फेनेगोसीडा दर र मिति सहितका म्यानुअल प्रविष्टि; एउटै मितिमा स्वचालित दर प्राथमिक।')}</small></div><button className="icon-button" type="button" onClick={() => void fetchHistory()} title="Retry history"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
          <div className="history-periods">{([7, 30, 365] as const).map((days) => <button key={days} className={period === days ? 'selected' : ''} onClick={() => setPeriod(days)}>{days === 365 ? '1Y' : `${days}D`}</button>)}</div>
          {error && <div className="drawer-error"><AlertCircle size={15} />{error}</div>}
          {loading ? <div className="drawer-state">{tr(language, 'Loading stored official rates…', 'सुरक्षित आधिकारिक दर लोड हुँदै…')}</div> : chartRows.length ? <section className="official-history-chart"><div className="official-history-summary"><b>{npDigits(String(chartRows.length), language)} {tr(language, 'observations', 'अवलोकन')}</b><span>{tr(language, 'Stored series coverage', 'सुरक्षित श्रृंखला अवधि')}: {bsLabel(chartRows[0].date, language)} — {bsLabel(chartRows.at(-1)!.date, language)}</span><small>{tr(language, 'Total stored', 'कुल सुरक्षित')}: {npDigits(String(totalStored), language)}</small></div><div className="official-chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{ top: 18, right: 24, bottom: 6, left: 8 }}>
            <CartesianGrid stroke="rgba(217,180,94,.12)" strokeDasharray="3 5" /><XAxis dataKey="label" tick={{ fill: '#82908f', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#293136' }} minTickGap={25} /><YAxis tick={{ fill: '#82908f', fontSize: 10 }} tickLine={false} axisLine={false} width={70} domain={['auto', 'auto']} tickFormatter={(value) => npDigits(`${Math.round(Number(value) / 1000)}k`, language)} />
            <Tooltip contentStyle={{ background: '#10151a', border: '1px solid rgba(217,180,94,.28)', borderRadius: 8, color: '#e8e8e4', fontSize: 11 }} labelStyle={{ color: '#d8b363' }} formatter={(value: number, _name: string, item: any) => [money(value, language), item.payload.provenance === 'manual entry' ? tr(language, 'Manual transcription', 'म्यानुअल प्रतिलिपि') : tr(language, 'Automatic official feed', 'स्वचालित आधिकारिक फिड')]} labelFormatter={(_label, payload) => payload?.[0]?.payload ? `${payload[0].payload.adLabel} AD · ${payload[0].payload.label} BS` : _label} />
            <Line type="monotone" dataKey="rate24kTolaNpr" name="Official 24K / tola" stroke="#d6b166" strokeWidth={2.2} dot={(props: any) => props.payload?.provenance === 'manual entry' ? <circle cx={props.cx} cy={props.cy} r={3.5} fill="#6b9ef1" stroke="#10151a" strokeWidth={1.5} /> : <circle cx={props.cx} cy={props.cy} r={1.5} fill="#d6b166" stroke="none" />} activeDot={{ r: 4 }} isAnimationActive={false} />
            {chartRows.filter((item) => item.alert).map((item) => <ReferenceDot key={`alert-${item.date}`} x={item.label} y={item.rate24kTolaNpr} r={5} fill="#ef7180" stroke="#fff" strokeWidth={1} label={{ value: '!', position: 'top', fill: '#ef7180', fontSize: 11 }} />)}
          </LineChart></ResponsiveContainer></div><div className="history-chart-legend"><span><i className="official-dot" />{tr(language, 'Automatic official point', 'स्वचालित आधिकारिक दर')}</span><span><i className="manual-dot" />{tr(language, 'Manual entry', 'म्यानुअल प्रविष्टि')}</span><span><i className="alert-dot" />{tr(language, 'Existing alarm threshold', 'मौजुदा अलार्म सीमा')} · ±{npDigits(alertThreshold.toLocaleString('en-IN'), language)} NPR</span></div></section> : <div className="drawer-empty"><Activity size={18} />{tr(language, 'No official-rate observations are stored for this window yet. History is never backfilled with generated prices.', 'यो अवधिका लागि आधिकारिक दर सुरक्षित छैन। इतिहासमा अनुमानित मूल्य थपिँदैन।')}</div>}
          <p className="calculator-caveat">{tr(language, 'Chart contains persisted source-reported FENEGOSIDA history and manual transcriptions only. Markers flag stored consecutive fixing changes at or above the current alarm threshold; they do not imply a trade signal.', 'चार्टमा सुरक्षित फेनेगोसीडा स्रोत दर र म्यानुअल प्रतिलिपि मात्र छन्। हालको अलार्म सीमाभन्दा बढी लगातार दर परिवर्तनमा चिन्ह देखिन्छ; यो कारोबार सङ्केत होइन।')}</p>
        </>}
      </div>
    </aside>
  </div>
}
