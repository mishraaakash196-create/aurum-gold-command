import { calculateTechnicalIndicators, clamp, TROY_OUNCE_GRAMS } from '@/lib/goldEngine'
import { aggregateGeopoliticalScore } from '@/lib/sentiment'
import type { EnsembleDriverScore, EnsembleModelSummary, MarketSnapshot, ParitySettings, PredictionLogEntry, QuantForecast } from '@/lib/types'

export const ENSEMBLE_FEATURE_KEYS = [
  'technical', 'sentiment', 'dxy', 'realYield', 'nominalYield', 'fedWatch', 'fedFuturesProxy',
  'cotPositioning', 'gldFlows', 'iauFlows', 'brent', 'indiaPremium', 'indiaDutyChange',
  'nprInr', 'nepalDutyChange', 'seasonality', 'silverCorrelation',
] as const
export type EnsembleFeatureKey = typeof ENSEMBLE_FEATURE_KEYS[number]
export type EnsembleFeatures = Partial<Record<EnsembleFeatureKey, number>>

export const HEURISTIC_WEIGHTS: Record<string, number> = {
  intercept: 0,
  technical: 0.32,
  sentiment: 0.22,
  dxy: 0.16,
  realYield: 0.15,
  nominalYield: 0.05,
  fedWatch: 0.12,
  fedFuturesProxy: 0.08,
  cotPositioning: 0.09,
  gldFlows: 0.08,
  iauFlows: 0.06,
  brent: 0.05,
  indiaPremium: 0.08,
  indiaDutyChange: 0.04,
  nprInr: 0.06,
  nepalDutyChange: 0.04,
  seasonality: 0.06,
  silverCorrelation: 0.04,
}
const LABELS: Record<EnsembleFeatureKey, string> = {
  technical: 'Technical indicators (RSI, EMA 20/50/200, MACD, ATR)',
  sentiment: 'Headline/event sentiment',
  dxy: 'U.S. dollar index',
  realYield: '10Y TIPS real-yield change',
  nominalYield: 'U.S. 10Y nominal-yield fallback',
  fedWatch: 'CME FedWatch ease vs hike probabilities',
  fedFuturesProxy: 'ZQ=F rate-path proxy (not FedWatch odds)',
  cotPositioning: 'CFTC managed-money net-position change',
  gldFlows: 'GLD physical holdings change',
  iauFlows: 'IAU physical holdings change',
  brent: 'Brent crude daily change',
  indiaPremium: 'MCX India premium vs global spot',
  indiaDutyChange: 'India import-duty change vs configured baseline',
  nprInr: 'Observed NPR/INR cross-rate change',
  nepalDutyChange: 'Nepal parity-duty change vs configured baseline',
  seasonality: 'BS-calendar seasonal demand proxy',
  silverCorrelation: 'Silver co-move × XAG daily return proxy',
}
const NEW_STAGE2_KEYS = ['fedWatch', 'brent', 'cotPositioning', 'gldFlows', 'iauFlows', 'indiaPremium', 'indiaDutyChange', 'nprInr', 'nepalDutyChange', 'seasonality', 'silverCorrelation'] as const
const LEGACY_QUANT_KEYS = ['technical', 'dxy', 'realYield', 'nominalYield', 'fedFuturesProxy'] as const

const isFresh = (status: string) => status === 'fresh'
const freshMetricChange = (metric: MarketSnapshot['macro']['dxy']) => !metric.stale && metric.changePct !== null && Number.isFinite(metric.changePct) ? metric.changePct : null

