'use client'

import NepaliDate from 'nepali-date-converter'
import {
  Activity,
  AlertCircle,
  Bell,
  BellRing,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  MoreHorizontal,
  Calculator,
  Database,
  FilePlus2,
  Globe2,
  Gauge,
  Landmark,
  Newspaper,
  Radio,
  RefreshCw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import MarketChart from './MarketChart'
import CrisisSimulator from './CrisisSimulator'
import WorldMap from './WorldMap'
import AccuracyDrawer from './AccuracyDrawer'
import ParitySettingsDrawer from './ParitySettingsDrawer'
import ManualRatesDrawer from './ManualRatesDrawer'
import Stage3ToolsDrawer from './Stage3ToolsDrawer'
import DataFreshnessDrawer from './DataFreshnessDrawer'
import ForecastWhyPanel from './ForecastWhyPanel'
import AdminAccess from './AdminAccess'
import { calculateScenarioForecast, defaultScenarioInput } from '@/lib/goldEngine'
import { resolveEventOverlay } from '@/lib/eventImpact'
import { buildLiveChartPoint, isLiveChartPointSynced, selectPriceMoveAlarm } from '@/lib/systemAudit'
import { scoreHeadline } from '@/lib/sentiment'
import { buildProbabilisticForecast } from '@/engine/probability'
import { getNepalFixingTiming } from '@/engine/nepalTiming'
import type { ForecastWhyFactor, LiveEvent, PredictionResponse, QuantForecast, ScenarioInput, VolatilityRegimeSummary } from '@/lib/types'

function nptParts(input: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(input)
  const part = (name: string) => Number(parts.find((value) => value.type === name)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') }
}

function bsLabelForNptDate(year: number, month: number, day: number, language: 'en' | 'ne' = 'en'): string {
  try {
    const localNoon = new Date(year, month - 1, day, 12, 0, 0)
    return new NepaliDate(localNoon).format('DD MMMM YYYY', language === 'ne' ? 'np' : 'en')
  } catch {
    return language === 'ne' ? 'वि.सं. मिति उपलब्ध छैन' : 'BS date unavailable'
  }
}

let activeUiLanguage: 'en' | 'ne' = 'en'
function nepaliDigits(value: string, language: 'en' | 'ne' = activeUiLanguage) {
  return language === 'ne' ? value.replace(/[0-9]/g, (digit) => '०१२३४५६७८९'[Number(digit)]) : value
}

function nextAnnouncementMs(now: number) {
  const parts = nptParts(new Date(now))
  let target = Date.UTC(parts.year, parts.month - 1, parts.day, 11, 0, 0) - 5 * 60 * 60 * 1000 - 45 * 60 * 1000
  if (now >= target) target += 86_400_000
  return target
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return nepaliDigits(`${days > 0 ? `${days}d ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`)
}

function formatUsd(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nepaliDigits(`$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`)
}

function formatNpr(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nepaliDigits(`${activeUiLanguage === 'ne' ? 'रु' : 'Rs'} ${Math.round(value).toLocaleString('en-IN')}`)
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nepaliDigits(value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }))
}

function formatSigned(value: number | null | undefined, digits = 2, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const prefix = value > 0 ? '+' : value < 0 ? '−' : ''
  return nepaliDigits(`${prefix}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`)
}

function formatAdDate(input: Date) {
  return nepaliDigits(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric',
  }).format(input))
}

function formatNptTime(input: string | null | undefined) {
  if (!input) return '—'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '—'
  return nepaliDigits(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)) + ' NPT'
}

function humanAge(input: string | null | undefined) {
  if (!input) return 'timestamp unavailable'
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(input)) / 1000))
  if (seconds < 60) return nepaliDigits(`${seconds}s ago`)
  if (seconds < 3600) return nepaliDigits(`${Math.floor(seconds / 60)}m ago`)
  if (seconds < 86_400) return nepaliDigits(`${Math.floor(seconds / 3600)}h ago`)
  return nepaliDigits(`${Math.floor(seconds / 86_400)}d ago`)
}

function finalGlobal(response: PredictionResponse | null): QuantForecast | null {
  if (!response) return null
  if (response.quantitativeForecast) return response.quantitativeForecast
  const global = response.analysis?.global_forecast_24h
  if (!global) return null
  return {
    currentXauUsd: response.market.spot ?? global.predicted_xau_usd,
    predictedXauUsd: global.predicted_xau_usd,
    changeUsd: global.change_usd,
    changePct: global.change_pct,
    rangeLow: global.range_low,
    rangeHigh: global.range_high,
    atr14Usd: response.market.indicators?.atr14 ?? 0,
    confidencePct: global.confidence_pct,
    confidenceLabel: 'Signal confidence · uncalibrated',
    method: 'Provider blend',
  }
}

function impactClass(impact: string) {
  if (impact === 'BULLISH') return 'bullish'
  if (impact === 'BEARISH') return 'bearish'
  return 'neutral'
}

function scoreClass(value: number) {
  return value > 0.15 ? 'positive' : value < -0.15 ? 'negative' : 'flat'
}

interface TickerProps { label: string; value: string; meta: string; tone?: 'gold' | 'positive' | 'negative' | 'neutral'; icon?: ReactNode; stale?: boolean }
function TickerItem({ label, value, meta, tone = 'neutral', icon, stale }: TickerProps) {
  return (
    <div className="ticker-item">
      <div className="ticker-topline">{icon}<span>{label}</span>{stale && <i className="tiny-stale-dot" title="Source is stale" />}</div>
      <strong className={`ticker-value tone-${tone}`}>{value}</strong>
      <span className="ticker-meta">{meta}</span>
    </div>
  )
}

type AlarmDirection = 'surge' | 'drop' | 'test'
type AlarmSource = 'daily' | 'forecast' | 'scenario' | 'event' | 'simulated' | 'test'
interface AlarmNotice { id: string; direction: AlarmDirection; source: AlarmSource; amount: number; threshold: number; createdAt: number }

function alarmSourceLabel(source: AlarmSource) {
  if (source === 'simulated') return 'SIMULATED EVENT'
  if (source === 'event') return 'SELECTED LIVE EVENT OVERLAY'
  if (source === 'daily') return 'TODAY’S FENEGOSIDA FIXING MOVE'
  if (source === 'scenario') return 'SCENARIO OVERLAY'
  if (source === 'test') return 'ALARM SELF-TEST'
  return '11:00 NPT FORECAST MOVE'
}

function AlarmBanner({ notice, onDismiss }: { notice: AlarmNotice; onDismiss: () => void }) {
  const isDrop = notice.direction === 'drop'
  const isTest = notice.direction === 'test'
  const isSimulated = notice.source === 'simulated'
  const amountText = notice.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return (
    <div className={`alarm-flash-banner ${isDrop ? 'alarm-drop' : ''} ${isSimulated ? 'alarm-simulated' : ''} ${isTest ? 'alarm-test' : ''}`} role="alert" aria-live="assertive">
      <div className="alarm-banner-icon">{isTest ? <BellRing size={18} /> : isDrop ? <TrendingDown size={18} /> : <TrendingUp size={18} />}</div>
      <div className="alarm-banner-copy"><b>{isTest ? 'ALARM SELF-TEST · BOTH TONES' : isSimulated ? 'SIMULATED CRISIS ALARM' : notice.source === 'daily' ? isDrop ? 'OFFICIAL FIXING DROP ALARM' : 'OFFICIAL FIXING SURGE ALARM' : notice.source === 'event' ? 'SELECTED EVENT PRICE ALARM' : isDrop ? 'PRICE-MOVE DROP ALARM' : 'PRICE-MOVE SURGE ALARM'}<small>{alarmSourceLabel(notice.source)} · ±Rs {notice.threshold.toLocaleString('en-IN')}/TOLA THRESHOLD</small></b></div>
      <div className="alarm-banner-value">{isTest ? '+Rs 2,000 / −Rs 2,000' : `${isDrop ? '−' : '+'}Rs ${amountText}`}<small>{isTest ? 'SURGE + DROP TEST' : '24K / TOLA'}</small></div>
      <button className="alarm-dismiss" onClick={onDismiss} aria-label="Dismiss price alert"><X size={15} /></button>
    </div>
  )
}

interface ForecastCardProps {
  title: string
  badge: string
  value: string
  change: string
  positive: boolean | null
  kicker: string
  children?: React.ReactNode
  confidence?: number
  range?: { low: string; high: string; current: string }
  note?: string
  upProbabilityPct?: number
  downProbabilityPct?: number
  confidenceLevel?: string
  whyFactors?: ForecastWhyFactor[]
  whyUnavailableReason?: string
  volatilityRegime?: VolatilityRegimeSummary
  language?: 'en' | 'ne'
  lowReliabilityReason?: string | null
  rangeMethodLabel?: string
  probabilityStatus?: string
}
function GlobalForecastCard({ title, badge, value, change, positive, kicker, confidence, range, note, upProbabilityPct, downProbabilityPct, confidenceLevel, whyFactors = [], whyUnavailableReason, volatilityRegime, language = 'en', lowReliabilityReason, rangeMethodLabel, probabilityStatus }: ForecastCardProps) {
  return (
    <article className={`forecast-card global-card ${lowReliabilityReason ? 'low-reliability' : ''}`}>
      <div className="forecast-card-header">
        <div className="card-asset"><span className="asset-orb gold-orb"><Globe2 size={17} /></span><div><span className="eyebrow">GLOBAL / 24H</span><h2>{title}</h2></div></div>
        <div className="forecast-badge-stack"><span className={`regime-pill ${positive === null ? 'muted' : positive ? 'bullish' : 'bearish'}`}><i />{badge}</span>{volatilityRegime && <span className={`volatility-regime-badge ${volatilityRegime.name.toLowerCase()}`} title={`${volatilityRegime.rationale} · ATR percentile ${volatilityRegime.atrPercentile ?? 'unavailable'} · geopolitical risk ${volatilityRegime.geopoliticalRiskScore}`}><i />{language === 'ne' ? volatilityRegime.name === 'Stress' ? 'तनाव' : volatilityRegime.name === 'Calm' ? 'शान्त' : 'सामान्य' : volatilityRegime.name.toUpperCase()} · {volatilityRegime.atrPercentile === null ? 'ATR —' : `ATR P${volatilityRegime.atrPercentile}`}</span>}</div>
      </div>
      <div className="forecast-kicker">{kicker}</div>
      {lowReliabilityReason && <div className="forecast-reliability-warning"><AlertCircle size={13} /><b>LOW RELIABILITY:</b><span title={lowReliabilityReason}>{lowReliabilityReason}</span></div>}
      <div className="hero-value-row">
        <div className="hero-value">{value}</div>
        <div className={`hero-change ${positive === null ? '' : positive ? 'positive' : 'negative'}`}>
          {positive === null ? <Activity size={15} /> : positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          {change}
        </div>
      </div>
      {range ? <div className="range-rail-wrap">
        <div className="range-rail-head"><span>EXPECTED PRICE RANGE</span><span title={rangeMethodLabel}>{rangeMethodLabel ?? 'Volatility-based, not error-based'}</span></div>
        <div className="range-rail"><span className="range-rail-fill" /><i className="range-tick range-low" /><i className="range-tick range-mark" /><i className="range-tick range-high" /></div>
        <div className="range-rail-labels"><span>{range.low}<small>LOW</small></span><span>{range.current}<small>BASE</small></span><span>{range.high}<small>HIGH</small></span></div>
      </div> : <div className="card-empty-note">Price range is withheld until real OHLC history is available.</div>}
      <div className="forecast-card-bottom">
        <div className="confidence-block">
          <div className="confidence-label"><span>Signal confidence</span><b>{confidence === undefined ? '—' : `${confidence}%`}</b></div>
          <div className="confidence-track"><span style={{ width: `${confidence ?? 0}%` }} /></div>
          <span className="confidence-foot">{confidenceLevel ?? 'Low'} confidence · heuristic, uncalibrated</span>
        </div>
        <div className="direction-mark"><span>DIRECTION PROBABILITY</span><b className={positive === null ? '' : positive ? 'positive-text' : 'negative-text'}>{upProbabilityPct === undefined ? '—' : `${upProbabilityPct}% UP / ${downProbabilityPct}% DOWN`}</b><small className="probability-state">{probabilityStatus ?? 'UNCALIBRATED'}</small></div>
      </div>
      {note && <div className="forecast-note"><CircleHelp size={12} />{note}</div>}
      <ForecastWhyPanel factors={whyFactors} language={language} unavailableReason={whyUnavailableReason} />
    </article>
  )
}

function NepalForecastCard({ response, amount, scenarioActive, language = 'en' }: { response: PredictionResponse; amount: ReturnType<typeof calculateScenarioForecast> | null; scenarioActive: boolean; language?: 'en' | 'ne' }) {
  const forecast = (scenarioActive ? amount?.nepal ?? response.defaultNepalForecast : response.defaultNepalForecast ?? amount?.nepal) ?? null
  const market = response.market
  const probable = !scenarioActive && response.probabilisticForecast
    ? response.probabilisticForecast
    : buildProbabilisticForecast(amount?.global ?? response.quantitativeForecast, forecast, { xauUsd: response.fixingWindow?.startObservation?.value ?? market.spot, nepal24k: market.nepal.rate24kTola, nepal22k: market.nepal.rate22kTola, tejabi: market.nepal.rateTejabiTola })
  const timing = response.nepalTiming
  const reliabilityReason = market.reliability?.nepal.state === 'low-reliability' ? market.reliability.nepal.reasons[0] ?? 'A required Nepal pricing input is stale or unavailable.' : null
  const probabilityStatus = (key: 'nepal-24k' | 'nepal-22k' | 'nepal-tejabi') => {
    if (scenarioActive) return 'SCENARIO · UNCALIBRATED'
    const item = response.probabilityCalibration?.[key]
    return item?.method === 'isotonic' ? 'ISOTONIC CALIBRATED' : 'UNCALIBRATED'
  }
  const formatProbRange = (key: 'nepal-24k' | 'nepal-22k' | 'nepal-tejabi') => {
    const item = probable?.[key]
    const method = response.rangeCalibration?.[key]
    return item ? `Low ${formatNpr(item.low)} · High ${formatNpr(item.high)} · ${item.upProbabilityPct}% up · ${method?.method === 'empirical-error' ? 'error P10–P90' : 'ATR-based, not error-based'} · ${probabilityStatus(key)}` : 'Range unavailable'
  }
  const today24k = market.nepal.rate24kTola
  const today22k = market.nepal.rate22kTola
  const today22k10g = market.nepal.rate22k10g
  const todayTejabiTola = market.nepal.rateTejabiTola
  const todayTejabi10g = market.nepal.rateTejabi10g
  const fixingLabel = market.nepal.rateStale ? 'Latest fixing' : 'Today'
  const change = forecast?.expectedChangeTolaNpr ?? null
  const forecastSpot = amount?.global?.predictedXauUsd ?? response.analysis?.global_forecast_24h?.predicted_xau_usd ?? response.quantitativeForecast?.predictedXauUsd ?? market.spot
  const anchorTooltip = forecast?.usedOfficialAnchor
    ? `Official-rate anchor: ${formatNpr(forecast.official24kAnchorNpr)} per tola (${forecast.officialRateDate ?? 'date unavailable'}). XAU/USD ${formatUsd(market.spot)} → ${formatUsd(forecastSpot)}: ${formatSigned(forecast.spotMovePct ?? 0, 3, '%')} = ${formatSigned(forecast.spotAdjustmentNpr ?? 0, 0)} NPR. USD/NPR projected conversion ${formatNumber(forecast.fxRate, 3)} after ${formatSigned(forecast.fxMovePct ?? 0, 3, '%')} FX change = ${formatSigned(forecast.fxAdjustmentNpr ?? 0, 0)} NPR. Anchored 24K forecast: ${formatNpr(forecast.predicted24kTolaNpr)}. Separate import-parity cross-check: ${formatNpr(forecast.unanchoredImportParity24kNpr)} (${formatSigned(forecast.unanchoredImportParityDeltaNpr ?? 0, 0)} versus official), using ${formatNumber(forecast.customsDutyPct, 1)}% duty × ${formatNumber(forecast.vatOtherLevyPct ?? 0, 1)}% other levies × ${formatNumber(forecast.dealerMarginPct ?? 0, 1)}% dealer margin × ${formatNumber(forecast.localSpreadPct, 1)}% rolling spread (${forecast.spreadSampleCount} observations). Those parity inputs explain the apparent premium; they do not replace the official-rate anchor.`
    : `Scenario estimate: recalculated from the selected scenario inputs and is not the official-rate-anchored baseline.`
  const fxCaption = scenarioActive
    ? `Scenario USD/NPR ${formatNumber(forecast?.fxRate, 2)} · editable scenario input`
    : timing?.mode === 'last-minute'
      ? `Current USD/NPR rate · ${response.market.macro.usdNprParity.source} · no trend adjustment`
      : `24h FX trend ${formatSigned(forecast?.fxMovePct ?? 0, 3, '%')} ${forecast?.fxMoveSource ? `· ${forecast.fxMoveSource}` : '· no fresh daily trend'}`
  return (
    <article className={`forecast-card nepal-card ${reliabilityReason ? 'low-reliability' : ''}`}>
      <div className="forecast-card-header">
        <div className="card-asset"><span className="asset-orb red-orb"><Landmark size={17} /></span><div><span className="eyebrow">NEPAL / {timing?.mode === 'last-minute' ? 'LAST-MINUTE ESTIMATE' : 'OVERNIGHT ESTIMATE'}</span><h2>FENEGOSIDA parity</h2></div></div>
        <span className={`regime-pill ${reliabilityReason ? 'muted' : forecast ? 'local-pill' : 'muted'}`}><i />{reliabilityReason ? 'LOW RELIABILITY' : forecast ? market.nepal.rate24kManualEntry ? 'MANUAL ENTRY' : timing?.mode === 'last-minute' ? market.spotStale ? 'LAST-MINUTE · SPOT STALE' : 'LIVE UNTIL 11:00' : 'OVERNIGHT' : 'AWAITING FEED'}</span>
      </div>
      {reliabilityReason && <div className="forecast-reliability-warning"><AlertCircle size={13} /><b>LOW RELIABILITY:</b><span title={reliabilityReason}>{reliabilityReason}</span></div>}
      {forecast ? <>
        <div className="local-primary-row">
          <div>
            <div className="local-primary-label">24K · CHHAPAWAL <span>1 TOLA</span><button type="button" className="forecast-info-button" title={anchorTooltip} aria-label="Show Nepal forecast anchor calculation"><CircleHelp size={13} /></button></div>
            <div className="local-primary-value">{formatNpr(forecast.predicted24kTolaNpr)}</div>
            <div className={`local-change ${change === null ? '' : change >= 0 ? 'positive' : 'negative'}`}>
              {change === null ? <Activity size={14} /> : change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
              {change === null ? 'Change unavailable' : `${formatSigned(change, 0)} NPR ${market.nepal.rateStale ? 'vs latest published fixing' : 'vs official today'}`}
            </div>
            {probable?.['nepal-24k'] && <div className="local-probability">{formatProbRange('nepal-24k')} · {probable['nepal-24k'].downProbabilityPct}% down · {probable['nepal-24k'].confidence} confidence</div>}
          </div>
          <div className="local-side-compare"><span>{market.nepal.rate24kManualEntry ? 'MANUAL FENEGOSIDA ENTRY' : market.nepal.rateStale ? 'LAST OFFICIAL FIXING' : 'OFFICIAL TODAY'}</span><b>{formatNpr(today24k)}</b><small>{market.nepal.rateDate ?? 'rate date unavailable'}{market.nepal.rateStale ? ' · STALE' : ''}</small></div>
        </div>
        <div className="local-secondary-grid">
          <div className="local-secondary-cell"><span>24K CHHAPAWAL <i>10 GRAMS</i></span><b>{formatNpr(forecast.predicted24k10gNpr)}</b><small>Predicted fine-gold parity</small></div>
          <div className="local-secondary-cell"><span>TEJABI · {(forecast.tejabiRatio * 100).toFixed(2)}% RATIO <i>1 TOLA</i></span><b>{formatNpr(forecast.predictedTejabiTolaNpr)}</b><small className="local-range-small">{formatProbRange('nepal-tejabi')} · {probable?.['nepal-tejabi']?.downProbabilityPct ?? 50}% down · {probable?.['nepal-tejabi']?.confidence ?? 'Low'} confidence</small></div>
          <div className="local-secondary-cell"><span>TEJABI · {(forecast.tejabiRatio * 100).toFixed(2)}% RATIO <i>10 GRAMS</i></span><b>{formatNpr(forecast.predictedTejabi10gNpr)}</b><small>{forecast.tejabiRatioSource === 'learned' ? `Learned from ${forecast.tejabiRatioSamples}/7 official pairs` : 'Manual fallback · not an official quote'}</small></div>
          <div className="local-secondary-cell"><span>22K · 91.67% <i>1 TOLA</i></span><b>{formatNpr(forecast.predicted22kTolaNpr)}</b><small className="local-range-small">{formatProbRange('nepal-22k')} · {probable?.['nepal-22k']?.downProbabilityPct ?? 50}% down · {probable?.['nepal-22k']?.confidence ?? 'Low'} confidence · derived purity estimate, not a FENEGOSIDA rate</small></div>
          <div className="local-secondary-cell"><span>22K · 91.67% <i>10 GRAMS</i></span><b>{formatNpr(forecast.predicted22k10gNpr)}</b><small>Derived purity estimate, not a FENEGOSIDA rate</small></div>
        </div>
        <div className="local-today-strip">
          <span>{fixingLabel} · Tejabi / tola: <b>{formatNpr(todayTejabiTola)}</b><small>{market.nepal.rateTejabiManualEntry ? 'manual entry · FENEGOSIDA transcription' : market.nepal.rateTejabiOfficial ? 'separate FENEGOSIDA quote' : `derived with ${(forecast.tejabiRatio * 100).toFixed(2)}% ratio · not an official rate`}</small></span>
          <span>{fixingLabel} · 22K 91.67% / tola: <b>{formatNpr(today22k)}</b><small>derived purity estimate, not a FENEGOSIDA rate</small></span>
          <span>Tejabi / 10g: <b>{formatNpr(todayTejabi10g)}</b><small>{forecast.tejabiRatioSource} ratio · {fixingLabel.toLowerCase()}</small></span>
          <span>RATIO UPDATED: <b>{forecast.tejabiRatioLastUpdatedAt ? formatNptTime(forecast.tejabiRatioLastUpdatedAt) : '—'}</b><small>{forecast.tejabiRatioSource} · {forecast.tejabiRatioSamples}/7 paired daily observations</small></span>
        </div>
        <div className="parity-breakdown">
          <div className="parity-title"><Scale size={13} /> IMPORT PARITY INPUTS {scenarioActive && <span className="sim-live-dot">LIVE SCENARIO</span>}</div>
          <div className="parity-formula"><span>XAU/USD</span><b>{formatUsd(amount?.global.predictedXauUsd ?? response.analysis?.global_forecast_24h.predicted_xau_usd ?? response.market.spot)}</b><i>→</i><span>USD/NPR</span><b>{formatNumber(forecast.fxRate, 2)}</b><i>×</i><span>Duty</span><b>{formatNumber(forecast.customsDutyPct, 1)}%</b><i>+</i><span>Spread</span><b>{formatNumber(forecast.localSpreadPct, 1)}%</b><span>Margin</span><b>{formatNumber(forecast.dealerMarginPct ?? 0, 1)}%</b></div>
          <div className="parity-caption">FX: {fxCaption} · local basis from {forecast.spreadSampleCount} matched observations · duty {formatNumber(forecast.customsDutyPct, 1)}% · VAT/other levies {formatNumber(forecast.vatOtherLevyPct ?? forecast.bankFreightPct, 1)}% · dealer margin {formatNumber(forecast.dealerMarginPct ?? 0, 1)}% · {timing?.mode === 'last-minute' ? market.spotStale ? 'last-minute mode · spot stale, awaiting fresh quote' : 'current XAU spot refreshes every minute until 11:00 NPT' : 'overnight close + USD/NPR parity'}{timing?.closureNote ? ` · ${timing.closureNote}` : ''}</div>
        </div>
      </> : <div className="local-unavailable">
        <AlertCircle size={20} /><strong>Local estimate withheld</strong>
        <span>Requires a valid USD/NPR conversion, official 24K benchmark and matched local-spread history.</span>
        <span className="unavailable-source">{market.nepal.rateSource} · spread: {market.localSpreadMethod}</span>
      </div>}
      <ForecastWhyPanel factors={scenarioActive ? [] : response.whyNepalFactors ?? []} local language={language} unavailableReason={scenarioActive ? 'Scenario forecast uses editable scenario inputs; its baseline explanations are intentionally not reused.' : undefined} />
    </article>
  )
}

function SignalCard({ response }: { response: PredictionResponse }) {
  const analysis = response.analysis
  const scores = [
    { label: 'Geopolitical', score: analysis?.geopolitical_risk_score ?? null, icon: <Globe2 size={14} />, detail: 'SAFE-HAVEN / LIQUIDITY' },
    { label: 'Yield & dollar', score: analysis?.macro_yield_score ?? null, icon: <BarChart3 size={14} />, detail: 'REAL YIELD / DXY' },
    { label: 'Technical', score: analysis?.technical_momentum_score ?? response.market.indicators?.technicalMomentumScore ?? null, icon: <Activity size={14} />, detail: 'RSI / TREND / MACD' },
  ]
  return (
    <section className="panel signal-panel">
      <div className="eyebrow"><span className="eyebrow-index">MODEL</span> Signal matrix</div>
      <div className="signal-panel-head"><h3>What’s moving the bias</h3><span className={`analysis-mode-pill ${response.analysisMode === 'rules-based' ? 'rules-mode' : 'ai-mode'}`}><Sparkles size={11} />{response.analysisMode === 'rules-based' ? 'RULES ENGINE' : `${response.analysisMode.toUpperCase()} BLEND`}</span></div>
      {scores.map((item) => (
        <div className="signal-row" key={item.label}>
          <div className="signal-icon">{item.icon}</div>
          <div className="signal-label"><b>{item.label}</b><small>{item.detail}</small></div>
          <div className="signal-meter"><span className={item.score === null ? '' : item.score >= 0 ? 'signal-up' : 'signal-down'} style={{ width: `${item.score === null ? 0 : Math.min(100, Math.abs(item.score) * 10)}%` }} /></div>
          <b className={`signal-score ${item.score === null ? 'muted-text' : scoreClass(item.score)}`}>{item.score === null ? '—' : `${item.score > 0 ? '+' : ''}${item.score.toFixed(1)}`}</b>
        </div>
      ))}
      <div className="regime-card"><div><span>REGIME</span><b>{analysis?.market_regime ?? 'INSUFFICIENT DATA'}</b></div><span className="regime-pulse"><i /><i /><i /></span></div>
      <EnsembleWeightsDetails response={response} />
      <p className="signal-disclaimer"><CircleHelp size={13} />{response.modelNote}</p>
    </section>
  )
}

function EnsembleWeightsDetails({ response }: { response: PredictionResponse }) {
  const model = response.ensembleModel
  const drivers = response.ensembleDrivers ?? []
  return (
    <details className="ensemble-details">
      <summary><span>SIGNED MACRO + NEPAL FACTORS</span><b>{model?.mode === 'ridge-learned' ? `RIDGE FIT · ${model.fitAt ? formatNptTime(model.fitAt) : 'DATE N/A'}` : 'HEURISTIC FALLBACK · NO FIT'}</b><ChevronDown size={12} /></summary>
      <div className="ensemble-meta">
        <span>{model?.mode === 'ridge-learned' ? `Fit ${model.fitAt ? formatNptTime(model.fitAt) : 'date unavailable'} · ${model.trainingSamples} verified outcomes · ${model.backtestSamples} OHLC rows` : `No fit date · ${model?.trainingSamples ?? 0}/25 verified outcomes · ${model?.backtestSamples ?? 0}/60 total rows`}</span>
        <small>{model?.note ?? 'Model summary unavailable.'}</small>
      </div>
      <div className="ensemble-driver-list">
        {drivers.map((driver) => (
          <div className="ensemble-driver" key={driver.key} title={`${driver.source}${driver.asOf ? ` · ${driver.asOf}` : ''} · ${driver.note}`}>
            <div><b>{driver.label}</b><small>{driver.status.toUpperCase()} · {driver.asOf ? humanAge(driver.asOf) : 'timestamp unavailable'}</small></div>
            <span className={driver.signal === null ? 'muted-text' : driver.signal > 0.005 ? 'positive' : driver.signal < -0.005 ? 'negative' : ''}>{driver.signal === null ? '—' : `${driver.signal > 0 ? '+' : ''}${(driver.signal * 100).toFixed(0)}%`}</span>
            <small className={driver.direction === 'bullish' ? 'positive' : driver.direction === 'bearish' ? 'negative' : 'muted-text'}>{driver.contributionKind === 'excluded' ? 'excluded' : driver.contributionKind === 'legacy-quant' ? 'in quant base' : `${driver.contributionKind === 'ridge-blend' ? '45% · ' : ''}w${(model?.weights[driver.key] ?? 0).toFixed(2)} · ${driver.contributionPct === null ? '—' : `${driver.contributionPct > 0 ? '+' : ''}${driver.contributionPct.toFixed(3)} pp`}`}</small>
          </div>
        ))}
      </div>
      <div className="ensemble-table-note">Score is the signed bullish/bearish signal. Contributions are predicted XAU percentage points; ridge coefficients are shown after the 45% blend. Legacy technical/DXY/yield/ZQ terms already inside the fallback quantitative baseline are labelled “in quant base,” not double-counted. Stale/unavailable inputs are excluded; BS seasonality is a calendar proxy.</div>
    </details>
  )
}

function TechnicalStrip({ response }: { response: PredictionResponse }) {
  const i = response.market.indicators
  const items = [
    { label: 'RSI · 14', value: i?.rsi14 === null || i?.rsi14 === undefined ? '—' : formatNumber(i.rsi14, 1), detail: i?.rsi14 && i.rsi14 > 70 ? 'OVERBOUGHT ZONE' : i?.rsi14 && i.rsi14 < 30 ? 'OVERSOLD ZONE' : 'MOMENTUM' },
    { label: 'EMA · 20', value: formatUsd(i?.ema20, 2), detail: 'SHORT TREND' },
    { label: 'EMA · 50', value: formatUsd(i?.ema50, 2), detail: 'SWING TREND' },
    { label: 'EMA · 200', value: formatUsd(i?.ema200, 2), detail: 'LONG TREND' },
    { label: 'MACD · HIST', value: formatUsd(i?.macdHistogram, 2), detail: i?.macdHistogram === null ? 'WARMING UP' : 'USD / OZ' },
    { label: 'ATR · 14D', value: formatUsd(i?.atr14, 2), detail: 'DAILY RANGE' },
  ]
  return (
    <section className="technical-strip">
      <div className="technical-strip-label"><Activity size={14} /><span>TECHNICALS</span></div>
      {items.map((item) => <div className="technical-cell" key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></div>)}
      <div className="technical-strip-end"><span>LIVE ENGINE</span><i /></div>
    </section>
  )
}

function ScheduledEventsPanel({ response, now }: { response: PredictionResponse; now: number }) {
  const feed = response.market.stage2.eventCalendar
  const todayNpt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  const events = (feed.data ?? []).filter((event) => event.timePrecision === 'date-only' ? event.startsAt.slice(0, 10) >= todayNpt : Date.parse(event.startsAt) >= now - 4 * 60 * 60 * 1000)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 10)
  const risk = response.eventRisk
  return (
    <section className="panel scheduled-events-panel">
      <div className="scheduled-events-head">
        <div><div className="eyebrow"><span className="eyebrow-index">FED / BLS</span> Scheduled event risk</div><h2>Macro release countdown</h2></div>
        <span className={`event-feed-state ${feed.status}`}>{feed.status.toUpperCase()}</span>
      </div>
      <p className="scheduled-events-provenance">{feed.source} · last checked {formatNptTime(feed.checkedAt)} · {feed.note}</p>
      {risk?.activeEvents.length ? <div className="event-risk-banner"><AlertCircle size={13} /><span>Forecast range ×{risk.rangeMultiplier.toFixed(2)} · confidence −{risk.confidencePenaltyPct.toFixed(1)} pp. {risk.note}</span></div> : null}
      {events.length ? <div className="scheduled-event-list">{events.map((event) => {
        const left = Date.parse(event.startsAt) - now
        const dateOnly = event.timePrecision === 'date-only'
        const eventDay = Date.parse(`${event.startsAt.slice(0, 10)}T00:00:00.000Z`)
        const todayDay = Date.parse(`${todayNpt}T00:00:00.000Z`)
        const daysUntil = Math.max(0, Math.round((eventDay - todayDay) / 86_400_000))
        return <div className="scheduled-event-row" key={event.id}>
          <span className={`scheduled-event-kind ${event.kind === 'Fed speech' ? 'speech' : ''}`}>{event.kind}</span>
          <div><b>{event.title}</b><small>{dateOnly ? `${formatAdDate(new Date(`${event.startsAt.slice(0, 10)}T12:00:00.000Z`))} · time not published` : `${formatNptTime(event.startsAt)} · NPT`} · {event.source}{event.highImpact ? ' · HIGH IMPACT' : ''}</small></div>
          <strong>{dateOnly ? (daysUntil === 0 ? 'TODAY · DATE ONLY' : `T−${daysUntil}D · DATE ONLY`) : left >= 0 ? formatCountdown(left) : `${formatCountdown(Math.abs(left))} ago`}</strong>
        </div>
      })}</div> : <div className="scheduled-events-empty"><CircleHelp size={16} />{feed.status === 'unavailable' ? 'Calendar source unavailable; no events have been invented.' : 'No future scheduled events were returned by the source.'}</div>}
      <div className="scheduled-events-foot">Only official calendar records are shown. Countdown is local NPT; stale feed remains flagged. Scheduled-event widening changes the range/confidence only, not the point forecast.</div>
    </section>
  )
}

function InstitutionalDemandCard({ response }: { response: PredictionResponse }) {
  const { macro, institutionalDemand } = response.market
  const contribution = response.quantitativeForecast?.macroFactorContributions
  const central = institutionalDemand.centralBank
  const etf = institutionalDemand.goldEtf
  const reserve = (code: string) => institutionalDemand.goldReserves.find((item) => item.countryCode === code)
  const purchase = (code: string) => central.purchases.find((item) => item.countryCode === code)
  const signed = (value: number | null | undefined, digits = 2, suffix = '') =>
    value === null || value === undefined || !Number.isFinite(value) ? '—' : formatSigned(value, digits, suffix)
  const yieldMetric = macro.real10y.value !== null && !macro.real10y.stale ? macro.real10y : macro.nominal10y
  const items = [
    { label: 'DXY → XAU', value: contribution?.dxyPct == null ? '—' : signed(contribution.dxyPct, 3, '%'), detail: `Δ ${signed(macro.dxy.stale ? null : macro.dxy.changePct, 2, '%')}`, title: `${macro.dxy.source} · inverse gold effect` },
    { label: 'U.S. 10Y → XAU', value: contribution?.us10yYieldPct == null ? '—' : signed(contribution.us10yYieldPct, 3, '%'), detail: `Δ ${signed(yieldMetric.stale ? null : yieldMetric.change, 3, 'pp')}`, title: `${yieldMetric.source} · inverse yield effect` },
    { label: 'FED PATH PROXY', value: contribution?.rateCutExpectationsPct == null ? '—' : signed(contribution.rateCutExpectationsPct, 3, '%'), detail: `ZQ Δ ${signed(macro.fedFundsFutures.stale ? null : macro.fedFundsFutures.change, 3)}`, title: `${macro.fedFundsFutures.source} · front-month futures repricing, not CME meeting cut odds` },
    { label: 'WGC ETF FLOW', value: etf.provenance === 'reported' && etf.netFlowUsdBn !== null ? `${etf.netFlowUsdBn > 0 ? '+' : etf.netFlowUsdBn < 0 ? '−' : ''}$${formatNumber(Math.abs(etf.netFlowUsdBn), 1)}bn` : '—', detail: etf.period ?? 'not reported', title: etf.note },
    { label: 'WGC CB BUYING', value: central.provenance === 'reported' && central.netPurchasesTonnes !== null ? signed(central.netPurchasesTonnes, 0, 't') : '—', detail: central.period ?? 'not reported', title: central.note },
  ]
  const reserveText = (code: string, label: string) => {
    const item = reserve(code)
    return `${label} ${item?.tonnes === null || item?.tonnes === undefined ? '—' : `${formatNumber(item.tonnes, 0)}t`}${item?.stale ? '*' : ''}`
  }
  const buyerText = ['POL', 'KAZ', 'BRA'].map((code) => {
    const item = purchase(code)
    return `${item?.country ?? ({ POL: 'Poland', KAZ: 'Kazakhstan', BRA: 'Brazil' } as Record<string, string>)[code]} ${item?.monthlyTonnes == null ? '—' : `${item.monthlyTonnes > 0 ? '+' : ''}${formatNumber(item.monthlyTonnes, 0)}t`}`
  }).join(' · ')
  const reserveAsOf = reserve('USA')?.asOf ?? reserve('CHN')?.asOf ?? reserve('IND')?.asOf
  return (
    <section className="institutional-demand-card" aria-label="Institutional and central bank gold demand indicators">
      <div className="institutional-card-heading">
        <span className="institutional-card-icon"><Landmark size={12} /></span>
        <b>INSTITUTIONAL &amp; CENTRAL BANK DEMAND</b>
        <span className={`institutional-status institutional-${institutionalDemand.status}`}>{institutionalDemand.status.toUpperCase()}</span>
        <small title="Capped heuristic overlay; uncalibrated and not real-time flow">24H OVERLAY {contribution && contribution.activeFactors > 0 ? signed(contribution.totalPct, 3, '%') : '—'} · {contribution?.activeFactors ?? 0}/5</small>
      </div>
      <div className="institutional-factor-grid">
        {items.map((item) => <div className="institutional-factor" key={item.label} title={item.title}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></div>)}
      </div>
      <div className="institutional-footline">
        <span title="IMF IRFCL monthly gold reserve stock; * marks stale series">IMF GOLD RESERVES{reserveAsOf ? ` · ${reserveAsOf}` : ''}: {reserveText('USA', 'US')} · {reserveText('CHN', 'China')} · {reserveText('IND', 'India')}</span>
        <span title="WGC reported country accumulation; dash means not disclosed in this report">WGC BUYERS: {buyerText}</span>
      </div>
      <div className="institutional-source-note">Reported WGC / IMF data, lagged; dashes are unavailable, not zero. Monthly stocks/flows are structural context, not live order flow.</div>
    </section>
  )
}

function SystemAuditPanel({
  response,
  eventOverlay,
  priceMoveAlarm,
  dailyOfficialMove,
}: {
  response: PredictionResponse
  eventOverlay: { globalImpactPct: number; severeEventException: boolean }
  priceMoveAlarm: ReturnType<typeof selectPriceMoveAlarm>
  dailyOfficialMove: number | null
}) {
  const market = response.market
  const globalPoint = buildLiveChartPoint(market.spot, market.spotStale ? 'LAST OBSERVATION' : 'LIVE SPOT')
  const localPoint = buildLiveChartPoint(market.nepal.rate24kTola, market.nepal.rateStale ? 'LAST FIXING' : 'OFFICIAL FIXING')
  const globalSynced = isLiveChartPointSynced(globalPoint, market.spot)
  const localSynced = isLiveChartPointSynced(localPoint, market.nepal.rate24kTola)
  const fx = market.macro.usdNprParity
  const nrb = market.macro.nrbUsdNprSell
  const thirtyDay = response.backtest.find((item) => item.days === 30)
  const institutional = market.institutionalDemand
  const selectedReserveRows = ['USA', 'CHN', 'IND', 'POL', 'KAZ', 'BRA']
    .map((code) => institutional.goldReserves.find((item) => item.countryCode === code))
    .filter((item) => item !== undefined)
  const allPointsSynced = globalSynced && localSynced
  const systemAttention = !allPointsSynced || market.spotStale || market.nepal.rateStale || fx.value === null || fx.stale
  return (
    <details className="panel system-audit-panel">
      <summary className="system-audit-summary">
        <div className="system-audit-title"><span className="system-audit-mark"><ShieldCheck size={16} /></span><span><b>System Integrity &amp; Data Sync Audit</b><small>Quote lock · feed freshness · event overlay · 30-session validation</small></span></div>
        <div className="system-audit-state"><span className={systemAttention ? 'audit-state-warn' : 'audit-state-pass'}>{systemAttention ? 'ATTENTION' : 'PASS'}</span><ChevronDown size={15} /></div>
      </summary>
      <div className="system-audit-content">
        <div className="system-audit-checks">
          <div className="audit-check-row"><span className={globalSynced ? 'audit-check-pass' : 'audit-check-fail'}>{globalSynced ? <Check size={12} /> : <AlertCircle size={12} />}</span><div><b>XAU/USD chart ↔ ticker</b><small>Chart point {formatUsd(globalPoint?.close)} · quote card {formatUsd(market.spot)} · {market.spotStale ? 'stale/last observation' : 'fresh provider quote'} · {market.spotSource}</small></div></div>
          <div className="audit-check-row"><span className={localSynced ? 'audit-check-pass' : 'audit-check-fail'}>{localSynced ? <Check size={12} /> : <AlertCircle size={12} />}</span><div><b>Nepal 24K/tola chart ↔ official-rate card</b><small>Chart point {formatNpr(localPoint?.close)} · quote card {formatNpr(market.nepal.rate24kTola)} · fixing {market.nepal.rateDate ?? 'date unavailable'} · {market.nepal.rateStale ? 'stale' : 'latest source observation'}</small></div></div>
          <div className="audit-check-row"><span className={!fx.stale && fx.value !== null ? 'audit-check-pass' : 'audit-check-fail'}>{!fx.stale && fx.value !== null ? <Check size={12} /> : <AlertCircle size={12} />}</span><div><b>USD/NPR parity conversion</b><small>{formatNumber(fx.value, 4)} · {fx.source} · as of {fx.asOf ?? 'timestamp unavailable'}{nrb.value !== null ? ` · NRB reference ${formatNumber(nrb.value, 4)} (${nrb.source}${nrb.stale ? ', stale' : ''})` : ' · no NRB reference'}</small></div></div>
          <div className="audit-check-row"><span className={market.nepal.rateTejabiOfficial ? 'audit-check-pass' : 'audit-check-warn'}>{market.nepal.rateTejabiOfficial ? <Check size={12} /> : <Activity size={12} />}</span><div><b>Purity labels &amp; provenance</b><small>Tejabi ratio {((market.nepal.tejabiRatioState?.ratio ?? 0.9915) * 100).toFixed(4)}% · {market.nepal.tejabiRatioState?.source ?? 'manual'} · {market.nepal.tejabiRatioState?.sampleCount ?? 0}/7 pairs · {market.nepal.rateTejabiOfficial ? 'separate FENEGOSIDA quote' : 'derived value, not an official rate'} · 22K = 91.67% derived purity estimate, not a FENEGOSIDA rate</small></div></div>
          <div className="audit-check-row"><span className={eventOverlay.globalImpactPct === 0 ? 'audit-check-warn' : 'audit-check-pass'}>{eventOverlay.globalImpactPct === 0 ? <Activity size={12} /> : <Check size={12} />}</span><div><b>Selected map/simulator event overlay</b><small>{formatSigned(eventOverlay.globalImpactPct, 3, '%')} global shock in forecast · {eventOverlay.severeEventException ? 'severe-event ATR exception enabled (explicitly selected)' : 'normal ATR move cap applies'} · simulator remains separate from live news</small></div></div>
          <div className="audit-check-row"><span className={priceMoveAlarm ? 'audit-check-warn' : 'audit-check-pass'}>{priceMoveAlarm ? <BellRing size={12} /> : <Check size={12} />}</span><div><b>Daily / predicted move alarm</b><small>{priceMoveAlarm ? `${priceMoveAlarm.source.toUpperCase()} ${priceMoveAlarm.direction.toUpperCase()} · ${formatSigned(priceMoveAlarm.changeNprPerTola, 0)} NPR/tola vs ±Rs ${priceMoveAlarm.thresholdNprPerTola.toLocaleString('en-IN')}` : `No threshold-crossing move now · today's official change ${dailyOfficialMove === null ? 'unavailable' : `${formatSigned(dailyOfficialMove, 0)} NPR/tola`}`}</small></div></div>
        </div>
        <section className="institutional-audit-details" aria-label="Central bank and institutional demand source detail">
          <div className="institutional-audit-heading"><Landmark size={13} /><b>Institutional &amp; central-bank demand</b><span>{institutional.status.toUpperCase()}</span></div>
          <div className="institutional-source-grid">
            <div><b>WGC central-bank activity</b><strong>{institutional.centralBank.netPurchasesTonnes === null ? '—' : `${institutional.centralBank.netPurchasesTonnes > 0 ? '+' : ''}${formatNumber(institutional.centralBank.netPurchasesTonnes, 0)}t`} · {institutional.centralBank.period ?? 'no period'}</strong><small>{institutional.centralBank.note}</small>{institutional.centralBank.url && <a href={institutional.centralBank.url} target="_blank" rel="noreferrer">Open WGC report <ExternalLink size={9} /></a>}</div>
            <div><b>Global physically-backed ETF flow</b><strong>{institutional.goldEtf.netFlowUsdBn === null ? '—' : `${institutional.goldEtf.netFlowUsdBn > 0 ? '+' : institutional.goldEtf.netFlowUsdBn < 0 ? '−' : ''}$${formatNumber(Math.abs(institutional.goldEtf.netFlowUsdBn), 1)}bn`} · {institutional.goldEtf.period ?? 'no period'}</strong><small>{institutional.goldEtf.note}</small>{institutional.goldEtf.url && <a href={institutional.goldEtf.url} target="_blank" rel="noreferrer">Open WGC report <ExternalLink size={9} /></a>}</div>
          </div>
          <div className="institutional-detail-country-row"><b>WGC reported country activity</b>{institutional.centralBank.purchases.length ? institutional.centralBank.purchases.map((item) => <span key={item.countryCode}>{item.country} {item.monthlyTonnes === null ? '—' : `${item.monthlyTonnes > 0 ? '+' : ''}${formatNumber(item.monthlyTonnes, 0)}t`} · YTD {item.ytdTonnes === null ? '—' : `${item.ytdTonnes > 0 ? '+' : ''}${formatNumber(item.ytdTonnes, 0)}t`}</span>) : <span>No country details reported</span>}<span>Brazil {institutional.centralBank.purchases.find((item) => item.countryCode === 'BRA') ? 'reported above' : '— not named in this WGC report'}</span></div>
          <div className="institutional-detail-country-row"><b>IMF IRFCL reserve stocks · tonnes by own latest reported month</b>{selectedReserveRows.length ? selectedReserveRows.map((item) => <span key={item.countryCode}>{item.country}: {item.tonnes === null ? '—' : formatNumber(item.tonnes, 1)}t · {item.asOf ?? 'date unavailable'}{item.stale ? ' · STALE' : ''}{item.anomalyDetected ? ' · SCALE ANOMALY' : ''}</span>) : <span>Official reserve series unavailable</span>}<a href="https://data.imf.org/en/datasets/IMF.STA:IRFCL" target="_blank" rel="noreferrer">IMF IRFCL source <ExternalLink size={9} /></a></div>
          <p>Monthly stocks and reports are lagged structural context. Only fresh WGC monthly flow figures enter the small capped 24-hour overlay; IMF reserve stocks do not predict tomorrow’s price by themselves.</p>
        </section>
        <div className="audit-metric-grid">
          <div><span>30-DAY MAPE</span><b>{thirtyDay?.mapePct == null ? '—' : `${thirtyDay.mapePct.toFixed(3)}%`}</b></div>
          <div><span>DIRECTIONAL WIN RATE</span><b>{thirtyDay?.directionalWinRatePct == null ? '—' : `${thirtyDay.directionalWinRatePct.toFixed(1)}%`}</b></div>
          <div><span>RMSE · USD/OZ</span><b>{thirtyDay?.rmseUsd == null ? '—' : `$${thirtyDay.rmseUsd.toFixed(2)}`}</b></div>
          <div><span>VALID OBSERVATIONS</span><b>{thirtyDay?.observations ?? 0}</b></div>
        </div>
        <div className="system-audit-foot"><span>Forecast mode: {response.analysisMode === 'rules-based' ? 'quant + rules fallback' : `quant + ${response.analysisMode}`}.</span><span>Observed quote points and forecast points are separate chart rows; no estimate is relabelled as live.</span></div>
      </div>
    </details>
  )
}

function DriverFeed({ response }: { response: PredictionResponse }) {
  const items = response.analysis?.key_drivers_explanation ?? response.market.news.map((news) => ({
    headline: news.title, impact: news.impact, score: news.sentimentScore, reasoning: news.reasoning, source: news.source, url: news.url,
  }))
  return (
    <section className="panel drivers-panel">
      <div className="section-heading compact-heading">
        <div><div className="eyebrow"><span className="eyebrow-index">04</span> Explainable feed</div><h2>Signal notes <span className="heading-dot">/</span> live drivers</h2></div>
        <span className="feed-live"><i />{response.market.news.length ? 'LIVE HEADLINES' : 'FEED QUIET'}</span>
      </div>
      <div className="driver-list">
        {items.slice(0, 8).map((item, index) => (
          <article className="driver-row" key={`${item.headline}-${index}`}>
            <div className={`driver-impact ${impactClass(item.impact)}`}>{item.impact === 'BULLISH' ? <ArrowUpRight size={14} /> : item.impact === 'BEARISH' ? <ArrowDownRight size={14} /> : <Activity size={13} />}</div>
            <div className="driver-copy">
              <div className="driver-title-row">
                {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}<ExternalLink size={11} /></a> : <strong>{item.headline}</strong>}
                <span className={`impact-label ${impactClass(item.impact)}`}>{item.impact}</span>
              </div>
              <p>{item.reasoning}</p>
              <div className="driver-source"><span>{item.source ?? 'In-app signal engine'}</span><b>SCORE {item.score > 0 ? '+' : ''}{item.score.toFixed(1)}</b></div>
            </div>
          </article>
        ))}
        {!items.length && <div className="driver-empty"><Newspaper size={20} /><span>No verified headlines or indicators have been returned. Nothing is synthesized to fill this feed.</span></div>}
      </div>
      <div className="driver-footnote"><ShieldCheck size={13} />AI driver headlines are cross-checked against supplied feeds and observed metrics before display.</div>
    </section>
  )
}

function AccuracyLedger({ response }: { response: PredictionResponse }) {
  return (
    <section className="panel ledger-panel">
      <div className="section-heading compact-heading">
        <div><div className="eyebrow"><span className="eyebrow-index">05</span> Model validation</div><h2>Accuracy ledger</h2></div>
        <span className="walkforward-pill"><ShieldCheck size={12} /> WALK-FORWARD</span>
      </div>
      <p className="ledger-intro">One-session predictions replayed chronologically against observed closes. The 30-session row reports MAPE, directional win rate and RMSE after the EMA(200) warm-up.</p>
      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead><tr><th>LOOKBACK</th><th>OBS.</th><th>MAPE</th><th>DIR. WIN</th><th>RMSE · USD/OZ</th></tr></thead>
          <tbody>{response.backtest.map((item) => (
            <tr key={item.label} className={item.days === 30 ? 'ledger-30d-row' : ''}>
              <td><b>{item.label}</b></td>
              <td>{item.observations}</td>
              <td className={item.mapePct === null ? 'muted-text' : item.mapePct < 1 ? 'positive-text' : ''}>{item.mapePct === null ? '—' : `${item.mapePct.toFixed(3)}%`}</td>
              <td>{item.directionalWinRatePct === null ? '—' : `${item.directionalWinRatePct.toFixed(1)}%`}</td>
              <td>{item.rmseUsd === null ? '—' : `$${item.rmseUsd.toFixed(2)}`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="ledger-method"><CircleHelp size={13} />Directional hit rate compares predicted and realized next-session signs; RMSE is in USD per troy ounce. All metrics are descriptive, not predictive; sample counts are limited by the EMA(200) warm-up.</div>
    </section>
  )
}

function SliderControl({
  label, value, min, max, step, onChange, format, description,
}: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string; description: string
}) {
  return (
    <label className="slider-control">
      <span className="slider-head"><span>{label}</span><b>{format(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="slider-scale"><span>{format(min)}</span><span>{format(max)}</span></span>
      <small>{description}</small>
    </label>
  )
}

function StressTester({
  response,
  scenario,
  onScenario,
  result,
  onAnalyze,
  analyzing,
  providerConfigured,
  error,
}: {
  response: PredictionResponse | null
  scenario: ScenarioInput
  onScenario: (next: ScenarioInput) => void
  result: ReturnType<typeof calculateScenarioForecast> | null
  onAnalyze: () => void
  analyzing: boolean
  providerConfigured: boolean
  error: string | null
}) {
  const market = response?.market
  const manualHeadline = scoreHeadline(scenario.headline)
  const update = (key: keyof ScenarioInput, value: number | string) => onScenario({ ...scenario, [key]: value } as ScenarioInput)
  const basePrice = market?.spot ?? null
  const projected = result?.global.predictedXauUsd ?? null
  const localRate = result?.nepal?.predicted24kTolaNpr ?? null
  return (
    <section className="panel simulator-panel" id="simulator">
      <div className="section-heading simulator-heading">
        <div><div className="eyebrow"><span className="eyebrow-index">02</span> What-if / stress lab</div><h2>Move the inputs. <span className="heading-dot">Reprice</span> in real time.</h2><p>Bounded scenario shocks over the live baseline; FX, duty and spread re-run through the Nepal parity formula.</p></div>
        <div className="simulator-badge"><SlidersHorizontal size={15} />SCENARIO ENGINE</div>
      </div>

      <div className="simulator-layout">
        <div className="simulator-controls">
          <div className="control-section-title"><span>01</span><b>Headline & risk</b><i /> <span className="control-live">LOCAL RECALC</span></div>
          <label className="headline-input-wrap"><span>BREAKING HEADLINE / YOUR WHAT-IF</span><textarea maxLength={500} placeholder="Paste a headline, e.g. central-bank purchases accelerate…" value={scenario.headline} onChange={(event) => update('headline', event.target.value)} /></label>
          <div className="headline-score-row"><span className={`headline-impact ${impactClass(manualHeadline.impact)}`}><i />{manualHeadline.impact} · {formatSigned(manualHeadline.score, 1)} pts</span><span className="local-rules-label">RULES-BASED PREVIEW</span></div>
          <SliderControl label="War / conflict escalation" value={scenario.warEscalation} min={-5} max={5} step={0.5} onChange={(value) => update('warEscalation', value)} format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`} description="Escalation bids safe-haven demand; de-escalation removes premium. Liquidity shocks can counter it." />

          <div className="control-section-title control-divider"><span>02</span><b>Macro & domestic pass-through</b><i /></div>
          <div className="two-slider-grid">
            <SliderControl label="DXY shock" value={scenario.dxyShiftPct} min={-3} max={3} step={0.1} onChange={(value) => update('dxyShiftPct', value)} format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`} description="Change in dollar index." />
            <SliderControl label="Fed / 10Y shock" value={scenario.yieldShiftBps} min={-100} max={100} step={5} onChange={(value) => update('yieldShiftBps', value)} format={(value) => `${value > 0 ? '+' : ''}${Math.round(value)} bp`} description="Rate-expectation / 10Y yield move; nominal proxy unless TIPS data is configured." />
          </div>
          <label className="fx-input-control"><span><b>USD/NPR conversion</b><small>{market?.macro.usdNprParity.value !== null && market?.macro.usdNprParity.value !== undefined ? `${market.macro.usdNprParity.source} · ${market.macro.usdNprParity.asOf ? formatNptTime(market.macro.usdNprParity.asOf) : 'timestamp n/a'}` : 'No fresh quote · enter an explicit scenario assumption'}</small></span><div><span>Rs</span><input type="number" min="70" max="250" step="0.01" value={scenario.usdNpr || ''} placeholder="—" onChange={(event) => update('usdNpr', event.target.value === '' ? 0 : Number(event.target.value))} /></div></label>
          <div className="two-slider-grid tax-sliders">
            <SliderControl label="Customs duty" value={scenario.customsDutyPct} min={0} max={30} step={0.5} onChange={(value) => update('customsDutyPct', value)} format={(value) => `${value.toFixed(1)}%`} description="Default 15% · adjustable assumption." />
            <SliderControl label="Bank + freight" value={scenario.bankFreightPct} min={0} max={5} step={0.1} onChange={(value) => update('bankFreightPct', value)} format={(value) => `${value.toFixed(1)}%`} description="Default 1.0% · configurable premium." />
          </div>
          <div className="simulator-note"><CircleHelp size={13} />DXY / yield shocks affect global XAU. USD/NPR, duty and local spread affect Nepal parity. Slider impacts are scenario sensitivities, not a fitted causal model.</div>
        </div>

        <div className="scenario-output">
          <div className="scenario-output-head"><span><Zap size={14} /> LIVE SCENARIO</span><span className="scenario-base-source">vs current observed market</span><span className={`scenario-constraint-pill ${result?.severeEventException ? 'severe-exception' : ''}`}>{result?.severeEventException ? 'SEVERE EVENT · ±8% CAP' : result ? `ATR CAP · ±${result.atrMoveCapPct.toFixed(2)}%` : 'ATR CONSTRAINT · WAITING'}</span></div>
          <div className="scenario-global-block"><span>GLOBAL / TOMORROW BASE</span><div className="scenario-global-value">{formatUsd(projected)}</div><div className={`scenario-delta ${result ? result.global.changePct >= 0 ? 'positive' : 'negative' : ''}`}>{result ? `${formatSigned(result.global.changeUsd, 2)} · ${formatSigned(result.global.changePct, 2, '%')}` : '—'}</div><div className="scenario-market-compare"><span>Observed now</span><b>{formatUsd(basePrice)}</b></div></div>
          <div className="scenario-local-block"><div className="scenario-local-title"><span>NEPAL / 24K CHHAPAWAL</span><span>PER TOLA</span></div><b>{formatNpr(localRate)}</b><div className={`scenario-delta ${result?.nepal?.expectedChangeTolaNpr === null || result?.nepal?.expectedChangeTolaNpr === undefined ? '' : result.nepal.expectedChangeTolaNpr >= 0 ? 'positive' : 'negative'}`}>{result?.nepal?.expectedChangeTolaNpr === null || result?.nepal?.expectedChangeTolaNpr === undefined ? 'Local baseline unavailable' : `${formatSigned(result.nepal.expectedChangeTolaNpr, 0)} NPR vs official today`}</div><div className="scenario-market-compare"><span>{market?.nepal.rateStale ? 'Latest fixing' : 'Official today'}</span><b>{formatNpr(market?.nepal.rate24kTola)}</b></div></div>
          <div className="scenario-contribution-list">
            <div><span>Headline + conflict</span><b className={result ? scoreClass(result.contributions.headlineAndConflictPct) : ''}>{result ? formatSigned(result.contributions.headlineAndConflictPct, 3, '%') : '—'}</b></div>
            <div><span>DXY shock</span><b className={result ? scoreClass(result.contributions.dxyPct) : ''}>{result ? formatSigned(result.contributions.dxyPct, 3, '%') : '—'}</b></div>
            <div><span>Yield shock</span><b className={result ? scoreClass(result.contributions.yieldPct) : ''}>{result ? formatSigned(result.contributions.yieldPct, 3, '%') : '—'}</b></div>
            <div><span>Selected live / simulated event</span><b className={result ? scoreClass(result.contributions.eventOverlayPct) : ''}>{result ? formatSigned(result.contributions.eventOverlayPct, 3, '%') : '—'}</b></div>
            <div className="contribution-total"><span>Total overlay</span><b>{result ? formatSigned(result.contributions.totalScenarioPct, 3, '%') : '—'}</b></div>
          </div>
          <button className="button button-ai scenario-ai-button" onClick={onAnalyze} disabled={analyzing || !response}>
            {analyzing ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
            {analyzing ? 'Analyzing market…' : providerConfigured ? 'Run provider analysis' : 'Analyze with rules engine'}
            {!analyzing && <ArrowRight size={14} />}
          </button>
          {!providerConfigured && <div className="scenario-ai-hint">Without server-side provider keys, this uses the deterministic rules engine.</div>}
          {error && <div className="scenario-error"><AlertCircle size={13} />{error}</div>}
        </div>
      </div>
    </section>
  )
}

type DashboardView = 'overview' | 'analytics' | 'stress' | 'events'

export default function AurumDashboard() {
  const [dashboardView, setDashboardView] = useState<DashboardView>('overview')
  const [accuracyOpen, setAccuracyOpen] = useState(false)
  const [paritySettingsOpen, setParitySettingsOpen] = useState(false)
  const [manualRatesOpen, setManualRatesOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [freshnessOpen, setFreshnessOpen] = useState(false)
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const [language, setLanguage] = useState<'en' | 'ne'>('en')
  const [adminAuthenticated, setAdminAuthenticated] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(false)
  const [storageHealth, setStorageHealth] = useState<{ backend: string; writable: boolean; ephemeral: boolean; warning: string | null } | null>(null)
  const [alarmSaveError, setAlarmSaveError] = useState<string | null>(null)
  const [response, setResponse] = useState<PredictionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const [clock, setClock] = useState<number | null>(null)
  const [scenario, setScenario] = useState<ScenarioInput>(() => defaultScenarioInput(null))
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null)
  const [alarmThreshold, setAlarmThreshold] = useState(2_000)
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [soundMuted, setSoundMuted] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [activeAlarm, setActiveAlarm] = useState<AlarmNotice | null>(null)
  const [simulatedEvent, setSimulatedEvent] = useState<LiveEvent | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const didInitScenario = useRef(false)
  const refreshRef = useRef<(force?: boolean) => Promise<void>>(async () => {})
  const audioContextRef = useRef<AudioContext | null>(null)
  const soundMutedRef = useRef(false)
  const alarmTimerRef = useRef<number | null>(null)
  const alarmLatchRef = useRef<string | null>(null)

  const persistAlarmSettings = useCallback(async (overrides: Partial<{ thresholdNprPerTola: number; enabled: boolean; muted: boolean }> = {}) => {
    if (!adminAuthenticated) return
    setAlarmSaveError(null)
    try {
      const response = await fetch('/api/alarm-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ thresholdNprPerTola: overrides.thresholdNprPerTola ?? alarmThreshold, enabled: overrides.enabled ?? alarmEnabled, muted: overrides.muted ?? soundMuted }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Alarm settings could not be saved.')
    } catch (cause) { setAlarmSaveError(cause instanceof Error ? cause.message : 'Alarm settings could not be saved.') }
  }, [adminAuthenticated, alarmThreshold, alarmEnabled, soundMuted])

  const refresh = useCallback(async (force = false) => {
    if (!response && !force) setLoading(true)
    else setRefreshing(true)
    try {
      const result = await fetch(`/api/predict${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const json = await result.json()
      if (!result.ok) throw new Error(json?.error ?? `Market request failed (${result.status}).`)
      const prediction = json as PredictionResponse
      setResponse(prediction)
      setError(null)
      if (!didInitScenario.current) {
        const fx = prediction.market.macro.usdNprParity.value
        setScenario({ ...defaultScenarioInput(fx), customsDutyPct: prediction.paritySettings?.customsDutyPct ?? 15, bankFreightPct: prediction.paritySettings?.vatOtherLevyPct ?? 1 })
        didInitScenario.current = true
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load current market feeds.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [response])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    const tick = () => setClock(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    try { if (localStorage.getItem('aurum.language') === 'ne') { activeUiLanguage = 'ne'; setLanguage('ne') } } catch { /* Keep the default English interface. */ }
  }, [])

  const changeLanguage = (next: 'en' | 'ne') => {
    activeUiLanguage = next
    setLanguage(next)
    try { localStorage.setItem('aurum.language', next) } catch { /* Keep the in-memory language choice. */ }
  }

  useEffect(() => {
    void Promise.all([
      fetch('/api/admin/session', { cache: 'no-store' }).then((response) => response.json()).catch(() => null),
      fetch('/api/health', { cache: 'no-store' }).then((response) => response.json()).catch(() => null),
      fetch('/api/alarm-settings', { cache: 'no-store' }).then((response) => response.json()).catch(() => null),
    ]).then(([session, health, alarm]) => {
      if (session) { setAdminConfigured(Boolean(session.configured)); setAdminAuthenticated(Boolean(session.authenticated)) }
      const storage = health?.storage
      if (storage) setStorageHealth(storage)
      else setStorageHealth({ backend: 'unavailable', writable: false, ephemeral: true, warning: 'Storage health could not be reached.' })
      const settings = alarm?.settings
      if (settings) {
        setAlarmThreshold(settings.thresholdNprPerTola)
        setAlarmEnabled(settings.enabled)
        setSoundMuted(settings.muted)
        soundMutedRef.current = settings.muted
      }
    })
    if (!('Notification' in window)) setNotificationPermission('unsupported')
    else setNotificationPermission(Notification.permission)
    return () => {
      if (alarmTimerRef.current !== null) window.clearTimeout(alarmTimerRef.current)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close()
    }
  }, [])

  useEffect(() => {
    void refreshRef.current(false)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current(false)
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const runAnalysis = useCallback(async (headline = scenario.headline) => {
    setAnalysisBusy(true)
    setScenarioError(null)
    setAnalysisNotice(null)
    try {
      // Provider selection is server-side only; the app falls back to its rules engine without env keys.
      const result = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ headline }),
      })
      const json = await result.json()
      if (!result.ok) throw new Error(json?.error ?? `Analysis request failed (${result.status}).`)
      const prediction = json as PredictionResponse
      setResponse(prediction)
      if (prediction.analysisMode !== 'rules-based') {
        setAnalysisNotice(`AI-assisted forecast received from ${prediction.analysisMode}. Nepal prices were recalculated with the local parity engine.`)
      } else {
        setAnalysisNotice('Rules-based analysis complete. Configure a provider key in server environment variables to enable model-generated analysis.')
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Analysis request failed.'
      setScenarioError(message)
      setAnalysisNotice(message)
    } finally {
      setAnalysisBusy(false)
    }
  }, [scenario.headline])

  const playAlarmTone = useCallback((direction: 'surge' | 'drop') => {
    if (soundMutedRef.current || typeof window === 'undefined') return
    const AudioConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioConstructor) return
    let context = audioContextRef.current
    if (!context) {
      context = new AudioConstructor()
      audioContextRef.current = context
    }
    const schedule = () => {
      if (context?.state !== 'running' || soundMutedRef.current) return
      const rising = direction === 'surge'
      const notes = rising ? [660, 830, 1046] : [523, 392, 294]
      notes.forEach((frequency, index) => {
        const oscillator = context!.createOscillator()
        const gain = context!.createGain()
        const startAt = context!.currentTime + index * 0.17
        oscillator.type = rising ? 'sine' : 'triangle'
        oscillator.frequency.setValueAtTime(frequency, startAt)
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.exponentialRampToValueAtTime(0.13, startAt + 0.018)
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.15)
        oscillator.connect(gain)
        gain.connect(context!.destination)
        oscillator.start(startAt)
        oscillator.stop(startAt + 0.16)
      })
    }
    if (context.state === 'running') schedule()
    else void context.resume().then(schedule).catch(() => undefined)
  }, [])

  const showDesktopNotification = useCallback((title: string, body: string) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
      new Notification(title, { body, tag: 'aurum-nepal-price-move', silent: true })
    } catch {
      // Some browsers suppress desktop notifications when the tab is not eligible.
    }
  }, [])

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return false
    }
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      setNotificationPermission(permission)
      return permission === 'granted'
    } catch {
      setNotificationPermission('denied')
      return false
    }
  }, [])

  const showAlarmNotice = useCallback((direction: AlarmDirection, amount: number, source: AlarmSource) => {
    const notice: AlarmNotice = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, direction, source, amount, threshold: alarmThreshold, createdAt: Date.now() }
    setActiveAlarm(notice)
    if (alarmTimerRef.current !== null) window.clearTimeout(alarmTimerRef.current)
    alarmTimerRef.current = window.setTimeout(() => setActiveAlarm(null), 14_000)
    if (direction === 'test') {
      playAlarmTone('surge')
      window.setTimeout(() => playAlarmTone('drop'), 470)
      if (notificationPermission === 'granted') showDesktopNotification('Aurum alarm self-test', '+Rs 2,000/tola surge and −Rs 2,000/tola drop tones tested.')
      return
    }
    playAlarmTone(direction)
    const title = source === 'simulated' ? 'SIMULATED crisis price alarm'
      : source === 'daily' ? direction === 'surge' ? 'Official fixing surge alarm' : 'Official fixing drop alarm'
        : direction === 'surge' ? 'Gold price surge alarm' : 'Gold price drop alarm'
    const body = `${direction === 'surge' ? '+' : '−'}Rs ${Math.round(Math.abs(amount)).toLocaleString('en-IN')}/tola · ±Rs ${alarmThreshold.toLocaleString('en-IN')} threshold · ${alarmSourceLabel(source)}`
    showDesktopNotification(title, body)
  }, [alarmThreshold, notificationPermission, playAlarmTone, showDesktopNotification])

  const runAlarmTest = useCallback(async () => {
    if (!adminAuthenticated) return
    const alreadyAllowed = typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
    showAlarmNotice('test', 2_000, 'test')
    if (!alreadyAllowed) {
      const granted = await requestNotificationPermission()
      if (granted) showDesktopNotification('Aurum alarm self-test', '+Rs 2,000/tola surge and −Rs 2,000/tola drop tones tested.')
    }
  }, [adminAuthenticated, requestNotificationPermission, showAlarmNotice, showDesktopNotification])

  const updateAlarmThreshold = (value: number) => {
    if (!adminAuthenticated || !Number.isFinite(value)) return
    const next = Math.max(500, Math.min(100_000, Math.round(value / 100) * 100))
    setAlarmThreshold(next)
  }

  const toggleAlarm = () => {
    if (!adminAuthenticated) return
    const next = !alarmEnabled
    setAlarmEnabled(next)
    if (!next) alarmLatchRef.current = null
    void persistAlarmSettings({ enabled: next })
    if (next) void requestNotificationPermission()
  }

  const toggleSound = () => {
    if (!adminAuthenticated) return
    const next = !soundMuted
    soundMutedRef.current = next
    setSoundMuted(next)
    if (next && audioContextRef.current?.state === 'running') void audioContextRef.current.suspend().catch(() => undefined)
    void persistAlarmSettings({ muted: next })
  }

  const baseForecast = useMemo(() => finalGlobal(response), [response])
  const scoreForManualHeadline = useMemo(() => scoreHeadline(scenario.headline).score, [scenario.headline])
  const eventOverlay = useMemo(() => resolveEventOverlay(response?.events ?? [], selectedEventId, simulatedEvent), [response?.events, selectedEventId, simulatedEvent])
  const scenarioForecast = useMemo(() => {
    if (!response || !baseForecast) return null
    return calculateScenarioForecast({
      market: response.market,
      forecast: baseForecast,
      analysisScores: {
        geopolitical: response.analysis?.geopolitical_risk_score ?? 0,
        macroYield: response.analysis?.macro_yield_score ?? 0,
        technical: response.analysis?.technical_momentum_score ?? response.market.indicators?.technicalMomentumScore ?? 0,
      },
      headlineScore: scoreForManualHeadline,
    }, scenario, scoreForManualHeadline, eventOverlay.globalImpactPct, eventOverlay.severeEventException, response.paritySettings)
  }, [baseForecast, response, scenario, scoreForManualHeadline, eventOverlay])

  const today = clock === null ? null : new Date(clock)
  const currentNpt = today ? nptParts(today) : null
  // A UTC date addition handles month/year rollover without relying on the browser timezone.
  const tomorrowDateParts = currentNpt ? (() => {
    const date = new Date(Date.UTC(currentNpt.year, currentNpt.month - 1, currentNpt.day + 1, 12))
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
  })() : null
  const activeTiming = clock === null ? null : getNepalFixingTiming(new Date(clock), response?.nepalTiming?.holidayDates ?? [])
  const nextCountdown = activeTiming ? formatCountdown(Date.parse(activeTiming.targetAt) - clock!) : '—'
  const localNowLabel = today ? `${nepaliDigits(formatAdDate(today), language)} · ${bsLabelForNptDate(currentNpt!.year, currentNpt!.month, currentNpt!.day, language)} ${language === 'ne' ? 'वि.सं.' : 'BS'}` : (language === 'ne' ? 'नेपाल समय लोड हुँदै…' : 'Loading NPT clock…')
  const tomorrowLabel = tomorrowDateParts
    ? `${nepaliDigits(formatAdDate(new Date(Date.UTC(tomorrowDateParts.year, tomorrowDateParts.month - 1, tomorrowDateParts.day, 12))), language)} · ${bsLabelForNptDate(tomorrowDateParts.year, tomorrowDateParts.month, tomorrowDateParts.day, language)} ${language === 'ne' ? 'वि.सं.' : 'BS'}`
    : language === 'ne' ? 'भोलिको दर पूर्वानुमान' : 'Tomorrow’s rate forecast'
  const market = response?.market ?? null
  const analysis = response?.analysis ?? null
  const selectedGlobal = scenarioForecast?.global ?? baseForecast
  const selectedLiveEvent = response?.events.find((event) => event.id === selectedEventId && !event.isSimulated) ?? null
  const scenarioInputsActive = Boolean(scenario.warEscalation || scenario.dxyShiftPct || scenario.yieldShiftBps || scenario.headline.trim() || simulatedEvent || eventOverlay.globalImpactPct !== 0 || scenario.customsDutyPct !== (response?.paritySettings?.customsDutyPct ?? 15) || scenario.bankFreightPct !== (response?.paritySettings?.vatOtherLevyPct ?? 1) || (scenario.usdNpr > 0 && scenario.usdNpr !== market?.macro.usdNprParity.value))
  const selectedProbabilities = useMemo(() => response ? (!scenarioInputsActive && response.probabilisticForecast ? response.probabilisticForecast : buildProbabilisticForecast(selectedGlobal, scenarioForecast?.nepal ?? response.defaultNepalForecast, {
    xauUsd: response.fixingWindow?.startObservation?.value ?? response.market.spot,
    nepal24k: response.market.nepal.rate24kTola,
    nepal22k: response.market.nepal.rate22kTola,
    tejabi: response.market.nepal.rateTejabiTola,
  })) : null, [response, selectedGlobal, scenarioForecast?.nepal, scenarioInputsActive])
  const radarEvents = useMemo(() => simulatedEvent ? [simulatedEvent, ...(response?.events ?? [])] : response?.events ?? [], [response?.events, simulatedEvent])
  const nptDateLabel = currentNpt ? `${currentNpt.year}-${String(currentNpt.month).padStart(2, '0')}-${String(currentNpt.day).padStart(2, '0')}` : null
  const dailyOfficialMove = market && nptDateLabel && market.nepal.rateDate === nptDateLabel && !market.nepal.rateStale && market.nepal.rate24kTola !== null && market.nepal.previous24kTola !== null
    ? market.nepal.rate24kTola - market.nepal.previous24kTola
    : null
  const alarmCandidates = useMemo(() => [
    { source: 'simulated' as const, changeNprPerTola: simulatedEvent ? scenarioForecast?.nepal?.expectedChangeTolaNpr ?? null : null },
    { source: 'event' as const, changeNprPerTola: selectedLiveEvent ? scenarioForecast?.nepal?.expectedChangeTolaNpr ?? null : null },
    { source: 'daily' as const, changeNprPerTola: dailyOfficialMove },
    { source: 'scenario' as const, changeNprPerTola: scenarioInputsActive && !simulatedEvent && !selectedLiveEvent ? scenarioForecast?.nepal?.expectedChangeTolaNpr ?? null : null },
    { source: 'forecast' as const, changeNprPerTola: response?.defaultNepalForecast?.expectedChangeTolaNpr ?? null },
  ], [dailyOfficialMove, response?.defaultNepalForecast?.expectedChangeTolaNpr, scenarioForecast?.nepal?.expectedChangeTolaNpr, scenarioInputsActive, selectedLiveEvent, simulatedEvent])
  const priceMoveAlarm = useMemo(() => selectPriceMoveAlarm(alarmCandidates, alarmThreshold), [alarmCandidates, alarmThreshold])
  const quoteFresh = market?.spotStale === false
  const nextCountDate = activeTiming ? formatAdDate(new Date(activeTiming.targetAt)) : ''
  const aiKeyAvailable = Boolean(response && response.analysisMode !== 'rules-based')

  useEffect(() => {
    if (!radarEvents.length) {
      if (selectedEventId !== null) setSelectedEventId(null)
      return
    }
    if (selectedEventId && !radarEvents.some((event) => event.id === selectedEventId)) setSelectedEventId(null)
  }, [radarEvents, selectedEventId])

  useEffect(() => {
    if (!alarmEnabled) {
      alarmLatchRef.current = null
      return
    }
    if (!priceMoveAlarm) {
      alarmLatchRef.current = null
      return
    }
    const source = priceMoveAlarm.source as AlarmSource
    const identity = source === 'simulated' ? simulatedEvent?.id ?? '' : source === 'event' ? selectedLiveEvent?.id ?? '' : ''
    const latch = `${source}:${priceMoveAlarm.direction}:${Math.round(priceMoveAlarm.changeNprPerTola)}:${identity}`
    if (alarmLatchRef.current === latch) return
    alarmLatchRef.current = latch
    showAlarmNotice(priceMoveAlarm.direction, priceMoveAlarm.changeNprPerTola, source)
  }, [alarmEnabled, priceMoveAlarm, selectedLiveEvent, simulatedEvent, showAlarmNotice])

  const dxyTone = market?.macro.dxy.changePct === null || market?.macro.dxy.changePct === undefined ? 'neutral' : market.macro.dxy.changePct > 0 ? 'negative' : 'positive'
  const rateTrend = market?.macro.nominal10y.change
  const rateTone = rateTrend === null || rateTrend === undefined ? 'neutral' : rateTrend > 0 ? 'negative' : 'positive'
  const brentTone = market?.macro.brent.changePct === null || market?.macro.brent.changePct === undefined ? 'neutral' : market.macro.brent.changePct > 0 ? 'positive' : 'negative'

  return (
    <main data-language={language} className={`app-shell h-screen w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100 p-2 gap-5 view-${dashboardView}`}>
      <header className="topbar">
        <a className="brand-lockup" href="#top" aria-label="Aurum terminal home">
          <span className="brand-mark"><span>A</span><i /></span>
          <span className="brand-word">AURUM<span>/</span>NP</span>
          <span className="brand-divider" />
          <span className="brand-caption">BULLION INTELLIGENCE</span>
        </a>
        <nav className="top-nav" aria-label="Dashboard views">
          <button type="button" className={dashboardView === 'overview' ? 'active' : ''} aria-pressed={dashboardView === 'overview'} onClick={() => setDashboardView('overview')}>{language === 'ne' ? 'सारांश' : 'Overview'}</button>
          <button type="button" className={dashboardView === 'analytics' ? 'active' : ''} aria-pressed={dashboardView === 'analytics'} onClick={() => setDashboardView('analytics')}>{language === 'ne' ? 'विश्लेषण' : 'Analytics'}</button>
          <button type="button" className={dashboardView === 'stress' ? 'active' : ''} aria-pressed={dashboardView === 'stress'} onClick={() => setDashboardView('stress')}>{language === 'ne' ? 'तनाव परीक्षण' : 'Stress lab'}</button>
          <button type="button" className={dashboardView === 'events' ? 'active' : ''} aria-pressed={dashboardView === 'events'} onClick={() => setDashboardView('events')}>{language === 'ne' ? 'घटना परीक्षण' : 'Event lab'}</button>
          <button type="button" onClick={() => setAccuracyOpen(true)} aria-haspopup="dialog"><Gauge size={12} />{language === 'ne' ? 'शुद्धता' : 'Accuracy'}</button>
          <button type="button" onClick={() => setParitySettingsOpen(true)} aria-haspopup="dialog"><SlidersHorizontal size={12} />{language === 'ne' ? 'समता' : 'Parity'}</button>
        </nav>
        <div className="top-actions">
          <div className={`live-state ${market?.status === 'live' && quoteFresh ? 'live' : market?.status === 'unavailable' ? 'offline' : 'partial'}`}><i />{!market ? (language === 'ne' ? 'जोडिँदै' : 'CONNECTING') : market.status === 'live' && quoteFresh ? (language === 'ne' ? 'लाइभ फिड' : 'LIVE FEED') : market.status === 'unavailable' ? (language === 'ne' ? 'अफलाइन' : 'OFFLINE') : (language === 'ne' ? 'आंशिक फिड' : 'PARTIAL FEED')}</div>
          <div className="stage3-actions-wrap">
            <button className="icon-button stage3-menu-toggle" type="button" aria-label="Open rates, tools, and language menu" aria-expanded={quickActionsOpen} title={language === 'ne' ? 'दर, उपकरण र भाषा' : 'Rates, tools & language'} onClick={() => setQuickActionsOpen((value) => !value)}><MoreHorizontal size={16} /></button>
            {quickActionsOpen && <div className="stage3-quick-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setManualRatesOpen(true); setQuickActionsOpen(false) }}><FilePlus2 size={14} /><span>{language === 'ne' ? 'म्यानुअल आधिकारिक दर' : 'Manual official rates'}</span></button>
              <button type="button" role="menuitem" onClick={() => { setToolsOpen(true); setQuickActionsOpen(false) }}><Calculator size={14} /><span>{language === 'ne' ? 'क्याल्कुलेटर र इतिहास' : 'Calculator & history'}</span></button>
              <button type="button" role="menuitem" onClick={() => { setFreshnessOpen(true); setQuickActionsOpen(false) }}><Database size={14} /><span>{language === 'ne' ? 'फिड ताजापन र स्रोत' : 'Feed freshness & sources'}</span></button>
              <div className="quick-menu-separator" />
              <div className="quick-language-row"><span>{language === 'ne' ? 'भाषा' : 'LANGUAGE'}</span><div><button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'selected' : ''} onClick={() => changeLanguage('en')}>EN</button><button type="button" aria-pressed={language === 'ne'} className={language === 'ne' ? 'selected' : ''} onClick={() => changeLanguage('ne')}>नेपाली</button></div></div>
              <small className="quick-menu-date-note">{language === 'ne' ? 'बीएस मिति र नेपाली अंक सक्षम' : 'BS dates and Nepali numerals available'}</small>
            </div>}
          </div>
          <button className="icon-button stage1-action" onClick={() => setAccuracyOpen(true)} aria-label="Open prediction accuracy" title="Prediction accuracy"><Gauge size={15} /></button>
          <button className="icon-button stage1-action" onClick={() => setParitySettingsOpen(true)} aria-label="Open Nepal parity settings" title="Parity settings"><SlidersHorizontal size={15} /></button>
          <button className="header-alarm-test" onClick={() => void runAlarmTest()} disabled={!adminAuthenticated} aria-label="Test surge and drop alarms at plus or minus 2,000 Nepalese rupees per tola" title={adminAuthenticated ? 'Test both distinct alarm tones and desktop notification' : 'Admin sign-in required'}><BellRing size={14} /><span>TEST ±2K</span></button>
          <button className={`icon-button header-sound-toggle ${soundMuted ? 'muted' : ''}`} onClick={toggleSound} disabled={!adminAuthenticated} aria-label={soundMuted ? 'Unmute alarm sound' : 'Mute alarm sound'} aria-pressed={soundMuted} title={soundMuted ? 'Alarm sound muted' : 'Admin sign-in required'}>{soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
          <button className="icon-button refresh-button" onClick={() => void refresh(true)} disabled={!adminAuthenticated || loading || refreshing} aria-label="Refresh market data" title={adminAuthenticated ? 'Force-refresh all feeds' : 'Admin sign-in required to force-refresh feeds'}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></button>
          <AdminAccess configured={adminConfigured} authenticated={adminAuthenticated} onSessionChange={(authenticated, configured) => { setAdminAuthenticated(authenticated); if (configured !== undefined) setAdminConfigured(configured) }} />
        </div>
      </header>

      {storageHealth && (storageHealth.ephemeral || !storageHealth.writable) && <div className={`storage-warning-banner ${storageHealth.writable ? '' : 'storage-unwritable'}`} role="status"><Database size={15} /><span><b>{storageHealth.writable ? 'STORAGE WARNING' : 'STORAGE UNAVAILABLE'}</b> {storageHealth.warning ?? (storageHealth.ephemeral ? 'Data may be lost when this host restarts.' : 'Persistent changes may fail.')}{storageHealth.backend !== 'turso' && storageHealth.writable && ' Configure Turso or set AURUM_STORAGE_PERSISTENT=true only when using a durable mounted volume.'}</span></div>}
      {activeAlarm && <div className="alarm-banner-shell"><AlarmBanner notice={activeAlarm} onDismiss={() => { setActiveAlarm(null); if (alarmTimerRef.current !== null) window.clearTimeout(alarmTimerRef.current) }} /></div>}
      <section className="alarm-controls-shell" aria-label="Nepal gold price alarm controls">
        <div className="alarm-controls-inner">
          <div className="alarm-status-block"><span className={`alarm-status-pill ${alarmEnabled ? 'armed' : 'disarmed'}`}><i />{alarmEnabled ? 'ALARM ARMED' : 'ALARM OFF'}</span><b>±Rs {alarmThreshold.toLocaleString('en-IN')} / TOLA</b><small>Daily observed or predicted move vs official 24K fixing</small></div>
          <label className="alarm-threshold-control"><span>TRIGGER</span><input type="number" min={500} max={100_000} step={100} value={alarmThreshold} disabled={!adminAuthenticated} onChange={(event) => updateAlarmThreshold(Number(event.target.value))} onBlur={() => void persistAlarmSettings({ thresholdNprPerTola: alarmThreshold })} aria-label="Price alarm threshold in Nepalese rupees per tola" /><small>NPR / TOLA</small></label>
          <button className={`alarm-arm-button ${alarmEnabled ? 'armed' : ''}`} onClick={toggleAlarm} disabled={!adminAuthenticated} aria-pressed={alarmEnabled}><Bell size={14} />{alarmEnabled ? 'ARMED' : 'ARM ALARM'}</button>
          <div className={`notification-permission permission-${notificationPermission}`} title="Desktop notification permission"><span>DESKTOP NOTIFICATIONS</span><b>{notificationPermission === 'granted' ? 'ALLOWED' : notificationPermission === 'denied' ? 'BLOCKED' : notificationPermission === 'unsupported' ? 'UNAVAILABLE' : 'ASK ON TEST'}</b></div>
        </div>
        {!adminAuthenticated && <div className="alarm-readonly-note">Alarm settings are administrator-managed and shared across visitors.</div>}
        {alarmSaveError && <div className="alarm-readonly-note alarm-save-error">{alarmSaveError}</div>}
      </section>

      <section className="ticker-wrap" aria-label="Live market ticker">
        <div className="ticker-rail"><span className="ticker-label"><Radio size={12} /><i />MARKET TAPE</span>
          <TickerItem label="XAU / USD SPOT" value={formatUsd(market?.spot)} meta={market?.spotStale ? 'STALE · LAST OBSERVATION' : `MID · ${formatNptTime(market?.spotAsOf)}`} tone="gold" icon={<Globe2 size={12} />} stale={market?.spotStale} />
          <TickerItem label={market?.nepal.rate24kManualEntry ? 'NEPAL · 24K MANUAL' : market?.nepal.rateStale ? 'NEPAL · 24K LAST FIX' : 'NEPAL · 24K OFFICIAL'} value={formatNpr(market?.nepal.rate24kTola)} meta={market?.nepal.rateDate ? `${market.nepal.rateSource} · ${market.nepal.rateDate}` : 'FENEGOSIDA · DATE MISSING'} tone="gold" icon={<Landmark size={12} />} stale={market?.nepal.rateStale} />
          <TickerItem label={`TEJABI · ${((market?.nepal.tejabiRatioState?.ratio ?? 0.9915) * 100).toFixed(2)}% RATIO`} value={formatNpr(market?.nepal.rateTejabiTola)} meta={market?.nepal.rateTejabiManualEntry ? 'MANUAL ENTRY · FENEGOSIDA TRANSCRIPTION' : market?.nepal.rateTejabiOfficial ? 'FENEGOSIDA · SEPARATE QUOTE' : `DERIVED · 24K × ${market?.nepal.tejabiRatioState?.source ?? 'manual'} RATIO · NOT OFFICIAL`} tone="gold" stale={market?.nepal.rateStale} />
          <TickerItem label="22K · 91.67%" value={formatNpr(market?.nepal.rate22kTola)} meta="DERIVED PURITY ESTIMATE · NOT A FENEGOSIDA RATE" tone="neutral" stale={market?.nepal.rateStale} />
          <TickerItem label={market?.macro.usdNprParity.source.includes('official rates API') ? 'NRB USD SELL' : 'USD/NPR · FALLBACK'} value={formatNumber(market?.macro.usdNprParity.value, 3)} meta={market?.macro.usdNprParity.value == null ? 'NO FRESH PARITY FX' : `${market?.macro.usdNprParity.source} · ${market?.macro.usdNprParity.stale ? 'STALE' : 'NOT NRB'}`} tone="neutral" icon={<Scale size={12} />} stale={market?.macro.usdNprParity.stale} />
          <TickerItem label="DOLLAR INDEX" value={formatNumber(market?.macro.dxy.value, 2)} meta={formatSigned(market?.macro.dxy.changePct, 2, '%')} tone={dxyTone} icon={<Globe2 size={12} />} stale={market?.macro.dxy.stale} />
          <TickerItem label="US 10Y NOMINAL" value={market?.macro.nominal10y.value == null ? '—' : `${formatNumber(market?.macro.nominal10y.value, 3)}%`} meta="TIPS REAL YIELD SEPARATE" tone={rateTone} icon={<BarChart3 size={12} />} stale={market?.macro.nominal10y.stale} />
          <TickerItem label="BRENT CRUDE" value={market?.macro.brent.value == null ? '—' : `$${formatNumber(market?.macro.brent.value, 2)}`} meta={formatSigned(market?.macro.brent.changePct, 2, '%')} tone={brentTone} icon={<TrendingUp size={12} />} stale={market?.macro.brent.stale} />
          <TickerItem label="NEXT FENEGOSIDA FIXING" value={nextCountdown} meta={`${activeTiming?.mode === 'last-minute' ? 'LAST-MINUTE' : 'OVERNIGHT'} · ${nextCountDate ? `${nextCountDate} · ` : ''}11:00 AM NPT`} tone="gold" icon={<Clock3 size={12} />} />
        </div>
      </section>

      <div className="dashboard-wrap" id="top">
        <section className="welcome-row">
          <div className="welcome-copy">
            <div className="eyebrow intro-eyebrow"><span className="live-pulse" />{language === 'ne' ? 'परिमाणात्मक टर्मिनल' : 'QUANT TERMINAL'} <span className="eyebrow-separator">/</span> {language === 'ne' ? 'नेपाल स्थानीय आधार' : 'NEPAL LOCAL BASIS'} <span className="eyebrow-separator">/</span> NPT</div>
            <h1>{language === 'ne' ? <>सुनको मूल्य, <span>नेपालको आधारमा</span></> : <>Gold, with the <span>Nepal basis</span></>}<br className="desktop-break" /> {language === 'ne' ? 'स्पष्ट रूपमा।' : 'in view.'}</h1>
            <p>{language === 'ne' ? 'भोलिको विश्व बजार दिशालाई अर्को फेनेगोसीडा दरसँग जोडेर देखाइन्छ।' : 'Tomorrow’s global spot direction, translated to the next FENEGOSIDA benchmark.'}</p>
            <div className="calendar-row"><span><Clock3 size={13} />{language === 'ne' ? 'अहिले' : 'NOW'}</span><b>{localNowLabel}</b><i>·</i><span>{language === 'ne' ? 'दरको समय' : 'FIXING HORIZON'}</span><b>{tomorrowLabel}</b></div>
          </div>
          <div className="session-card">
            <div className="session-top"><span>SESSION STATUS</span><span className={`session-dot ${market?.status === 'live' ? 'good' : market?.status === 'unavailable' ? 'bad' : ''}`} /></div>
            <div className="session-value">{market?.status === 'live' ? 'DATA IN SYNC' : market?.status === 'unavailable' ? 'FEEDS UNAVAILABLE' : response ? 'PARTIAL COVERAGE' : 'CONNECTING FEEDS'}</div>
            <div className="session-divider" />
            <div className="session-meta"><span>LAST SNAPSHOT</span><b>{market ? formatNptTime(market.generatedAt) : '—'}</b></div>
            <div className="session-meta"><span>OBSERVATION AGE</span><b>{market ? humanAge(market.spotAsOf) : '—'}</b></div>
            <div className="session-meta"><span>FORECAST MODE</span><b>{response?.analysisMode === 'rules-based' ? 'QUANT + RULES' : response?.analysisMode ? `${response.analysisMode.toUpperCase()} + QUANT` : 'QUANTITATIVE'}</b></div>
          </div>
        </section>

        {error && <div className="alert-banner"><AlertCircle size={16} /><span>{error}</span><button onClick={() => void refresh(false)}>Retry <ArrowRight size={13} /></button></div>}
        {analysisNotice && <div className="notice-banner"><Sparkles size={14} /><span>{analysisNotice}</span><button aria-label="Dismiss notice" onClick={() => setAnalysisNotice(null)}><X size={14} /></button></div>}

        <section className="forecast-section" id="forecast">
          <div className="section-heading forecast-heading">
            <div><div className="eyebrow"><span className="eyebrow-index">01</span> {language === 'ne' ? 'पूर्वानुमान' : 'Forecast board'} <span className="eyebrow-separator">/</span> {language === 'ne' && activeTiming?.targetDate ? nepaliDigits(activeTiming.targetDate, language) : activeTiming?.targetDate ?? tomorrowLabel}</div><h2>{language === 'ne' ? 'भोलिको मूल्य, दुई बजारमा।' : 'Tomorrow, priced in two markets.'}</h2></div>
            <div className="forecast-heading-side">
              {response && <InstitutionalDemandCard response={response} />}
              <div className="forecast-board-meta"><span className="model-mode-dot" /><span>{response?.analysisStatus === 'ready' ? 'AI-ASSISTED' : response?.analysisStatus === 'fallback' ? 'RULES-BASED FALLBACK' : 'AWAITING HISTORY'}</span><span className="board-meta-separator">/</span><span>{activeTiming?.mode === 'last-minute' ? 'LAST-MINUTE' : 'OVERNIGHT'}</span><span className="not-advice-inline">Informational only. Not financial advice.</span></div>
            </div>
          </div>
          {loading && !response ? <div className="loading-panel"><span className="loader-orb"><Activity size={20} /></span><div><b>Connecting to live market feeds</b><span>Spot, official Nepal benchmark, FX and daily OHLC are being checked.</span></div><div className="loading-dots"><i /><i /><i /></div></div> : response ? <div className="forecast-grid">
            <GlobalForecastCard
              title="Spot gold"
              badge={market?.reliability?.global.state === 'low-reliability' ? 'LOW RELIABILITY' : selectedGlobal ? selectedGlobal.changePct > 0.12 ? 'BULLISH' : selectedGlobal.changePct < -0.12 ? 'BEARISH' : 'NEUTRAL' : 'NO FORECAST'}
              value={formatUsd(selectedGlobal?.predictedXauUsd)}
              change={`${formatSigned(selectedGlobal?.changeUsd, 2)} · ${formatSigned(selectedGlobal?.changePct, 2, '%')}`}
              positive={market?.reliability?.global.state === 'low-reliability' ? null : selectedGlobal ? selectedGlobal.changePct > 0.12 ? true : selectedGlobal.changePct < -0.12 ? false : null : null}
              kicker="PREDICTED XAU/USD · USD PER TROY OUNCE"
              confidence={selectedGlobal?.confidencePct}
              range={selectedGlobal ? { low: formatUsd(selectedGlobal.rangeLow), high: formatUsd(selectedGlobal.rangeHigh), current: formatUsd(selectedGlobal.predictedXauUsd) } : undefined}
              upProbabilityPct={selectedProbabilities?.['xau-usd'].upProbabilityPct}
              downProbabilityPct={selectedProbabilities?.['xau-usd'].downProbabilityPct}
              confidenceLevel={selectedProbabilities?.['xau-usd'].confidence}
              volatilityRegime={response.volatilityRegime}
              lowReliabilityReason={market?.reliability?.global.state === 'low-reliability' ? market.reliability.global.reasons[0] : null}
              rangeMethodLabel={scenarioInputsActive ? 'SCENARIO · VOLATILITY-BASED' : response.rangeCalibration?.['xau-usd']?.method === 'empirical-error' ? `ERROR P10–P90 · n=${response.rangeCalibration['xau-usd'].samples}` : 'VOLATILITY-BASED, NOT ERROR-BASED'}
              probabilityStatus={scenarioInputsActive ? 'SCENARIO · UNCALIBRATED' : response.probabilityCalibration?.['xau-usd']?.method === 'isotonic' ? 'ISOTONIC CALIBRATED' : 'UNCALIBRATED'}
              whyFactors={scenarioInputsActive ? [] : response.whyGlobalFactors ?? []}
              whyUnavailableReason={scenarioInputsActive ? 'Scenario mode is active; the baseline explanation is not reused for altered inputs.' : undefined}
              language={language}
              note={`${market?.spotStale ? 'Last observed XAU/USD baseline is stale. ' : ''}ATR is a historical range proxy; confidence is not statistically calibrated.`}
            />
            <NepalForecastCard response={response} amount={scenarioForecast} scenarioActive={scenarioInputsActive} language={language} />
          </div> : <div className="loading-panel"><AlertCircle size={21} /><div><b>No response from the prediction route</b><span>Live price cards remain blank until market feeds can be reached.</span></div><button className="button button-subtle" onClick={() => void refresh(false)}>Retry</button></div>}
        </section>

        {response && <>
          <TechnicalStrip response={response} />
          <SystemAuditPanel response={response} eventOverlay={eventOverlay} priceMoveAlarm={priceMoveAlarm} dailyOfficialMove={dailyOfficialMove} />
          {market?.notices && market.notices.length > 0 && <details className="data-notices"><summary><CircleHelp size={14} /><span>Feed & methodology notices</span><span className="notice-count">{market.notices.length}</span><ChevronDown size={14} /></summary><ul>{market.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details>}

          <div className="market-grid">
            <MarketChart market={response.market} forecast={baseForecast} scenario={scenarioForecast} language={language} />
            <SignalCard response={response} />
          </div>

          <StressTester
            response={response}
            scenario={scenario}
            onScenario={setScenario}
            result={scenarioForecast}
            onAnalyze={() => void runAnalysis(scenario.headline)}
            analyzing={analysisBusy}
            providerConfigured={aiKeyAvailable}
            error={scenarioError}
          />

          <div className="evidence-grid">
            <DriverFeed response={response} />
            <div id="accuracy"><AccuracyLedger response={response} /></div>
          </div>

          <CrisisSimulator
            baseXauUsd={baseForecast?.predictedXauUsd ?? market?.spot ?? null}
            baseNepalTolaNpr={response.defaultNepalForecast?.predicted24kTolaNpr ?? null}
            thresholdNpr={alarmThreshold}
            activeEvent={simulatedEvent}
            onApply={(event) => { setSimulatedEvent(event); setSelectedEventId(event.id) }}
            onClear={() => { setSimulatedEvent(null); alarmLatchRef.current = null }}
          />
          <ScheduledEventsPanel response={response} now={clock ?? Date.now()} />
          <WorldMap events={radarEvents} selectedId={selectedEventId} onSelect={setSelectedEventId} thresholdNpr={alarmThreshold} />
        </>}

        <footer className="app-footer">
          <div className="footer-brand"><span className="brand-mark small-brand-mark"><span>A</span><i /></span><div><b>AURUM<span>/</span>NP</b><small>Independent market research terminal</small></div></div>
          <div className="footer-caveat"><ShieldCheck size={15} /><span>Informational only. Not financial advice. Indicative analytics only · not an executable quote. Tomorrow’s FENEGOSIDA fixing can differ from this parity estimate. Verify official rates before trading.</span></div>
          <div className="footer-links"><a href="https://xaus.com/api/" target="_blank" rel="noreferrer">XAU spot & history <ExternalLink size={11} /></a><a href="https://www.fenegosida.org/" target="_blank" rel="noreferrer">FENEGOSIDA <ExternalLink size={11} /></a><a href="https://www.nrb.org.np/forex/" target="_blank" rel="noreferrer">NRB FX <ExternalLink size={11} /></a></div>
          <div className="footer-bottom"><span>© {clock ? nptParts(new Date(clock)).year : '—'} AURUM / NP</span><span>DATA SOURCES: XAUS · FENEGOSIDA · NRB / DATA MIRROR · YAHOO FINANCE · GOOGLE NEWS</span><span>UTC +05:45</span></div>
        </footer>
      </div>
      <AccuracyDrawer open={accuracyOpen} onClose={() => setAccuracyOpen(false)} />
      <ParitySettingsDrawer open={paritySettingsOpen} onClose={() => setParitySettingsOpen(false)} activeRatio={response?.market.nepal.tejabiRatioState} adminAuthenticated={adminAuthenticated} onSaved={(settings) => { setScenario((previous) => ({ ...previous, customsDutyPct: settings.customsDutyPct, bankFreightPct: settings.vatOtherLevyPct })); if (response) setResponse({ ...response, paritySettings: settings }); void refresh(false) }} />
      <ManualRatesDrawer open={manualRatesOpen} onClose={() => setManualRatesOpen(false)} onSaved={() => void refresh(false)} language={language} adminAuthenticated={adminAuthenticated} />
      <Stage3ToolsDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} market={market} alertThreshold={alarmThreshold} language={language} />
      <DataFreshnessDrawer open={freshnessOpen} onClose={() => setFreshnessOpen(false)} market={market} onRetry={() => void refresh(true)} language={language} canRetry={adminAuthenticated} />
    </main>
  )
}
