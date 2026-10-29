'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AccuracyMetric, AccuracyReport, ProbabilisticInstrumentForecast } from '@/lib/types'

const instruments: Array<{ key: ProbabilisticInstrumentForecast['instrument']; label: string }> = [
  { key: 'xau-usd', label: 'XAU / USD' },
  { key: 'nepal-24k', label: 'Nepal 24K / tola' },
  { key: 'nepal-22k', label: 'Nepal 22K / tola' },
  { key: 'nepal-tejabi', label: 'Tejabi / tola' },
]

function percent(value: number | null | undefined) { return value == null ? '—' : `${value.toFixed(1)}%` }
function metricName(metric: AccuracyMetric) { return instruments.find((item) => item.key === metric.instrument)?.label ?? metric.instrument }
function money(value: number | null, instrument: string) {
  if (value === null) return '—'
  return instrument === 'xau-usd' ? `$${value.toFixed(2)}` : `Rs ${Math.round(value).toLocaleString('en-IN')}`
}
function npt(value: string | null | undefined) {
  if (!value) return 'unavailable'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', dateStyle: 'medium', timeStyle: 'medium' }).format(date) + ' NPT' : value
}

export default function AccuracyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [report, setReport] = useState<AccuracyReport | null>(null)
  const [backtest, setBacktest] = useState<{ backtest: AccuracyMetric[]; source: string; note: string } | null>(null)
  const [instrument, setInstrument] = useState<ProbabilisticInstrumentForecast['instrument']>('xau-usd')
  const [baselineInstrument, setBaselineInstrument] = useState<'xau-usd' | 'nepal-24k'>('xau-usd')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/api/accuracy', { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('Prediction history is unavailable.'); return response.json() as Promise<AccuracyReport> }),
      fetch('/api/accuracy/backtest', { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('OHLCV backtest is unavailable.'); return response.json() }),
    ]).then(([accuracy, replay]) => {
      if (!alive) return
      setReport(accuracy)
      setBacktest(replay)
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Unable to load accuracy data.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open])

  const chartData = useMemo(() => (report?.series ?? [])
    .filter((item) => item.instrument === instrument)
    .map((item) => ({ ...item, dateLabel: item.targetDate })), [instrument, report])
  const metrics = (days: 7 | 30 | 90) => report?.metrics.find((item) => item.days === days && item.instrument === instrument)
  const selectedLabel = instruments.find((item) => item.key === instrument)?.label ?? instrument
  const comparison = report?.baselines?.[baselineInstrument]
  const calibration = report?.calibrations?.[instrument]
  const calibrationChart = calibration?.buckets.map((bucket) => ({ ...bucket, meanForecastPct: bucket.meanForecastPct ?? null, actualUpRatePct: bucket.actualUpRatePct ?? null })) ?? []

  if (!open) return null
  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="accuracy-drawer" role="dialog" aria-modal="true" aria-labelledby="accuracy-title">
        <div className="drawer-heading">
          <div><span className="drawer-kicker"><Activity size={13} /> MODEL VALIDATION</span><h2 id="accuracy-title">Prediction accuracy</h2><p>One forecast per fixing date, graded only against later observed outcomes.</p></div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close accuracy panel"><X size={18} /></button>
        </div>
        <div className="drawer-content">
          {loading && <div className="drawer-state">Loading persisted forecasts and OHLCV replay…</div>}
          {error && <div className="drawer-error"><AlertCircle size={16} />{error}</div>}
          <div className="accuracy-toolbar">
            <label>CHART INSTRUMENT<select value={instrument} onChange={(event) => setInstrument(event.target.value as typeof instrument)}>{instruments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <span className="accuracy-total">{report?.totalLogged ?? 0} forecast logs · window-aligned outcomes deduplicated by fixing date</span>
          </div>

          <section className="baseline-panel">
            <div className="drawer-section-head"><div><span>NAIVE BASELINE</span><h3>AURUM vs “tomorrow = today”</h3></div>
              <label className="baseline-select">INSTRUMENT<select value={baselineInstrument} onChange={(event) => setBaselineInstrument(event.target.value as typeof baselineInstrument)}><option value="xau-usd">XAU/USD</option><option value="nepal-24k">Nepal 24K / tola</option></select></label>
            </div>
            <p className="accuracy-method-note">Naive forecast carries the previous fixing-time XAU quote or previous official 24K rate forward unchanged. Direction scoring uses that same reference. Each fixing date counts once; approximate windows remain labelled.</p>
            {!comparison || comparison.status === 'not-enough-data' ? <div className="baseline-not-enough"><b>Not enough data</b><span>{comparison?.totalMatched ?? 0} / 20 matched, date-aligned outcomes for {baselineInstrument === 'xau-usd' ? 'XAU/USD' : 'Nepal 24K'}.</span></div> : <div className="accuracy-metric-grid">
              {comparison.windows.map((window) => <article className="accuracy-metric-card baseline-metric-card" key={window.days}>
                <span>{window.days}D · {window.aurum.observations} MATCHED</span>
                {window.beatsBaseline === true ? <b className="baseline-winner">BEATS BASELINE</b> : window.beatsBaseline === false ? <b className="baseline-loser">DOES NOT BEAT BASELINE</b> : <b className="baseline-no-sample">NO WINDOW SAMPLE</b>}
                <div className="baseline-values"><small>AURUM</small><span>MAE {money(window.aurum.mae, baselineInstrument)} · MAPE {percent(window.aurum.mapePct)} · Dir {percent(window.aurum.directionAccuracyPct)}</span></div>
                <div className="baseline-values"><small>NAIVE</small><span>MAE {money(window.naive.mae, baselineInstrument)} · MAPE {percent(window.naive.mapePct)} · Dir {percent(window.naive.directionAccuracyPct)}</span></div>
              </article>)}
            </div>}
            <p className="accuracy-caveat">“Beats baseline” requires lower MAE and MAPE, and direction accuracy no worse than the naive forecast. Not enough data is reported until 20 matched outcomes exist overall for the selected instrument.</p>
          </section>

          <section className="accuracy-metric-grid" aria-label="Rolling accuracy metrics">
            {([7, 30, 90] as const).map((days) => {
              const metric = metrics(days)
              return <article className="accuracy-metric-card" key={days}>
                <span>{days}D ROLLING · {metric?.observations ?? 0} OUTCOMES</span><b>{percent(metric?.rangeHitRatePct)}</b><small>range hit rate</small>
                <div>MAE {metric ? money(metric.mae, instrument) : '—'} · MAPE {percent(metric?.mapePct)}</div>
                <div>Direction {percent(metric?.directionAccuracyPct)}</div>
              </article>
            })}
          </section>

          <section className="accuracy-chart-panel">
            <div className="drawer-section-head"><div><span>FIXING-TIME FORECAST TRACKER</span><h3>Predicted vs actual · {selectedLabel}</h3></div><small>{chartData.length} deduplicated target dates</small></div>
            <p className="accuracy-method-note">XAU outcome target: approximately 10:45 AM NPT, before the 11:00 AM FENEGOSIDA fixing. Hover a point for the reference and outcome timestamps. “Approximate window” means the source did not provide a quote near the intended time.</p>
            {report?.fixingWindowQuality && <div className="fixing-quality-strip"><b>WINDOW AUDIT</b><span>Exact {report.fixingWindowQuality.exact} · Approximate {report.fixingWindowQuality.approximate} · Unavailable {report.fixingWindowQuality.unavailable} · Awaiting {report.fixingWindowQuality.awaiting}</span><small>{report.fixingWindowQuality.note}</small></div>}
            {chartData.length ? <div className="accuracy-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="rgba(217,180,94,.12)" strokeDasharray="3 5" />
              <XAxis dataKey="dateLabel" tick={{ fill: '#82908f', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#293136' }} minTickGap={25} />
              <YAxis tick={{ fill: '#82908f', fontSize: 10 }} tickLine={false} axisLine={false} width={68} domain={['auto', 'auto']} />
              <Tooltip content={(props) => {
                const row = props.payload?.[0]?.payload as AccuracyReport['series'][number] & { dateLabel?: string } | undefined
                if (!props.active || !row) return null
                const referenceValue = row.referenceValue == null ? '—' : row.instrument === 'xau-usd' ? `$${row.referenceValue.toFixed(2)}` : `Rs ${Math.round(row.referenceValue).toLocaleString('en-IN')}`
                return <div className="accuracy-time-tooltip"><b>{row.instrument} · {row.targetDate}</b><span>Forecast issued: {npt(row.date)}</span>{row.instrument === 'xau-usd' ? <><span>Previous fixing target: {npt(row.windowStartTargetAt)}</span><span>Spot reference used: {referenceValue} · {row.referenceSource ?? 'source unavailable'} · {npt(row.windowStartObservedAt)}</span><span>Target spot time: {npt(row.windowTargetAt)}</span><span>Target spot observation: {npt(row.windowActualObservedAt)}</span></> : <><span>Previous-rate reference: {referenceValue} · {row.referenceSource ?? 'source unavailable'} · fixing date {row.referenceDate ?? 'unavailable'}</span><span>Target fixing nominal time: {npt(row.windowTargetAt)}</span><span>Feed actual timestamp: {row.windowActualObservedAt ? npt(row.windowActualObservedAt) : 'date-only source; exact time unavailable'}</span></>}<span>Window: {row.windowPrecision ?? 'unavailable'} · {row.windowNote ?? 'Timestamp details unavailable.'}</span><span>Range method at issue: {row.rangeMethod ?? 'unavailable'}</span><span>Actual source: {row.source ?? 'unavailable'}</span></div>
              }} />
              <Line type="monotone" dataKey="predicted" name="Predicted base" stroke="#eab308" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="actual" name="Actual source" stroke="#52d5aa" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            </LineChart></ResponsiveContainer></div> : <div className="drawer-empty">No fixing-aligned Stage 4 outcome observations yet. Historical entries without the required as-of snapshot are not relabelled as aligned.</div>}
          </section>

          <section className="accuracy-chart-panel calibration-panel">
            <div className="drawer-section-head"><div><span>PROBABILITY CALIBRATION · {selectedLabel}</span><h3>Stated probability vs observed hit rate</h3></div><span className={`calibration-state ${calibration?.method === 'isotonic' ? 'ready' : 'pending'}`}>{calibration?.method === 'isotonic' ? `ISOTONIC · ${calibration.samples}` : `UNCALIBRATED · ${calibration?.samples ?? 0}/100`}</span></div>
            {calibration?.method === 'isotonic' ? <>
              <p className="accuracy-method-note">Past UP probabilities are grouped into 10-point buckets; the isotonic mapping is fitted only from outcomes available before the current forecast. Ties are omitted from direction calibration.</p>
              <div className="accuracy-chart calibration-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={calibrationChart} margin={{ top: 12, right: 18, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="rgba(217,180,94,.12)" strokeDasharray="3 5" />
                <XAxis dataKey="label" tick={{ fill: '#82908f', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#293136' }} />
                <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: '#82908f', fontSize: 9 }} tickLine={false} axisLine={false} width={45} />
                <Tooltip contentStyle={{ background: '#10151a', border: '1px solid rgba(217,180,94,.28)', borderRadius: 8, color: '#e8e8e4', fontSize: 11 }} />
                <Line type="monotone" dataKey="meanForecastPct" name="Mean stated UP probability" stroke="#eab308" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                <Line type="monotone" dataKey="actualUpRatePct" name="Observed UP hit rate" stroke="#52d5aa" strokeWidth={2} connectNulls dot={{ r: 3 }} />
              </LineChart></ResponsiveContainer></div>
              <div className="calibration-table-wrap"><table><thead><tr><th>STATED UP</th><th>COUNT</th><th>MEAN STATED</th><th>OBSERVED UP</th></tr></thead><tbody>{calibration.buckets.map((bucket) => <tr key={bucket.label}><td>{bucket.label}</td><td>{bucket.observations}</td><td>{percent(bucket.meanForecastPct)}</td><td>{percent(bucket.actualUpRatePct)}</td></tr>)}</tbody></table></div>
            </> : <div className="baseline-not-enough"><b>Uncalibrated</b><span>Calibration begins after 100 matched, non-flat, fixing-aligned outcomes for this instrument. Until then, every displayed direction probability is labelled uncalibrated.</span></div>}
          </section>

          <section className="accuracy-backtest-panel">
            <div className="drawer-section-head"><div><span>HISTORICAL REPLAY</span><h3>OHLCV backtest · XAU/USD</h3></div><span className="technical-only-pill">TECHNICAL ONLY</span></div>
            <p>{backtest?.note ?? 'Replays only real historical candles; no demo prices are substituted.'} {backtest?.source ? `Source: ${backtest.source}.` : ''}</p>
            <div className="backtest-table-wrap"><table><thead><tr><th>Window</th><th>Obs.</th><th>Range hit</th><th>MAE</th><th>MAPE</th><th>Direction</th></tr></thead><tbody>
              {(backtest?.backtest ?? []).map((item) => <tr key={item.days}><td>{item.days}d</td><td>{item.observations}</td><td>{percent(item.rangeHitRatePct)}</td><td>{item.mae == null ? '—' : `$${item.mae.toFixed(2)}`}</td><td>{percent(item.mapePct)}</td><td>{percent(item.directionAccuracyPct)}</td></tr>)}
            </tbody></table></div>
          </section>
          <p className="accuracy-caveat">Historical metrics are descriptive. Error-derived bands and isotonic calibration use prior logged outcomes only, but samples are limited and may be regime-dependent; neither is a guarantee.</p>
        </div>
      </aside>
    </div>
  )
}