export function buildEnsembleFeatures(market: MarketSnapshot, settings?: ParitySettings): EnsembleFeatures {
  const features: EnsembleFeatures = {}
  const indicators = market.indicators
  if (indicators) features.technical = clamp(indicators.technicalMomentumScore / 10, -1, 1)
  if (market.news.length) features.sentiment = clamp(aggregateGeopoliticalScore(market.news) / 10, -1, 1)

  const dxyChange = freshMetricChange(market.macro.dxy)
  if (dxyChange !== null) features.dxy = clamp(-dxyChange / 0.6, -1, 1)
  const real = market.macro.real10y
  if (!real.stale && real.change !== null && Number.isFinite(real.change)) features.realYield = clamp(-real.change / 0.1, -1, 1)
  else {
    const nominal = market.macro.nominal10y
    if (!nominal.stale && nominal.change !== null && Number.isFinite(nominal.change)) features.nominalYield = clamp(-nominal.change / 0.15, -1, 1)
  }

  const fed = market.stage2.fedWatch
  if (isFresh(fed.status) && fed.data?.easePct !== null && fed.data?.easePct !== undefined && fed.data?.hikePct !== null && fed.data?.hikePct !== undefined) {
    features.fedWatch = clamp((fed.data.easePct - fed.data.hikePct) / 100, -1, 1)
  } else {
    const proxy = market.macro.fedFundsFutures
    if (!proxy.stale && proxy.changePct !== null && Number.isFinite(proxy.changePct)) features.fedFuturesProxy = clamp(proxy.changePct / 0.25, -1, 1)
  }

  const cot = market.stage2.cot
  if (isFresh(cot.status) && cot.data?.managedMoneyNetChange !== null && cot.data?.managedMoneyNetChange !== undefined && cot.data.openInterest > 0) {
    features.cotPositioning = clamp(cot.data.managedMoneyNetChange / cot.data.openInterest / 0.025, -1, 1)
  }
  for (const [ticker, key] of [['GLD', 'gldFlows'], ['IAU', 'iauFlows']] as const) {
    const report = ticker === 'GLD' ? market.stage2.etfs.gld : market.stage2.etfs.iau
    if (isFresh(report.status) && report.data?.dailyChangeTonnes !== null && report.data?.dailyChangeTonnes !== undefined) {
      features[key] = clamp(report.data.dailyChangeTonnes / 4, -1, 1)
    }
  }

  const brentChange = freshMetricChange(market.macro.brent)
  if (brentChange !== null) features.brent = clamp(brentChange / 3, -1, 1)

  const mcx = market.stage2.indiaGold
  const mcxValue = mcx.data?.value
  const unitConfirmed = process.env.AURUM_MCX_QUOTE_UNIT?.trim().toUpperCase() === 'INR_PER_10G'
  if (unitConfirmed && isFresh(mcx.status) && mcxValue !== null && mcxValue !== undefined && market.spot && !market.macro.usdInr.stale && market.macro.usdInr.value) {
    const globalInrPer10g = market.spot / TROY_OUNCE_GRAMS * market.macro.usdInr.value * 10
    if (globalInrPer10g > 0) {
      const duty = market.stage2.indiaImportDuty.status === 'manual' ? market.stage2.indiaImportDuty.data?.percentage ?? 0 : 0
      const premiumPct = (mcxValue / globalInrPer10g - 1) * 100 - duty
      features.indiaPremium = clamp(premiumPct / 10, -1, 1)
    }
  }
  const indiaDuty = market.stage2.indiaImportDuty
  const indiaDutyBaseline = Number(process.env.AURUM_INDIA_IMPORT_DUTY_BASELINE_PCT)
  if (indiaDuty.status === 'manual' && indiaDuty.data && Number.isFinite(indiaDutyBaseline)) {
    features.indiaDutyChange = clamp((indiaDuty.data.percentage - indiaDutyBaseline) / 5, -1, 1)
  }
  const nprInr = market.stage2.nprInr
  if (isFresh(nprInr.status) && nprInr.data?.changePct !== null && nprInr.data?.changePct !== undefined) features.nprInr = clamp(nprInr.data.changePct / 0.5, -1, 1)
  const nepalDutyBaseline = Number(process.env.AURUM_NEPAL_DUTY_BASELINE_PCT)
  if (settings && Number.isFinite(nepalDutyBaseline)) features.nepalDutyChange = clamp((settings.customsDutyPct - nepalDutyBaseline) / 5, -1, 1)

  features.seasonality = clamp(market.stage2.seasonality.signedScorePct / 0.06, -1, 1)
  const silverFeed = market.stage2.silverCorrelation
  const silverSeries = market.stage2.silverHistory.data
  if (isFresh(silverFeed.status) && silverFeed.data && silverSeries && silverSeries.length > 1) {
    const current = silverSeries.at(-1)!.value; const prior = silverSeries.at(-2)!.value
    if (prior > 0) features.silverCorrelation = clamp(silverFeed.data.correlation * ((current / prior - 1) * 100) / 1.25, -1, 1)
  }
  return features
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length; const a = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    if (Math.abs(a[pivot][col]) < 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const divisor = a[col][col]
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = a[row][col]
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j]
    }
  }
  return a.map((row) => row[n])
}

