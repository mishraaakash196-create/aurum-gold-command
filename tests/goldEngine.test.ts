import test from 'node:test'
import assert from 'node:assert/strict'
import {
  atrSeries,
  calculateBacktest,
  calculateMacroFactorContributions,
  calculateNepalForecast,
  calculateRollingImpliedSpread,
  calculateTechnicalIndicators,
  constrainMoveByAtr,
  emaSeries,
  rsiSeries,
  DEFAULT_TEJABI_RATIO,
  TOLA_GRAMS,
  TROY_OUNCE_GRAMS,
} from '../lib/goldEngine'
import type { OhlcCandle } from '../lib/types'

function series(length = 260): OhlcCandle[] {
  return Array.from({ length }, (_, index) => {
    const close = 2200 + index * 1.35 + Math.sin(index / 5) * 18
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      timestamp: Date.UTC(2025, 0, 1 + index) / 1000,
      open: close - 4,
      high: close + 12,
      low: close - 13,
      close,
      volume: 1000 + index,
    }
  })
}

test('EMA uses a full-period SMA seed and keeps warm-up values null', () => {
  const result = emaSeries([1, 2, 3, 4, 5], 3)
  assert.deepEqual(result.slice(0, 2), [null, null])
  assert.equal(result[2], 2)
  assert.equal(result[3], 3)
  assert.equal(result[4], 4)
})

test('RSI handles monotonic, falling and flat series without NaN', () => {
  assert.equal(rsiSeries(Array.from({ length: 20 }, (_, index) => index + 1), 14).at(-1), 100)
  assert.equal(rsiSeries(Array.from({ length: 20 }, (_, index) => 30 - index), 14).at(-1), 0)
  assert.equal(rsiSeries(Array.from({ length: 20 }, () => 42), 14).at(-1), 50)
})

test('ATR captures true range gaps and indicator pack returns the requested periods', () => {
  const candles = series()
  const indicators = calculateTechnicalIndicators(candles)
  assert.ok(indicators)
  assert.equal(indicators.ema20, indicators.series.at(-1)?.ema20)
  assert.equal(indicators.ema50, indicators.series.at(-1)?.ema50)
  assert.ok(indicators.ema200 !== null)
  assert.ok(indicators.rsi14 !== null)
  assert.ok(indicators.macdHistogram !== null)
  assert.ok(indicators.bollingerUpper! > indicators.bollingerMiddle!)
  assert.ok(indicators.bollingerLower! < indicators.bollingerMiddle!)
  assert.ok(indicators.atr14! > 0)
  const gapCandles = [
    { ...candles[0], open: 100, high: 102, low: 99, close: 101 },
    { ...candles[1], open: 120, high: 122, low: 119, close: 121 },
  ]
  assert.equal(atrSeries(gapCandles, 2).at(-1), 12)
})

test('Nepal parity follows ounce, tola, duty, premium, spread and nearest-hundred rounding', () => {
  const xau = 3100
  const fx = 150
  const result = calculateNepalForecast({
    predictedXauUsd: xau,
    usdNpr: fx,
    customsDutyPct: 15,
    bankFreightPct: 1,
    localSpreadPct: 5,
    today24kTola: 250_000,
    spreadSampleCount: 22,
  })
  assert.ok(result)
  const basePerGram = (xau / TROY_OUNCE_GRAMS) * fx
  const exactTola = basePerGram * TOLA_GRAMS * 1.15 * 1.01 * 1.05
  assert.ok(Math.abs(result.exact24kTolaNpr - exactTola) < 1e-8)
  assert.equal(result.predicted24kTolaNpr, Math.round(exactTola / 100) * 100)
  assert.equal(result.predicted22kTolaNpr, Math.round((exactTola * 0.9167) / 100) * 100)
  assert.equal(result.predicted22k10gNpr, Math.round((result.exact24k10gNpr * 0.9167) / 100) * 100)
  assert.equal(result.predictedTejabiTolaNpr, Math.round((result.exact24kTolaNpr * DEFAULT_TEJABI_RATIO) / 100) * 100)
  assert.equal(result.predictedTejabi10gNpr, Math.round((result.exact24k10gNpr * DEFAULT_TEJABI_RATIO) / 100) * 100)
  assert.equal(result.expectedChangeTolaNpr, result.predicted24kTolaNpr - 250_000)

  const fxProjected = calculateNepalForecast({
    predictedXauUsd: xau,
    usdNpr: fx,
    customsDutyPct: 15,
    bankFreightPct: 1,
    localSpreadPct: 5,
    usdNprMovePct: 0.25,
  })
  assert.ok(fxProjected)
  assert.equal(fxProjected?.fxMovePct, 0.25)
  assert.ok(Math.abs((fxProjected?.fxRate ?? 0) - fx * 1.0025) < 1e-10)
  assert.ok(Math.abs((fxProjected?.exact24kTolaNpr ?? 0) / result.exact24kTolaNpr - 1.0025) < 1e-10)
})

