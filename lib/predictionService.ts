import { calculateBacktest } from './goldEngine'
import { composePrediction } from './forecast'
import { hasConfiguredProvider, requestModelAnalysis, type ProviderRequest } from './llm'
import { getMarketData } from './marketData'
import type { ForecastRangeCalibration, PredictionResponse, ProbabilisticInstrumentForecast } from './types'
import { buildProbabilisticForecast } from '@/engine/probability'
import { getNepalFixingTiming } from '@/engine/nepalTiming'
import { getEnsembleModel, getParitySettings, getPredictionEntries, saveEnsembleModel } from '@/data/jsonStore'
import { logAndReconcilePrediction } from '@/tracking/predictionLog'
import { calculateTejabiRatio } from '@/engine/parity'
import { getTejabiObservations, recordTejabiObservation } from '@/data/jsonStore'
import { fitRidgeEnsemble, getHeuristicModel, historicalTechnicalRows, loggedOutcomeRows } from '@/engine/ensemble'
import { calculateEventRiskAdjustment, widenForecastForEvents } from '@/engine/eventRisk'
import { applyVolatilityRegime, calculateAtrPercentile, classifyVolatilityRegime } from '@/engine/volatilityRegime'
import { buildGlobalWhyFactors, buildNepalWhyFactors } from '@/engine/explainability'
import { assessForecastReliability } from '@/engine/reliability'
import { buildFixingWindowAudit, type SpotObservation } from '@/engine/fixingWindow'
import { applyEmpiricalRange, calibrateProbabilisticForecast, calculateCalibrationSummary, empiricalErrorRange, getMatchedOutcomes } from '@/tracking/stage4'

export interface PredictionRequestOptions {
  forceRefresh?: boolean
  provider?: ProviderRequest
  headline?: string
  persist?: boolean
  useAi?: boolean
}