export interface EnsembleTrainingRow { features: EnsembleFeatures; targetPct: number; source: 'logged-actual' | 'technical-backtest' }

export function loggedOutcomeRows(entries: PredictionLogEntry[]): EnsembleTrainingRow[] {
  const rows: EnsembleTrainingRow[] = []
  for (const entry of entries) {
    const spot = entry.inputs.spotXauUsd
    const actual = entry.actuals['xau-usd']
    const raw = entry.inputs.modelFeatures
    if (!spot || spot <= 0 || !actual || actual.value <= 0 || !raw) continue
    const features: EnsembleFeatures = {}
    for (const key of ENSEMBLE_FEATURE_KEYS) {
      const value = raw[key]
      if (typeof value === 'number' && Number.isFinite(value)) features[key] = clamp(value, -1, 1)
    }
    if (!Object.keys(features).length) continue
    rows.push({ features, targetPct: (actual.value / spot - 1) * 100, source: 'logged-actual' })
  }
  return rows
}

export function fitRidgeEnsemble(loggedRows: EnsembleTrainingRow[], backtestRows: EnsembleTrainingRow[], fitAt = new Date().toISOString(), ridgeLambda = 8): EnsembleModelSummary {
  const logs = loggedRows.filter((row) => Number.isFinite(row.targetPct) && Object.keys(row.features).length > 0)
  const replay = backtestRows.filter((row) => Number.isFinite(row.targetPct) && Number.isFinite(row.features.technical))
  const rows = [...logs, ...replay]
  const fallback = getHeuristicModel(logs.length, replay.length)
  if (logs.length < 25 || rows.length < 60) return fallback

  const dimensions = ['intercept', ...ENSEMBLE_FEATURE_KEYS]
  const matrix = Array.from({ length: dimensions.length }, () => Array(dimensions.length).fill(0)) as number[][]
  const vector = Array(dimensions.length).fill(0) as number[]
  for (const row of rows) {
    const x = [1, ...ENSEMBLE_FEATURE_KEYS.map((key) => row.features[key] ?? 0)]
    const y = clamp(row.targetPct, -8, 8)
    for (let i = 0; i < x.length; i += 1) {
      vector[i] += x[i] * y
      for (let j = 0; j < x.length; j += 1) matrix[i][j] += x[i] * x[j]
    }
  }
  for (let i = 0; i < matrix.length; i += 1) matrix[i][i] += i === 0 ? 0 : ridgeLambda
  const coefficients = solveLinearSystem(matrix, vector)
  if (!coefficients || coefficients.some((value) => !Number.isFinite(value))) return fallback
  const weights: Record<string, number> = {}
  dimensions.forEach((key, index) => { weights[key] = Math.round(coefficients[index] * 10_000) / 10_000 })
  return {
    mode: 'ridge-learned', fitAt, trainingSamples: logs.length, backtestSamples: replay.length,
    ridgeLambda, weights,
    note: `Ridge regression fitted to ${logs.length} verified logged next-session XAU outcomes plus ${replay.length} technical-only OHLC walk-forward rows. Features are lagged snapshots; missing historical macro/local factors are not backfilled. Refit cadence: weekly.`,
  }
}

export function getHeuristicModel(trainingSamples = 0, backtestSamples = 0): EnsembleModelSummary {
  return {
    mode: 'heuristic-fallback', fitAt: null, trainingSamples, backtestSamples, ridgeLambda: null,
    weights: { ...HEURISTIC_WEIGHTS },
    note: 'Heuristic fallback active; not enough verified logged feature/outcome pairs for ridge fitting (minimum 25 logged outcomes and 60 total rows). Current deterministic signal heuristics remain active.',
  }
}

