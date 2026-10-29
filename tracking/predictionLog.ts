import { randomUUID } from 'node:crypto'
import type { FixingWindowAudit, PredictionLogEntry, PredictionResponse, PredictionSnapshot, ProbabilisticInstrumentForecast } from '@/lib/types'
import { appendActualUpdates, appendPredictionEntry, getManualOfficialRates, getOfficialRateHistory, getPredictionEntries } from '@/data/jsonStore'
import { resolveTargetSpotObservation, type SpotObservation } from '@/engine/fixingWindow'

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function makeSnapshot(response: PredictionResponse, capturedAt: string): PredictionSnapshot | null {
  const market = response.market
  const fixingWindow = response.fixingWindow
  if (!fixingWindow) return null
  const feeds: PredictionSnapshot['feeds'] = {}
  const add = (name: string, value: unknown, source: string, asOf: string | null, stale: boolean, status?: string, note?: string, checkedAt?: string | null) => {
    feeds[name] = { value, source, asOf, checkedAt: checkedAt ?? null, stale, status, note }
  }
  add('xau-spot', market.spot, market.spotSource, market.spotAsOf, market.spotStale, market.spot === null ? 'unavailable' : market.spotStale ? 'stale' : 'live')
  add('xau-daily-ohlc', { source: market.historySource, candleCount: market.candles.length }, market.historySource, market.historyAsOf, !market.candles.length, market.candles.length ? 'observed' : 'unavailable')
  add('usd-npr-parity', market.macro.usdNprParity, market.macro.usdNprParity.source, market.macro.usdNprParity.asOf, market.macro.usdNprParity.stale, market.macro.usdNprParity.value === null ? 'unavailable' : market.macro.usdNprParity.stale ? 'stale' : 'live', market.macro.usdNprParity.note)
  add('fenegosida-24k', market.nepal.rate24kTola, market.nepal.rateSource, market.nepal.rateAsOf ?? market.nepal.rateDate, market.nepal.rateStale, market.nepal.rate24kManualEntry ? 'manual' : market.nepal.rateStale ? 'stale' : market.nepal.rate24kTola === null ? 'unavailable' : 'live')
  add('fenegosida-tejabi', market.nepal.rateTejabiTola, market.nepal.rateTejabiManualEntry ? 'Manual entry · FENEGOSIDA transcription' : market.nepal.rateTejabiOfficial ? 'FENEGOSIDA · separate quote' : `Tejabi ratio · ${market.nepal.tejabiRatioState?.source ?? 'unavailable'}`, market.nepal.rateTejabiAsOf ?? market.nepal.tejabiRatioState?.lastUpdatedAt ?? null, market.nepal.rateStale, market.nepal.rateTejabiOfficial ? (market.nepal.rateStale ? 'stale' : 'live') : 'proxy')
  for (const [name, metric] of Object.entries(market.macro)) {
    const snapshotValue = { value: metric.value, previous: metric.previous, change: metric.change, changePct: metric.changePct, unit: metric.unit }
    add(`macro-${name}`, snapshotValue, metric.source, metric.asOf, metric.stale, metric.value === null ? 'unavailable' : metric.stale ? 'stale' : 'live', metric.note)
  }
  const stage2 = market.stage2
  for (const [name, feed] of Object.entries({
    fedWatch: stage2.fedWatch, cot: stage2.cot, gld: stage2.etfs.gld, iau: stage2.etfs.iau,
    indiaGold: stage2.indiaGold, indiaImportDuty: stage2.indiaImportDuty, nprInr: stage2.nprInr,
    silverCorrelation: stage2.silverCorrelation,
    silverHistory: { ...stage2.silverHistory, data: stage2.silverHistory.data?.slice(-2) ?? null },
    eventCalendar: { ...stage2.eventCalendar, data: stage2.eventCalendar.data?.slice(0, 16) ?? null },
  })) {
    add(`stage2-${name}`, feed.data, feed.source, feed.asOf, feed.status === 'stale' || feed.status === 'unavailable', feed.status, feed.note, feed.checkedAt)
  }
  add('wgc-central-bank', market.institutionalDemand.centralBank, market.institutionalDemand.centralBank.source, market.institutionalDemand.centralBank.publishedAt, market.institutionalDemand.centralBank.stale, market.institutionalDemand.centralBank.provenance, market.institutionalDemand.centralBank.note)
  add('wgc-etf-flow', market.institutionalDemand.goldEtf, market.institutionalDemand.goldEtf.source, market.institutionalDemand.goldEtf.publishedAt, market.institutionalDemand.goldEtf.stale, market.institutionalDemand.goldEtf.provenance, market.institutionalDemand.goldEtf.note)
  add('imf-gold-reserves', market.institutionalDemand.goldReserves, 'IMF IRFCL', market.institutionalDemand.goldReserves[0]?.asOf ?? null, market.institutionalDemand.goldReserves.some((row) => row.stale), market.institutionalDemand.goldReserves.length ? 'reported' : 'unavailable')
  add('google-news', market.news.map((item) => ({ title: item.title, source: item.source, publishedAt: item.publishedAt, sentimentScore: item.sentimentScore, impact: item.impact })), market.news[0]?.source ?? 'Google News RSS', market.news[0]?.publishedAt ?? null, !market.news.length, market.news.length ? 'reported' : 'unavailable')
  add('stage2-seasonality', { index: stage2.seasonality.index, signedScorePct: stage2.seasonality.signedScorePct, bsDate: stage2.seasonality.bsDate, phase: stage2.seasonality.phase }, stage2.seasonality.source, market.generatedAt, false, 'proxy')
  const numericInputs: Record<string, number> = { ...(response.ensembleFeatures ?? {}) }
  if (response.quantitativeForecast) {
    numericInputs['quant.currentXauUsd'] = response.quantitativeForecast.currentXauUsd
    numericInputs['quant.changePct'] = response.quantitativeForecast.changePct
    numericInputs['quant.atr14Usd'] = response.quantitativeForecast.atr14Usd
    for (const item of response.quantitativeForecast.technicalFactorContributions ?? []) numericInputs[`quant.${item.key}.impactPct`] = item.impactPct
    const macro = response.quantitativeForecast.macroFactorContributions
    if (macro) for (const [key, value] of Object.entries(macro)) if (typeof value === 'number' && Number.isFinite(value)) numericInputs[`quant.macro.${key}`] = value
  }
  return {
    schemaVersion: 1,
    capturedAt,
    feeds,
    technical: (() => {
      const candles = market.candles
      const end = candles.length - 1
      const fiveIndex = Math.max(0, end - 5)
      const twentyIndex = Math.max(0, end - 20)
      const prior5 = candles[fiveIndex]
      const prior20 = candles[twentyIndex]
      return market.indicators ? {
        rsi14: market.indicators.rsi14, ema20: market.indicators.ema20, ema50: market.indicators.ema50, ema200: market.indicators.ema200,
        macdHistogram: market.indicators.macdHistogram, bollingerUpper: market.indicators.bollingerUpper,
        bollingerMiddle: market.indicators.bollingerMiddle, bollingerLower: market.indicators.bollingerLower,
        atr14: market.indicators.atr14, technicalMomentumScore: market.indicators.technicalMomentumScore,
        source: market.historySource, asOf: market.historyAsOf, candleCount: candles.length,
        currentSpot: { value: market.spot, source: market.spotSource, asOf: market.spotAsOf },
        driftAnchors: { fiveSession: prior5 ? { date: prior5.date, close: prior5.close, sessionsBack: end - fiveIndex } : null, twentySession: prior20 ? { date: prior20.date, close: prior20.close, sessionsBack: end - twentyIndex } : null },
      } : { source: market.historySource, asOf: market.historyAsOf, candleCount: candles.length, unavailable: true }
    })(),
    localModelInputs: {
      official24kPerTolaNpr: market.nepal.rate24kTola,
      rateDate: market.nepal.rateDate,
      rateSource: market.nepal.rateSource,
      rateAsOf: market.nepal.rateAsOf,
      localSpreadPct: market.localSpreadPct,
      localSpreadSamples: market.localSpreadSamples,
      tejabiRatio: market.nepal.tejabiRatioState?.ratio ?? null,
    },
    model: {
      mode: response.ensembleModel?.mode ?? response.analysisMode,
      features: numericInputs,
      weights: {
        'quant.drift': 0.34, 'quant.emaTrend': 0.28, 'quant.rsiReversion': 0.18, 'quant.macdMomentum': 0.20,
        'macro.dxyPerPct': -0.24, 'macro.realYieldPerPoint': -0.60, 'macro.nominalYieldFallbackPerPoint': -0.60,
        'macro.fedFundsFuturesPerPoint': 0.75, 'macro.etfFlowPerUsdBn': 0.006, 'macro.centralBankPerTonne': 0.0012,
        ...Object.fromEntries(Object.entries(response.ensembleModel?.weights ?? {}).map(([key, value]) => [`stage2.${key}`, value])),
      },
      regime: response.volatilityRegime ?? null,
      eventRisk: response.eventRisk ?? null,
      rangeMethods: Object.fromEntries(Object.entries(response.rangeCalibration ?? {}).map(([key, item]) => [key, item.label])),
      rangeCalibration: Object.fromEntries(Object.entries(response.rangeCalibration ?? {}).map(([key, item]) => [key, { method: item.method, samples: item.samples, lowerError: item.lowerError, upperError: item.upperError, scale: item.scale }])),
      probabilityCalibration: Object.fromEntries(Object.entries(response.probabilityCalibrationFits ?? {}).map(([key, item]) => [key, { method: item.method, samples: item.samples, blocks: item.isotonicBlocks }])),

    },
    paritySettings: response.paritySettings ?? null,
    fixingWindow,
  }
}

