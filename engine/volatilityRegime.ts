import type { OhlcCandle, QuantForecast, VolatilityRegimeSummary } from '@/lib/types'

export function calculateAtrPercentile(candles: OhlcCandle[], period = 14, window = 252): number | null {
  if (period < 2 || candles.length <= period) return null
  const sorted = [...candles].filter((item) => [item.high, item.low, item.close].every(Number.isFinite)).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length <= period) return null
  const trueRanges: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const previousClose = sorted[i - 1].close
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previousClose), Math.abs(current.low - previousClose)))
  }
  if (trueRanges.length < period) return null
  const atrValues: number[] = []
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  atrValues.push(atr)
  for (let i = period; i < trueRanges.length; i += 1) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period
    if (Number.isFinite(atr)) atrValues.push(atr)
  }
  const sample = atrValues.slice(-Math.max(20, window))
  if (sample.length < 20) return null
  const current = sample[sample.length - 1]
  return Math.round(sample.filter((value) => value <= current).length / sample.length * 1000) / 10
}

export function classifyVolatilityRegime(atrPercentile: number | null, geopoliticalRiskScore: number): VolatilityRegimeSummary {
  const geo = Number.isFinite(geopoliticalRiskScore) ? Math.max(-10, Math.min(10, geopoliticalRiskScore)) : 0
  const riskMagnitude = Math.abs(geo)
  if ((atrPercentile !== null && atrPercentile >= 80) || riskMagnitude >= 7) {
    const reasons = [atrPercentile !== null && atrPercentile >= 80 ? `ATR is at the ${atrPercentile}th percentile` : '', riskMagnitude >= 7 ? `geopolitical risk magnitude is ${riskMagnitude.toFixed(1)}/10` : ''].filter(Boolean)
    return { name: 'Stress', atrPercentile, geopoliticalRiskScore: geo, rangeMultiplier: 1.25, confidenceAdjustmentPct: -8, rationale: reasons.join(' and ') }
  }
  if (atrPercentile !== null && atrPercentile <= 30 && riskMagnitude <= 2.5) {
    return { name: 'Calm', atrPercentile, geopoliticalRiskScore: geo, rangeMultiplier: 0.9, confidenceAdjustmentPct: 3, rationale: `ATR is at the ${atrPercentile}th percentile and geopolitical risk magnitude is ${riskMagnitude.toFixed(1)}/10` }
  }
  return {
    name: 'Normal', atrPercentile, geopoliticalRiskScore: geo, rangeMultiplier: 1, confidenceAdjustmentPct: 0,
    rationale: atrPercentile === null ? `ATR percentile is unavailable; regime uses geopolitical risk magnitude ${riskMagnitude.toFixed(1)}/10` : `ATR is at the ${atrPercentile}th percentile; neither Calm nor Stress threshold is met`,
  }
}

export function applyVolatilityRegime(forecast: QuantForecast, regime: VolatilityRegimeSummary): QuantForecast {
  const center = forecast.predictedXauUsd
  const lowWidth = Math.max(0, center - forecast.rangeLow) * regime.rangeMultiplier
  const highWidth = Math.max(0, forecast.rangeHigh - center) * regime.rangeMultiplier
  return {
    ...forecast,
    rangeLow: Math.max(0, center - lowWidth),
    rangeHigh: center + highWidth,
    confidencePct: Math.max(5, Math.min(95, forecast.confidencePct + regime.confidenceAdjustmentPct)),
    confidenceLabel: `${regime.name} regime · ${forecast.confidenceLabel}`,
  }
}