export function predictEnsemblePct(features: EnsembleFeatures, model: EnsembleModelSummary): number {
  return clamp((model.weights.intercept ?? 0) + ENSEMBLE_FEATURE_KEYS.reduce((sum, key) => sum + (features[key] ?? 0) * (model.weights[key] ?? 0), 0), -5, 5)
}

/** The legacy quant already includes technical/DXY/yields/ZQ/WGC; only new factors are overlaid in fallback mode. */
export function applyEnsembleToForecast(base: QuantForecast, features: EnsembleFeatures, model: EnsembleModelSummary): QuantForecast {
  let changePct: number
  if (model.mode === 'ridge-learned') {
    const learned = predictEnsemblePct(features, model)
    changePct = 0.55 * base.changePct + 0.45 * learned
  } else {
    const extra = NEW_STAGE2_KEYS.reduce((sum, key) => sum + (features[key] ?? 0) * (HEURISTIC_WEIGHTS[key] ?? 0), 0)
    changePct = base.changePct + clamp(extra, -0.35, 0.35)
  }
  const predictedXauUsd = base.currentXauUsd * (1 + changePct / 100)
  return {
    ...base, predictedXauUsd, changePct, changeUsd: predictedXauUsd - base.currentXauUsd,
    rangeLow: Math.max(0, predictedXauUsd - base.atr14Usd), rangeHigh: predictedXauUsd + base.atr14Usd,
    method: `${base.method} · ${model.mode === 'ridge-learned' ? 'weekly ridge ensemble blend' : 'heuristic Stage 2 factor overlay'}`,
  }
}