function makeEntry(response: PredictionResponse): PredictionLogEntry | null {
  const forecast = response.probabilisticForecast
  const timing = response.nepalTiming
  if (!forecast || !response.quantitativeForecast || !timing || !response.fixingWindow) return null
  const createdAt = new Date().toISOString()
  const map = (key: ProbabilisticInstrumentForecast['instrument']) => {
    const item = forecast[key]
    return {
      low: item.low, base: item.base, high: item.high, direction: item.direction, reference: item.reference,
      upProbabilityPct: item.upProbabilityPct, downProbabilityPct: item.downProbabilityPct,
      confidencePct: item.confidencePct, confidence: item.confidence,
    }
  }
  return {
    id: randomUUID(), createdAt, targetDate: timing.targetDate, targetAt: timing.targetAt,
    snapshot: makeSnapshot(response, createdAt) ?? undefined,
    fixingWindow: JSON.parse(JSON.stringify(response.fixingWindow)) as FixingWindowAudit,
    inputs: {
      spotXauUsd: response.market.spot,
      usdNpr: response.market.macro.usdNprParity.value,
      usdNprSource: response.market.macro.usdNprParity.source,
      xauSource: response.market.spotSource,
      localSpreadPct: response.market.localSpreadPct,
      confidencePct: response.quantitativeForecast.confidencePct,
      macroContributions: response.quantitativeForecast.macroFactorContributions ?? null,
      modelFeatures: response.ensembleFeatures ? { ...response.ensembleFeatures } : undefined,
      observedMarketInputs: {
        dxy: response.market.macro.dxy.value,
        dxyChangePct: response.market.macro.dxy.changePct,
        us10yNominalPct: response.market.macro.nominal10y.value,
        us10yRealPct: response.market.macro.real10y.value,
        ratePathProxy: response.market.macro.fedFundsFutures.value,
        reportedEtfFlowUsdBn: response.market.institutionalDemand.goldEtf.netFlowUsdBn,
        reportedCentralBankTonnes: response.market.institutionalDemand.centralBank.netPurchasesTonnes,
        official24kPerTolaNpr: response.market.nepal.rate24kTola,
      },
    },
    predictions: {
      'xau-usd': map('xau-usd'), 'nepal-24k': map('nepal-24k'),
      'nepal-22k': map('nepal-22k'), 'nepal-tejabi': map('nepal-tejabi'),
    },
    actuals: {},
  }
}