test('macro ensemble maps DXY and yields inversely, futures repricing and investment demand directly', () => {
  const factors = calculateMacroFactorContributions({
    dxyChangePct: 0.5,
    real10yChangePp: 0.1,
    nominal10yChangePp: -0.4,
    fedFundsFuturesChange: 0.1,
    etfFlowUsdBn: 10,
    centralBankNetPurchasesTonnes: 20,
  })
  assert.ok(Math.abs((factors.dxyPct ?? 0) - -0.12) < 1e-12)
  assert.ok(Math.abs((factors.us10yYieldPct ?? 0) - -0.06) < 1e-12)
  assert.ok(Math.abs((factors.rateCutExpectationsPct ?? 0) - 0.075) < 1e-12)
  assert.ok(Math.abs((factors.etfFlowsPct ?? 0) - 0.06) < 1e-12)
  assert.ok(Math.abs((factors.centralBankDemandPct ?? 0) - 0.024) < 1e-12)
  assert.equal(factors.activeFactors, 5)
  assert.ok(Math.abs(factors.totalPct - -0.021) < 1e-12)

  const missing = calculateMacroFactorContributions({ dxyChangePct: null, etfFlowUsdBn: Number.NaN })
  assert.equal(missing.activeFactors, 0)
  assert.equal(missing.totalPct, 0)
  assert.equal(missing.dxyPct, null)
  assert.equal(missing.etfFlowsPct, null)
})

test('rolling local spread uses matched feeds and anchors the latest implied basis', () => {
  const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
  const xau = 4000
  const fx = 150
  const parity = (xau / TROY_OUNCE_GRAMS) * fx * TOLA_GRAMS * 1.15 * 1.01
  const local = dates.map((date) => ({ date, perTola: parity * 1.05, per10g: parity * 1.05 * 10 / TOLA_GRAMS }))
  const candles = dates.map((date, index) => ({ ...series(4)[index], date, close: xau, open: xau, high: xau + 5, low: xau - 5 }))
  const fxHistory = dates.map((date) => ({ date, value: fx }))
  const spread = calculateRollingImpliedSpread(local, candles, fxHistory, {
    latestLocalTola: parity * 1.05,
    latestXauUsd: xau,
    latestFx: fx,
    date: dates.at(-1)!,
  })
  assert.equal(spread.method, 'rolling-30d-anchored')
  assert.equal(spread.sampleCount, dates.length)
  assert.ok(Math.abs((spread.spreadPct ?? 0) - 5) < 1e-8)
})

test('rolling spread calibration resists one isolated local-basis outlier', () => {
  const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
  const xau = 4_000
  const fx = 150
  const parity = (xau / TROY_OUNCE_GRAMS) * fx * TOLA_GRAMS * 1.15 * 1.01
  const local = dates.map((date, index) => ({
    date,
    perTola: parity * (index === 3 ? 1.25 : 1.05),
    per10g: parity * (index === 3 ? 1.25 : 1.05) * 10 / TOLA_GRAMS,
  }))
  const candles = dates.map((date, index) => ({ ...series(4)[index], date, close: xau, open: xau, high: xau + 5, low: xau - 5 }))
  const fxHistory = dates.map((date) => ({ date, value: fx }))
  const spread = calculateRollingImpliedSpread(local, candles, fxHistory, {
    latestLocalTola: local.at(-1)!.perTola,
    latestXauUsd: xau,
    latestFx: fx,
    date: dates.at(-1)!,
  })
  assert.equal(spread.method, 'rolling-30d-anchored')
  assert.equal(spread.sampleCount, 4)
  assert.ok((spread.spreadPct ?? 100) < 8, `outlier should be damped, got ${spread.spreadPct}`)
})

test('ATR move constraint clips ordinary outliers but permits an explicit severe-event exception', () => {
  const normal = constrainMoveByAtr(8, 40, 4_000)
  assert.equal(normal.normalLimitPct, 1.4)
  assert.equal(normal.changePct, 1.4)
  assert.equal(normal.severeEventException, false)

  const severe = constrainMoveByAtr(8, 40, 4_000, true)
  assert.equal(severe.changePct, 8)
  assert.equal(severe.appliedLimitPct, 8)
  assert.equal(severe.severeEventException, true)
})

test('walk-forward ledger reports actual observations only after the EMA200 warm-up', () => {
  const metrics = calculateBacktest(series())
  assert.equal(metrics.length, 3)
  assert.equal(metrics[0].observations, 7)
  assert.equal(metrics[1].observations, 30)
  assert.ok(metrics[2].observations > 0 && metrics[2].observations <= 90)
  const thirtyDay = metrics.find((item) => item.days === 30)
  assert.ok(thirtyDay)
  assert.equal(thirtyDay?.label, '30-day walk-forward')
  assert.equal(thirtyDay?.observations, 30)
  assert.ok(thirtyDay?.directionalWinRatePct !== null && (thirtyDay?.directionalWinRatePct ?? -1) >= 0 && (thirtyDay?.directionalWinRatePct ?? 101) <= 100)
  assert.ok(thirtyDay?.rmseUsd !== null && (thirtyDay?.rmseUsd ?? 0) >= 0)
  assert.ok(metrics.every((item) => item.mapePct === null || (Number.isFinite(item.mapePct) && item.mapePct >= 0)))
})
