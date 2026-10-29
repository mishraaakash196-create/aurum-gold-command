'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, CandlestickChart, TrendingUp } from 'lucide-react'
import type { MarketSnapshot, QuantForecast, ScenarioForecast } from '@/lib/types'
import { buildLiveChartPoint } from '@/lib/systemAudit'

type Asset = 'global' | 'nepal'
type VisualMode = 'candles' | 'area'

interface MarketChartProps {
  language?: 'en' | 'ne'
  market: MarketSnapshot
  forecast: QuantForecast | null
  scenario: ScenarioForecast | null
}

interface ChartRow {
  date: string
  open?: number
  high?: number
  low?: number
  close?: number
  ema20?: number | null
  ema50?: number | null
  ema200?: number | null
  candleRange?: [number, number] | null
  forecastBand?: [number, number] | null
  forecastBase?: number | null
  actual?: number
  observedAt?: string | null
  kind: 'history' | 'quote' | 'forecast'
}

function nptDateFromTimestamp(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}

function dateAfter(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

function price(value: number | undefined | null, asset: Asset, language: 'en' | 'ne' = 'en'): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—'
  const formatted = asset === 'global'
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${language === 'ne' ? 'रु' : 'Rs'} ${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  return language === 'ne' ? formatted.replace(/[0-9]/g, (digit) => '०१२३४५६७८९'[Number(digit)]) : formatted
}

function tickDate(value: string) {
  if (value === 'LIVE SPOT') return 'LIVE'
  if (value === 'LAST QUOTE') return 'STALE'
  if (value === 'LAST OBSERVATION') return 'LAST'
  if (value === 'OFFICIAL FIXING') return 'FIXING'
  if (value === 'LAST FIXING') return 'LAST FIX'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

function CandleShape(props: any) {
  const { x, y, width, height, payload } = props
  if (!payload || !Number.isFinite(height) || height <= 0) return null
  const high = Number(payload.high)
  const low = Number(payload.low)
  const open = Number(payload.open)
  const close = Number(payload.close)
  if (![high, low, open, close].every(Number.isFinite) || high <= low) return null
  const scale = height / (high - low)
  const toY = (value: number) => y + (high - value) * scale
  const openY = toY(open)
  const closeY = toY(close)
  const bodyY = Math.min(openY, closeY)
  const bodyHeight = Math.max(1.4, Math.abs(closeY - openY))
  const candleWidth = Math.max(3, Math.min(9, width * 0.52))
  const color = close >= open ? '#42c99a' : '#ef7180'
  return (
    <g className="candle-mark">
      <line x1={x + width / 2} x2={x + width / 2} y1={y} y2={y + height} stroke={color} strokeWidth={1.25} />
      <rect
        x={x + (width - candleWidth) / 2}
        y={bodyY}
        width={candleWidth}
        height={bodyHeight}
        rx={1}
        fill={color}
        stroke={color}
        strokeWidth={0.7}
      />
    </g>
  )
}

function ChartTooltip({ active, payload, label, asset, language = 'en' }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as ChartRow | undefined
  if (!row) return null
  const isGlobal = asset === 'global'
  const date = row.kind === 'quote' ? row.date : typeof label === 'string' ? tickDate(label) : ''
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{date}{row.kind === 'forecast' ? ' · projected' : row.kind === 'quote' ? ' · observed quote' : ''}</div>
      {row.kind === 'history' && isGlobal && <>
        <div><span>Open</span><b>{price(row.open, asset, language)}</b></div>
        <div><span>High</span><b>{price(row.high, asset, language)}</b></div>
        <div><span>Low</span><b>{price(row.low, asset, language)}</b></div>
        <div><span>Daily close</span><b>{price(row.close, asset, language)}</b></div>
      </>}
      {row.kind === 'history' && !isGlobal && <div><span>Historical 24K fixing</span><b>{price(row.actual, asset, language)}</b></div>}
      {row.kind === 'quote' && <>
        <div><span>{isGlobal ? 'XAU/USD spot quote' : 'FENEGOSIDA 24K / tola'}</span><b>{price(row.actual, asset, language)}</b></div>
        <div><span>Source timestamp</span><b>{row.observedAt ?? 'Unavailable'}</b></div>
      </>}
      {row.kind === 'forecast' && <>
        <div><span>High · ATR cone</span><b>{price(row.high, asset, language)}</b></div>
        <div><span>Base</span><b>{price(row.forecastBase, asset, language)}</b></div>
        <div><span>Low · ATR cone</span><b>{price(row.low, asset, language)}</b></div>
      </>}
    </div>
  )
}

export default function MarketChart({ market, forecast, scenario, language = 'en' }: MarketChartProps) {
  const [asset, setAsset] = useState<Asset>('global')
  const [mode, setMode] = useState<VisualMode>('candles')
  const [windowDays, setWindowDays] = useState(30)
  const liveNepalForecast = scenario?.nepal
  const globalForecast = scenario?.global ?? forecast
  const canCandle = asset === 'global'

  const chartRows = useMemo((): ChartRow[] => {
    if (asset === 'global') {
      const indicatorByDate = new Map((market.indicators?.series ?? []).map((item) => [item.date, item]))
      const historic = market.candles.slice(-Math.max(windowDays, 30))
      const rows: ChartRow[] = historic.map((candle) => {
        const indicators = indicatorByDate.get(candle.date)
        return {
          date: candle.date,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          ema20: indicators?.ema20,
          ema50: indicators?.ema50,
          ema200: indicators?.ema200,
          actual: candle.close,
          candleRange: [candle.low, candle.high],
          forecastBand: null,
          forecastBase: null,
          kind: 'history',
        }
      })
      const livePoint = buildLiveChartPoint(market.spot, market.spotStale ? 'LAST OBSERVATION' : 'LIVE SPOT')
      if (livePoint) {
        rows.push({
          date: livePoint.date,
          close: livePoint.close,
          actual: livePoint.actual,
          high: livePoint.close,
          low: livePoint.close,
          observedAt: market.spotAsOf,
          candleRange: null,
          forecastBand: null,
          forecastBase: globalForecast ? livePoint.close : null,
          kind: 'quote',
        })
      }
      if (globalForecast && livePoint) {
        const nextSession = dateAfter(nptDateFromTimestamp(market.spotAsOf))
        rows.push({
          date: nextSession,
          open: livePoint.close,
          high: globalForecast.rangeHigh,
          low: globalForecast.rangeLow,
          close: globalForecast.predictedXauUsd,
          actual: undefined,
          candleRange: null,
          forecastBand: [globalForecast.rangeLow, globalForecast.rangeHigh],
          forecastBase: globalForecast.predictedXauUsd,
          kind: 'forecast',
        })
      }
      return rows
    }

    const currentRate = market.nepal.rate24kTola
    const currentRateDate = market.nepal.rateDate
    const localHistory = market.nepal.history
      .filter((point) => point.date !== currentRateDate)
      .slice(-30)
    const rows: ChartRow[] = localHistory.map((point) => ({
      date: point.date,
      actual: point.perTola,
      close: point.perTola,
      high: point.perTola,
      low: point.perTola,
      candleRange: null,
      forecastBand: null,
      forecastBase: null,
      kind: 'history',
    }))
    const livePoint = buildLiveChartPoint(currentRate, market.nepal.rateStale ? 'LAST FIXING' : 'OFFICIAL FIXING')
    if (livePoint) {
      rows.push({
        date: livePoint.date,
        close: livePoint.close,
        actual: livePoint.actual,
        high: livePoint.close,
        low: livePoint.close,
        observedAt: market.nepal.rateAsOf ?? currentRateDate,
        candleRange: null,
        forecastBand: null,
        forecastBase: liveNepalForecast ? livePoint.close : null,
        kind: 'quote',
      })
    }
    if (liveNepalForecast && livePoint) {
      const localAtr = (globalForecast?.atr14Usd ?? 0) * (liveNepalForecast.predicted24kTolaNpr / (market.spot || 1))
      const nextFixing = dateAfter(nptDateFromTimestamp())
      rows.push({
        date: nextFixing,
        actual: undefined,
        open: livePoint.close,
        close: liveNepalForecast.predicted24kTolaNpr,
        high: liveNepalForecast.predicted24kTolaNpr + localAtr,
        low: Math.max(0, liveNepalForecast.predicted24kTolaNpr - localAtr),
        candleRange: null,
        forecastBand: [Math.max(0, liveNepalForecast.predicted24kTolaNpr - localAtr), liveNepalForecast.predicted24kTolaNpr + localAtr],
        forecastBase: liveNepalForecast.predicted24kTolaNpr,
        kind: 'forecast',
      })
    }
    return rows
  }, [asset, globalForecast, liveNepalForecast, market.candles, market.indicators?.series, market.nepal.history, market.nepal.rate24kTola, market.nepal.rateAsOf, market.nepal.rateDate, market.nepal.rateStale, market.spot, market.spotAsOf, market.spotStale, windowDays])

  const selectedQuote = asset === 'global'
    ? market.spot
    : market.nepal.rate24kTola
  const chartHasData = chartRows.length > 0 && chartRows.some((row) => (row.kind === 'history' || row.kind === 'quote') && (asset === 'global' ? row.close : row.actual) !== undefined)

  return (
    <section className="panel chart-panel" id="charts">
      <div className="section-heading chart-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-index">03</span> Price action</div>
          <h2>Market structure <span className="heading-dot">/</span> forecast cone</h2>
          <p>Observed history and the exact current quote are separated from the next-session forecast.</p>
        </div>
        <div className="chart-current">
          <span>{asset === 'global' ? `XAU/USD · ${market.spotStale ? 'LAST OBSERVATION' : 'LIVE SPOT'}` : `FENEGOSIDA · 24K / TOLA · ${market.nepal.rateStale ? 'LAST FIXING' : 'LATEST FIXING'}`}</span>
          <strong>{price(selectedQuote, asset, language)}</strong>
        </div>
      </div>

      <div className="chart-toolbar">
        <div className="segmented asset-switch" role="tablist" aria-label="Chart asset">
          <button className={asset === 'global' ? 'selected' : ''} onClick={() => setAsset('global')} role="tab" aria-selected={asset === 'global'}>
            <Activity size={14} /> XAU / USD
          </button>
          <button className={asset === 'nepal' ? 'selected' : ''} onClick={() => setAsset('nepal')} role="tab" aria-selected={asset === 'nepal'}>
            <span className="rupee-mark">रु</span> NPR / TOLA
          </button>
        </div>
        <div className="chart-tool-right">
          <div className="segmented visual-switch" role="tablist" aria-label="Chart style">
            <button className={mode === 'candles' ? 'selected' : ''} onClick={() => setMode('candles')} disabled={!canCandle} title={!canCandle ? 'Local benchmark feed provides daily fixings, not intraday OHLC candles.' : 'Candlestick chart'}>
              <CandlestickChart size={14} /> Candles
            </button>
            <button className={mode === 'area' ? 'selected' : ''} onClick={() => setMode('area')}>
              <TrendingUp size={14} /> Area
            </button>
          </div>
          <div className="segmented range-switch" aria-label="Chart range">
            {[30, 90, 365].map((days) => (
              <button key={days} className={windowDays === days ? 'selected' : ''} onClick={() => setWindowDays(days)} disabled={asset === 'nepal' && days !== 30}>
                {days === 365 ? '1Y' : `${days}D`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {asset === 'nepal' && <div className="chart-source-note">Daily FENEGOSIDA fixings plus the exact latest 24K/tola quote-card value · candle view is disabled because intraday OHLC is not published.</div>}
      <div className="chart-legend">
        {asset === 'global' ? <>
          <span><i className="legend-dot legend-gold" /> XAU/USD daily OHLC</span>
          <span><i className="legend-dot legend-live-quote" /> {market.spotStale ? 'Last observed quote' : 'Live spot quote'}</span>
          <span><i className="legend-line legend-ema20" /> EMA 20</span>
          <span><i className="legend-line legend-ema50" /> EMA 50</span>
          <span><i className="legend-line legend-ema200" /> EMA 200</span>
          <span><i className="legend-area" /> Tomorrow · 1× ATR</span>
        </> : <>
          <span><i className="legend-line legend-local" /> Daily 24K fixings</span>
          <span><i className="legend-dot legend-live-quote" /> Latest quote-card fixing</span>
          <span><i className="legend-area" /> Tomorrow · translated ATR envelope</span>
        </>}
      </div>

      <div className="chart-canvas">
        {chartHasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 12, right: 10, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="goldAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d9ad57" stopOpacity={0.24} />
                  <stop offset="95%" stopColor="#d9ad57" stopOpacity={0.015} />
                </linearGradient>
                <linearGradient id="forecastConeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#cfa85c" stopOpacity={0.20} />
                  <stop offset="100%" stopColor="#cfa85c" stopOpacity={0.055} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,.105)" strokeDasharray="3 6" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#73808e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickFormatter={tickDate}
                minTickGap={32}
                interval="preserveStartEnd"
                padding={{ left: 8, right: 14 }}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                axisLine={false}
                tickLine={false}
                width={75}
                domain={['dataMin', 'dataMax']}
                tick={{ fill: '#73808e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickFormatter={(value: number) => (asset === 'global'
                  ? `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  : `${(Number(value) / 1000).toFixed(0)}k`).replace(/[0-9]/g, (digit) => language === 'ne' ? '०१२३४५६७८९'[Number(digit)] : digit)}
              />
              <Tooltip content={(props) => <ChartTooltip {...props} asset={asset} language={language} />} cursor={{ stroke: 'rgba(214,177,102,.3)', strokeDasharray: '3 4' }} />
              <Area
                yAxisId="price"
                type="monotone"
                dataKey={(row: ChartRow) => row.forecastBand ?? null}
                stroke="none"
                fill="url(#forecastConeFill)"
                isAnimationActive={false}
                connectNulls
                name="ATR forecast envelope"
              />
              {asset === 'global' && mode === 'area' && <Area
                yAxisId="price"
                type="monotone"
                dataKey="actual"
                stroke="#d6b166"
                strokeWidth={1.8}
                fill="url(#goldAreaFill)"
                isAnimationActive={false}
                connectNulls
                name="XAU/USD"
              />}
              {asset === 'global' && mode === 'candles' && <Bar
                yAxisId="price"
                dataKey={(row: ChartRow) => row.candleRange ?? null}
                shape={<CandleShape />}
                isAnimationActive={false}
                name="Daily OHLC"
              />}
              {asset === 'global' && <>
                <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="#dfb657" strokeWidth={1.05} dot={false} connectNulls isAnimationActive={false} name="EMA 20" />
                <Line yAxisId="price" type="monotone" dataKey="ema50" stroke="#59b3ad" strokeWidth={1.05} dot={false} connectNulls isAnimationActive={false} name="EMA 50" />
                <Line yAxisId="price" type="monotone" dataKey="ema200" stroke="#8588c3" strokeWidth={1.05} dot={false} connectNulls isAnimationActive={false} name="EMA 200" />
              </>}
              {asset === 'nepal' && <Line yAxisId="price" type="monotone" dataKey="actual" stroke="#d6b166" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} name="FENEGOSIDA 24K" />}
              <Line
                yAxisId="price"
                type="linear"
                dataKey="forecastBase"
                stroke="#f4d590"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#f4d590', stroke: '#121820', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
                name="Base forecast"
              />
              {globalForecast && <ReferenceLine yAxisId="price" y={selectedQuote ?? undefined} stroke="rgba(218,224,232,.28)" strokeDasharray="2 5" ifOverflow="extendDomain" />}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">
            <Activity size={25} />
            <strong>{asset === 'global' ? 'No historical OHLC observations received' : 'No official local rate history received'}</strong>
            <span>Charts are left blank until a source returns real observations.</span>
          </div>
        )}
      </div>

      <div className="chart-footnote">
        <span>Source: {asset === 'global' ? `${market.historySource} · ${market.spotSource}` : market.nepal.rateSource}</span>
        <span>{asset === 'global' ? `Quote as of ${market.spotAsOf ?? 'timestamp unavailable'} · ${market.spotStale ? 'stale/last observation' : 'fresh provider quote'}; forecast is a separate next-session point.` : `Fixing ${market.nepal.rateDate ?? 'date unavailable'} · ${market.nepal.rateStale ? 'stale' : 'latest published'}; projection remains a separate future point.`}</span>
      </div>
    </section>
  )
}
