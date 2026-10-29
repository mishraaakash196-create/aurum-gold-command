import { calculateQuantForecast } from '@/lib/goldEngine'
import type { AccuracyMetric, OhlcCandle } from '@/lib/types'

/** Strict chronological replay: each next-session forecast sees only candles before its target close. */
export function replayOhlcvBacktest(candles: OhlcCandle[]): AccuracyMetric[] {
  const windows = [7, 30, 90] as const
  return windows.map((days) => {
    const start = Math.max(200, candles.length - days - 1)
    let observations = 0
    let rangeHits = 0
    let absoluteError = 0
    let percentageError = 0
    let directionHits = 0
    for (let index = start; index < candles.length - 1; index += 1) {
      const history = candles.slice(0, index + 1)
      const current = candles[index].close
      const actual = candles[index + 1].close
      if (!(current > 0 && actual > 0)) continue
      const forecast = calculateQuantForecast(history, current)
      if (!forecast) continue
      const error = Math.abs(forecast.predictedXauUsd - actual)
      observations += 1
      absoluteError += error
      percentageError += error / actual * 100
      if (actual >= forecast.rangeLow && actual <= forecast.rangeHigh) rangeHits += 1
      if (Math.sign(forecast.predictedXauUsd - current) === Math.sign(actual - current)) directionHits += 1
    }
    return {
      days,
      instrument: 'xau-usd' as const,
      observations,
      rangeHitRatePct: observations ? rangeHits / observations * 100 : null,
      mae: observations ? absoluteError / observations : null,
      mapePct: observations ? percentageError / observations : null,
      directionAccuracyPct: observations ? directionHits / observations * 100 : null,
    }
  })
}
