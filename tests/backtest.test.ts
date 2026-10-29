import test from 'node:test'
import assert from 'node:assert/strict'
import { replayOhlcvBacktest } from '@/tracking/backtest'
import type { OhlcCandle } from '@/lib/types'

test('OHLCV replay is chronological and reports range hit, MAE, MAPE and direction metrics', () => {
  const candles: OhlcCandle[] = Array.from({ length: 305 }, (_, index) => {
    const close = 2100 + index * 0.9 + Math.sin(index / 5) * 12
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10)
    return { date, timestamp: Date.parse(`${date}T00:00:00Z`) / 1000, open: close - 2, high: close + 8, low: close - 8, close, volume: 1000 + index }
  })
  const rows = replayOhlcvBacktest(candles)
  assert.deepEqual(rows.map((row) => row.days), [7, 30, 90])
  assert.equal(rows[0].observations, 7)
  assert.equal(rows[1].observations, 30)
  assert.ok(rows[2].observations > 0 && rows[2].observations <= 90)
  for (const row of rows) {
    assert.ok(row.mae !== null && row.mae >= 0)
    assert.ok(row.mapePct !== null && row.mapePct >= 0)
    assert.ok(row.rangeHitRatePct !== null && row.rangeHitRatePct >= 0 && row.rangeHitRatePct <= 100)
    assert.ok(row.directionAccuracyPct !== null && row.directionAccuracyPct >= 0 && row.directionAccuracyPct <= 100)
  }
})
