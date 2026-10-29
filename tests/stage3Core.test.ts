import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateManualOfficialRate } from '@/engine/manualRates'
import { applyVolatilityRegime, calculateAtrPercentile, classifyVolatilityRegime } from '@/engine/volatilityRegime'
import { calculateBuySell, NEPAL_VAT_RATE, TOLA_GRAMS } from '@/engine/buySellCalculator'
import type { OhlcCandle, QuantForecast } from '@/lib/types'

const now = new Date('2026-10-29T06:00:00.000Z')

describe('Stage 3 manual official rate validation', () => {
  it('accepts same-date 24K and Tejabi rates within the validated ratio band', () => {
    assert.deepEqual(validateManualOfficialRate({ date: '2026-10-29', rate24kTolaNpr: 300_000, tejabiTolaNpr: 294_000 }, now), { valid: true, errors: {} })
  })
  it('rejects impossible dates, future dates, out-of-range values, and implausible Tejabi ratios', () => {
    assert.equal(validateManualOfficialRate({ date: '2026-02-30', rate24kTolaNpr: 300_000, tejabiTolaNpr: 294_000 }, now).valid, false)
    assert.match(validateManualOfficialRate({ date: '2026-10-30', rate24kTolaNpr: 300_000, tejabiTolaNpr: 294_000 }, now).errors.date ?? '', /Future/)
    assert.match(validateManualOfficialRate({ date: '2026-10-29', rate24kTolaNpr: 9_000, tejabiTolaNpr: 8_900 }, now).errors.rate24kTolaNpr ?? '', /between/)
    assert.match(validateManualOfficialRate({ date: '2026-10-29', rate24kTolaNpr: 300_000, tejabiTolaNpr: 250_000 }, now).errors.tejabiTolaNpr ?? '', /90%/)
  })
})

describe('Stage 3 volatility regime', () => {
  it('classifies Stress from high ATR percentile or elevated geopolitical-risk magnitude', () => {
    assert.equal(classifyVolatilityRegime(88, 0).name, 'Stress')
    assert.equal(classifyVolatilityRegime(45, -7.5).name, 'Stress')
  })
  it('classifies Calm only when both ATR percentile and geopolitical risk are low', () => {
    assert.equal(classifyVolatilityRegime(20, 1).name, 'Calm')
    assert.equal(classifyVolatilityRegime(20, 4).name, 'Normal')
    assert.equal(classifyVolatilityRegime(null, 0).name, 'Normal')
  })
  it('widens or narrows the historical range and adjusts confidence without shifting the forecast base', () => {
    const forecast: QuantForecast = { currentXauUsd: 4_000, predictedXauUsd: 4_020, changeUsd: 20, changePct: 0.5, rangeLow: 3_970, rangeHigh: 4_070, atr14Usd: 50, confidencePct: 64, confidenceLabel: 'uncalibrated', method: 'test' }
    const stress = applyVolatilityRegime(forecast, classifyVolatilityRegime(90, 2))
    assert.equal(stress.predictedXauUsd, forecast.predictedXauUsd)
    assert.ok(stress.rangeLow < forecast.rangeLow && stress.rangeHigh > forecast.rangeHigh)
    assert.equal(stress.confidencePct, 56)
    const calm = applyVolatilityRegime(forecast, classifyVolatilityRegime(20, 1))
    assert.ok(calm.rangeLow > forecast.rangeLow && calm.rangeHigh < forecast.rangeHigh)
    assert.equal(calm.confidencePct, 67)
  })
  it('computes an ATR percentile only from a real candle series with adequate history', () => {
    const candles: OhlcCandle[] = Array.from({ length: 80 }, (_, i) => {
      const close = 2_000 + i * 2
      const range = i === 79 ? 45 : 8 + (i % 4)
      return { date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), timestamp: Date.UTC(2026, 0, 1 + i) / 1000, open: close - 1, high: close + range, low: close - range, close, volume: null }
    })
    const percentile = calculateAtrPercentile(candles)
    assert.ok(percentile !== null && percentile >= 80)
    assert.equal(calculateAtrPercentile(candles.slice(0, 10)), null)
  })
})

describe('Stage 3 buy/sell calculator', () => {
  it('converts grams to tola and applies making, wastage, then 13% VAT for a buy', () => {
    const result = calculateBuySell({ mode: 'buy', weight: TOLA_GRAMS, unit: 'gram', karat: '24k', rate24kPerTolaNpr: 300_000, rateTejabiPerTolaNpr: null, makingPct: 5, wastagePct: 2 })
    assert.equal(result.valid, true)
    assert.ok(Math.abs((result.totalNpr ?? 0) - (300_000 * 1.07 * (1 + NEPAL_VAT_RATE))) < 0.01)
    assert.ok(Math.abs(result.weightTola - 1) < 1e-8)
  })
  it('uses a separately reported Tejabi quote and excludes making/VAT on indicative resale', () => {
    const result = calculateBuySell({ mode: 'sell', weight: 1, unit: 'tola', karat: 'tejabi', rate24kPerTolaNpr: 300_000, rateTejabiPerTolaNpr: 294_000, learnedTejabiRatio: 0.98, makingPct: 10, wastagePct: 2 })
    assert.equal(result.sourceLabel, 'Separate Tejabi fixing')
    assert.equal(result.totalNpr, 288_120)
    assert.equal(result.vatNpr, 0)
    assert.equal(result.makingNpr, 0)
  })
  it('does not substitute a fabricated Tejabi rate or accept invalid percentages', () => {
    const missing = calculateBuySell({ mode: 'buy', weight: 1, unit: 'tola', karat: 'tejabi', rate24kPerTolaNpr: 300_000, rateTejabiPerTolaNpr: null, learnedTejabiRatio: null, makingPct: 0, wastagePct: 0 })
    assert.equal(missing.valid, false)
    assert.match(missing.error ?? '', /unavailable/)
    const invalid = calculateBuySell({ mode: 'buy', weight: 1, unit: 'tola', karat: '24k', rate24kPerTolaNpr: 300_000, rateTejabiPerTolaNpr: null, makingPct: 101, wastagePct: 0 })
    assert.equal(invalid.valid, false)
  })
})