type Instrument = ProbabilisticInstrumentForecast['instrument']
function actualIfMissing(entry: PredictionLogEntry, instrument: Instrument, value: number, observedAt: string, source: string) {
  if (entry.actuals[instrument] || !Number.isFinite(value) || value <= 0) return null
  return { value, observedAt, source }
}

function spotObservations(entries: PredictionLogEntry[]): SpotObservation[] {
  return entries.flatMap((entry) => {
    const feed = entry.snapshot?.feeds['xau-spot']
    const value = Number(feed?.value)
    return feed && Number.isFinite(value) && value > 0 && feed.asOf
      ? [{ value, observedAt: feed.asOf, source: feed.source }]
      : []
  })
}

let reconcileQueue: Promise<unknown> = Promise.resolve()
/** Logs a full as-of model snapshot and reconciles only source observations captured at/after the target. */
export async function logAndReconcilePrediction(response: PredictionResponse, logSnapshot = true): Promise<void> {
  const task = reconcileQueue.then(async () => {
    const entry = logSnapshot ? makeEntry(response) : null
    if (entry) await appendPredictionEntry(entry)
    const entries = await getPredictionEntries()
    const [officialHistory, manualRates] = await Promise.all([getOfficialRateHistory(), getManualOfficialRates()])
    const provenanceByDate = new Map(officialHistory.map((item) => [item.date, item.provenance]))
    const manualDates = new Set(manualRates.map((item) => item.date))
    const history = response.market.nepal.history.slice().sort((a, b) => a.date.localeCompare(b.date))
    const todayDate = response.market.nepal.rateDate
    if (todayDate && response.market.nepal.rate24kTola !== null && !history.some((point) => point.date === todayDate)) {
      history.push({ date: todayDate, perTola: response.market.nepal.rate24kTola, per10g: response.market.nepal.rate24k10g ?? 0 })
      history.sort((a, b) => a.date.localeCompare(b.date))
    }
    const xauCandles = response.market.candles.slice().sort((a, b) => a.date.localeCompare(b.date))
    const observedSpots = spotObservations(entries)
    const updates: Array<{ id: string; actuals: PredictionLogEntry['actuals']; fixingWindow?: FixingWindowAudit }> = []
    for (const prediction of entries) {
      const window = prediction.fixingWindow ?? prediction.snapshot?.fixingWindow
      const patch: PredictionLogEntry['actuals'] = {}
      let updatedWindow = window
      let windowChanged = false
      const targetObservationAt = window?.targetObservationTargetAt
      if (window && targetObservationAt && Date.parse(targetObservationAt) <= Date.now() && !prediction.actuals['xau-usd']) {
        const targetDate = targetObservationAt.slice(0, 10)
        const fallbackCandle = xauCandles.find((candle) => candle.date === targetDate) ?? null
        const point = resolveTargetSpotObservation(observedSpots, targetObservationAt, fallbackCandle)
        if (point) {
          const actual = actualIfMissing(prediction, 'xau-usd', point.value, point.observedAt, `${point.source} · ${point.precision}`)
          if (actual) patch['xau-usd'] = actual
          updatedWindow = { ...window, targetObservation: point, status: window.startObservation?.precision === 'exact' && point.precision === 'exact' ? 'exact-window' : 'approximate-window', note: `${window.startObservation?.note ?? 'Start reference unavailable'} Target: ${point.note}` }
          windowChanged = true
        } else {
          updatedWindow = { ...window, targetObservation: null, status: 'unavailable', note: 'No spot quote or daily OHLC observation is available for the target 10:45 NPT window.' }
          windowChanged = true
        }
      }
      if (updatedWindow && windowChanged) {
        updates.push({ id: prediction.id, actuals: patch, fixingWindow: updatedWindow })
      }

      const lastEligibleDate = addDays(prediction.targetDate, 14)
      const local = history.find((point) => point.date >= prediction.targetDate && point.date <= lastEligibleDate && provenanceByDate.get(point.date) !== 'manual entry' && !(manualDates.has(point.date) && provenanceByDate.get(point.date) === undefined))
      if (local) {
        const observedAt = new Date(`${local.date}T05:15:00Z`).toISOString()
        const local24k = actualIfMissing(prediction, 'nepal-24k', local.perTola, observedAt, response.market.nepal.rateSource)
        const local22k = actualIfMissing(prediction, 'nepal-22k', local.perTola * 0.9167, observedAt, 'Derived from FENEGOSIDA 24K × 91.67%')
        const tejabi = todayDate === local.date && response.market.nepal.rateTejabiOfficial && !response.market.nepal.rateTejabiManualEntry && response.market.nepal.rateTejabiTola !== null
          ? actualIfMissing(prediction, 'nepal-tejabi', response.market.nepal.rateTejabiTola, observedAt, response.market.nepal.rateSource)
          : null
        if (local24k) patch['nepal-24k'] = local24k
        if (local22k) patch['nepal-22k'] = local22k
        if (tejabi) patch['nepal-tejabi'] = tejabi
      }
      if (Object.keys(patch).length && !updates.some((item) => item.id === prediction.id)) updates.push({ id: prediction.id, actuals: patch, fixingWindow: updatedWindow })
      else if (Object.keys(patch).length) {
        const existing = updates.find((item) => item.id === prediction.id)!
        existing.actuals = { ...existing.actuals, ...patch }
      }
    }
    await appendActualUpdates(updates)
  })
  reconcileQueue = task.catch(() => undefined)
  await task
}