function configuredHolidays() {
  return (process.env.NEPAL_PUBLIC_HOLIDAYS ?? '').split(',').map((date) => date.trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
}

async function getActiveEnsemble(market: Awaited<ReturnType<typeof getMarketData>>, persist = true) {
  const cached = await getEnsembleModel()
  const ageMs = cached?.mode === 'ridge-learned' && cached.fitAt ? Date.now() - Date.parse(cached.fitAt) : Infinity
  if (cached?.mode === 'ridge-learned' && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000) return cached
  const entries = await getPredictionEntries()
  const model = fitRidgeEnsemble(loggedOutcomeRows(entries), historicalTechnicalRows(market.candles))
  if (persist && model.mode === 'ridge-learned') await saveEnsembleModel(model)
  return model.mode === 'ridge-learned' ? model : getHeuristicModel(model.trainingSamples, model.backtestSamples)
}

function pastSpotObservations(entries: Awaited<ReturnType<typeof getPredictionEntries>>): SpotObservation[] {
  return entries.flatMap((entry) => {
    const feed = entry.snapshot?.feeds['xau-spot']
    const value = Number(feed?.value)
    return feed && Number.isFinite(value) && value > 0 && feed.asOf
      ? [{ value, observedAt: feed.asOf, source: feed.source }]
      : []
  })
}

function applyObservedErrorRanges(
  prediction: PredictionResponse,
  entries: Awaited<ReturnType<typeof getPredictionEntries>>,
  regimeMultiplier: number,
  eventMultiplier: number,
): Record<ProbabilisticInstrumentForecast['instrument'], ForecastRangeCalibration> {
  const multiplier = regimeMultiplier * eventMultiplier
  const keys: ProbabilisticInstrumentForecast['instrument'][] = ['xau-usd', 'nepal-24k', 'nepal-22k', 'nepal-tejabi']
  const summary = {} as Record<ProbabilisticInstrumentForecast['instrument'], ForecastRangeCalibration>
  for (const key of keys) {
    const empirical = empiricalErrorRange(entries, key)
    const samples = getMatchedOutcomes(entries, key).length
    const label = empirical ? `empirical error P10–P90 · ${empirical.samples} matched outcomes · regime ×${regimeMultiplier.toFixed(2)} · scheduled-event ×${eventMultiplier.toFixed(2)}` : `volatility-based, not error-based · ${samples}/30 matched outcomes`
    summary[key] = { method: empirical ? 'empirical-error' : 'volatility-based', samples: empirical?.samples ?? samples, label, scale: multiplier, ...(empirical ? { lowerError: empirical.lowerError, upperError: empirical.upperError } : {}) }
    if (!empirical) continue
    if (key === 'xau-usd' && prediction.quantitativeForecast) {
      const bounds = applyEmpiricalRange(prediction.quantitativeForecast.predictedXauUsd, empirical, multiplier)
      prediction.quantitativeForecast = { ...prediction.quantitativeForecast, rangeLow: bounds.low, rangeHigh: bounds.high, method: `${prediction.quantitativeForecast.method} · empirical P10–P90 errors` }
      if (prediction.analysis) prediction.analysis.global_forecast_24h = { ...prediction.analysis.global_forecast_24h, range_low: bounds.low, range_high: bounds.high }
    }
  }
  return summary
}

async function finishPrediction(prediction: PredictionResponse, persist = true): Promise<PredictionResponse> {
  const holidays = configuredHolidays()
  const timing = getNepalFixingTiming(new Date(), holidays)
  prediction.nepalTiming = timing
  const market = prediction.market
  const priorEntries = await getPredictionEntries().catch(() => [])
  const now = new Date()
  const currentSpot: SpotObservation | null = market.spot !== null && market.spotAsOf
    ? { value: market.spot, observedAt: market.spotAsOf, source: market.spotSource }
    : null
  const fixingWindow = buildFixingWindowAudit({
    targetDate: timing.targetDate,
    targetAt: timing.targetAt,
    holidayDates: holidays,
    now: now.toISOString(),
    currentSpot,
    historicalSpots: pastSpotObservations(priorEntries),
  })
  prediction.fixingWindow = fixingWindow
  market.reliability = assessForecastReliability(market, now, holidays)
  if (!market.nepal.rate24kManualEntry) {
    market.nepal.rateStale = market.reliability.nepal.feeds.find((feed) => feed.name === 'FENEGOSIDA official 24K')?.state !== 'live'
  }

  const calendar = market.stage2.eventCalendar
  const eventRisk = calculateEventRiskAdjustment(calendar.status === 'unavailable' ? [] : calendar.data ?? [])
  prediction.eventRisk = eventRisk
  const volatilityRegime = classifyVolatilityRegime(
    calculateAtrPercentile(market.candles),
    prediction.analysis?.geopolitical_risk_score ?? 0,
  )
  prediction.volatilityRegime = volatilityRegime
  const regimeEventMultiplier = volatilityRegime.rangeMultiplier * eventRisk.rangeMultiplier
  if (prediction.quantitativeForecast) {
    prediction.quantitativeForecast = applyVolatilityRegime(prediction.quantitativeForecast, volatilityRegime)
    prediction.quantitativeForecast = widenForecastForEvents(prediction.quantitativeForecast, eventRisk)
  }
  prediction.rangeCalibration = applyObservedErrorRanges(prediction, priorEntries, volatilityRegime.rangeMultiplier, eventRisk.rangeMultiplier)
  if (prediction.analysis && prediction.quantitativeForecast) {
    prediction.analysis.global_forecast_24h = {
      ...prediction.analysis.global_forecast_24h,
      range_low: prediction.quantitativeForecast.rangeLow,
      range_high: prediction.quantitativeForecast.rangeHigh,
      confidence_pct: prediction.quantitativeForecast.confidencePct,
    }
  }

  const references = {
    xauUsd: fixingWindow.startObservation?.value ?? market.spot,
    nepal24k: market.nepal.rate24kTola,
    nepal22k: market.nepal.rate22kTola,
    tejabi: market.nepal.rateTejabiTola,
  }
  prediction.whyGlobalFactors = buildGlobalWhyFactors(market, prediction.quantitativeForecast, prediction.ensembleDrivers, prediction.ensembleModel)
  prediction.whyNepalFactors = buildNepalWhyFactors(market, prediction.defaultNepalForecast, prediction.whyGlobalFactors)

  // composePrediction has already anchored the Nepal estimate to the latest official fixing.
  const globalProbabilities = buildProbabilisticForecast(prediction.quantitativeForecast, prediction.defaultNepalForecast, references)
  if (globalProbabilities && timing.mode === 'last-minute' && prediction.quantitativeForecast && market.spot !== null && prediction.defaultNepalForecast) {
    const intradayWidth = Math.max(market.spot * 0.0015, prediction.quantitativeForecast.atr14Usd * 0.4)
    const liveLocalBaseline = {
      ...prediction.quantitativeForecast,
      currentXauUsd: market.spot,
      predictedXauUsd: market.spot,
      changeUsd: 0,
      changePct: 0,
      rangeLow: Math.max(0, market.spot - intradayWidth),
      rangeHigh: market.spot + intradayWidth,
    }
    const localProbabilities = buildProbabilisticForecast(liveLocalBaseline, prediction.defaultNepalForecast, references)
    if (localProbabilities) {
      globalProbabilities['nepal-24k'] = localProbabilities['nepal-24k']
      globalProbabilities['nepal-22k'] = localProbabilities['nepal-22k']
      globalProbabilities['nepal-tejabi'] = localProbabilities['nepal-tejabi']
    }
  }
  if (globalProbabilities) {
    const keys: ProbabilisticInstrumentForecast['instrument'][] = ['xau-usd', 'nepal-24k', 'nepal-22k', 'nepal-tejabi']
    for (const key of keys) {
      const empirical = empiricalErrorRange(priorEntries, key)
      if (!empirical) continue
      const range = applyEmpiricalRange(globalProbabilities[key].base, empirical, regimeEventMultiplier)
      globalProbabilities[key] = { ...globalProbabilities[key], low: range.low, high: range.high }
    }
    const calibrationSummaries = Object.fromEntries(keys.map((key) => [key, calculateCalibrationSummary(priorEntries, key)])) as Record<ProbabilisticInstrumentForecast['instrument'], ReturnType<typeof calculateCalibrationSummary>>
    prediction.probabilityCalibrationFits = calibrationSummaries
    const calibrated = calibrateProbabilisticForecast(globalProbabilities, calibrationSummaries)
    prediction.probabilisticForecast = calibrated
    prediction.probabilityCalibration = Object.fromEntries(keys.map((key) => {
      const item = calibrationSummaries[key]
      return [key, { method: item.method, samples: item.samples, minimumRequired: item.minimumRequired }]
    })) as PredictionResponse['probabilityCalibration']
  } else {
    prediction.probabilisticForecast = null
  }

  if (persist) await logAndReconcilePrediction(prediction)
  return prediction
}

export async function createPrediction(options: PredictionRequestOptions = {}): Promise<PredictionResponse> {
  const [market, paritySettings] = await Promise.all([
    getMarketData(Boolean(options.forceRefresh)),
    getParitySettings(),
  ])
  const persist = options.persist !== false
  if (persist && market.nepal.rateTejabiOfficial && !market.nepal.rateTejabiManualEntry && market.nepal.rateDate && market.nepal.rate24kTola && market.nepal.rateTejabiTola) {
    await recordTejabiObservation({
      date: market.nepal.rateDate,
      rate24kTolaNpr: market.nepal.rate24kTola,
      tejabiTolaNpr: market.nepal.rateTejabiTola,
      source: market.nepal.rateSource,
      observedAt: market.nepal.rateAsOf ?? market.generatedAt,
    })
  }
  const tejabiRatioState = calculateTejabiRatio(await getTejabiObservations(), paritySettings.tejabiManualRatio, paritySettings.tejabiManualUpdatedAt ?? paritySettings.updatedAt ?? null)
  market.nepal.tejabiRatioState = tejabiRatioState
  if (!market.nepal.rateTejabiOfficial && market.nepal.rate24kTola !== null) {
    market.nepal.rateTejabiTola = Math.round((market.nepal.rate24kTola * tejabiRatioState.ratio) / 100) * 100
    market.nepal.rateTejabi10g = market.nepal.rate24k10g === null ? null : Math.round((market.nepal.rate24k10g * tejabiRatioState.ratio) / 100) * 100
  }
  const backtest = calculateBacktest(market.candles)
  const ensembleModel = await getActiveEnsemble(market, persist)
  const request = options.provider ?? {}
  const baseline = composePrediction(market, backtest, null, 'rules-based', undefined, options.headline ?? '', paritySettings, ensembleModel)
  const quant = baseline.quantitativeForecast
  if (!quant || options.useAi === false || !hasConfiguredProvider(request)) return finishPrediction(baseline, persist)

  const result = await requestModelAnalysis(market, quant, request, options.headline ?? '')
  if (!result) return finishPrediction(baseline, persist)
  if ('error' in result) {
    const fallback = composePrediction(market, backtest, null, 'rules-based', result.error, options.headline ?? '', paritySettings, ensembleModel)
    return finishPrediction(fallback, persist)
  }
  const response = composePrediction(market, backtest, result.analysis, result.provider, undefined, options.headline ?? '', paritySettings, ensembleModel)
  response.modelNote = `${response.modelNote} Provider: ${result.provider} · ${result.model}.`
  return finishPrediction(response, persist)
}