export function buildEnsembleDriverScores(market: MarketSnapshot, features: EnsembleFeatures, model: EnsembleModelSummary): EnsembleDriverScore[] {
  const meta: Record<EnsembleFeatureKey, { source: string; asOf: string | null; status: EnsembleDriverScore['status']; note: string }> = {
    technical: { source: 'XAUS daily OHLC', asOf: market.historyAsOf, status: market.indicators ? 'fresh' : 'unavailable', note: 'RSI, EMA 20/50/200, MACD and ATR momentum composite.' },
    sentiment: { source: 'Google News RSS', asOf: market.generatedAt, status: market.news.length ? 'fresh' : 'unavailable', note: market.news.length ? 'Headline/event sentiment proxy.' : 'No recent headlines; excluded.' },
    dxy: { source: market.macro.dxy.source, asOf: market.macro.dxy.asOf, status: market.macro.dxy.stale ? 'stale' : market.macro.dxy.value === null ? 'unavailable' : 'fresh', note: 'Stronger USD is treated as bearish for gold.' },
    realYield: { source: market.macro.real10y.source, asOf: market.macro.real10y.asOf, status: market.macro.real10y.stale ? 'stale' : market.macro.real10y.value === null ? 'unavailable' : 'fresh', note: 'Fresh 10Y TIPS change is preferred.' },
    nominalYield: { source: market.macro.nominal10y.source, asOf: market.macro.nominal10y.asOf, status: market.macro.nominal10y.stale ? 'stale' : market.macro.nominal10y.value === null ? 'unavailable' : 'fresh', note: 'Context/fallback only; never labeled a real yield.' },
    fedWatch: { source: market.stage2.fedWatch.source, asOf: market.stage2.fedWatch.asOf, status: market.stage2.fedWatch.status, note: market.stage2.fedWatch.note },
    fedFuturesProxy: { source: market.macro.fedFundsFutures.source, asOf: market.macro.fedFundsFutures.asOf, status: market.macro.fedFundsFutures.stale ? 'stale' : market.macro.fedFundsFutures.value === null ? 'unavailable' : 'proxy', note: 'Front-month futures repricing, not meeting odds.' },
    cotPositioning: { source: market.stage2.cot.source, asOf: market.stage2.cot.asOf, status: market.stage2.cot.status, note: market.stage2.cot.note },
    gldFlows: { source: market.stage2.etfs.gld.source, asOf: market.stage2.etfs.gld.asOf, status: market.stage2.etfs.gld.status, note: market.stage2.etfs.gld.note },
    iauFlows: { source: market.stage2.etfs.iau.source, asOf: market.stage2.etfs.iau.asOf, status: market.stage2.etfs.iau.status, note: market.stage2.etfs.iau.note },
    brent: { source: market.macro.brent.source, asOf: market.macro.brent.asOf, status: market.macro.brent.stale ? 'stale' : market.macro.brent.value === null ? 'unavailable' : 'fresh', note: 'Daily Brent change; heuristic association only.' },
    indiaPremium: { source: market.stage2.indiaGold.source, asOf: market.stage2.indiaGold.asOf, status: process.env.AURUM_MCX_QUOTE_UNIT?.toUpperCase() === 'INR_PER_10G' ? market.stage2.indiaGold.status : 'unavailable', note: 'Only used if quote unit is explicitly confirmed as INR_PER_10G.' },
    indiaDutyChange: { source: market.stage2.indiaImportDuty.source, asOf: market.stage2.indiaImportDuty.asOf, status: market.stage2.indiaImportDuty.status, note: 'Requires a configured previous-duty baseline; current rate alone is not treated as a change.' },
    nprInr: { source: market.stage2.nprInr.source, asOf: market.stage2.nprInr.asOf, status: market.stage2.nprInr.status, note: 'Observed USD/NPR divided by USD/INR; no fixed peg is hard-coded.' },
    nepalDutyChange: { source: 'User-configured parity settings + explicit baseline env', asOf: null, status: Number.isFinite(Number(process.env.AURUM_NEPAL_DUTY_BASELINE_PCT)) ? 'manual' : 'unavailable', note: 'A configured baseline is required; duty settings are not represented as a live budget feed.' },
    seasonality: { source: market.stage2.seasonality.source, asOf: market.generatedAt, status: 'proxy', note: market.stage2.seasonality.phase },
    silverCorrelation: { source: market.stage2.silverCorrelation.source, asOf: market.stage2.silverCorrelation.asOf, status: market.stage2.silverCorrelation.status, note: market.stage2.silverCorrelation.note },
  }
  return ENSEMBLE_FEATURE_KEYS.map((key) => {
    const signal = features[key] ?? null
    const legacyEmbedded = model.mode === 'heuristic-fallback' && LEGACY_QUANT_KEYS.includes(key as typeof LEGACY_QUANT_KEYS[number])
    const contributionKind: EnsembleDriverScore['contributionKind'] = signal === null ? 'excluded'
      : legacyEmbedded ? 'legacy-quant'
        : model.mode === 'ridge-learned' ? 'ridge-blend'
          : key === 'sentiment' ? 'rules-overlay' : 'heuristic-overlay'
    const blend = model.mode === 'ridge-learned' ? 0.45 : 1
    const contributionPct = signal === null || legacyEmbedded ? null : signal * (model.weights[key] ?? 0) * blend
    return { key, label: LABELS[key], signal, contributionPct, contributionKind, direction: signal === null ? 'unavailable' : (contributionPct ?? signal) > 0.0005 ? 'bullish' : (contributionPct ?? signal) < -0.0005 ? 'bearish' : 'neutral', ...meta[key] }
  })
}

export function historicalTechnicalRows(candles: MarketSnapshot['candles']) {
  const rows: Array<{ features: EnsembleFeatures; targetPct: number; source: 'technical-backtest' }> = []
  const start = Math.max(25, candles.length - 120)
  for (let index = start; index < candles.length - 1; index += 1) {
    const prefix = candles.slice(0, index + 1)
    const indicators = calculateTechnicalIndicators(prefix)
    const current = candles[index].close; const next = candles[index + 1].close
    if (!indicators || current <= 0) continue
    rows.push({ features: { technical: clamp(indicators.technicalMomentumScore / 10, -1, 1) }, targetPct: (next / current - 1) * 100, source: 'technical-backtest' })
  }
  return rows
}

