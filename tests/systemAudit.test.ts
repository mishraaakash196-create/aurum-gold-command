import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLiveChartPoint, isLiveChartPointSynced, selectPriceMoveAlarm } from '../lib/systemAudit'

test('live chart points use the exact quote-card value and reject missing/non-finite observations', () => {
  const point = buildLiveChartPoint(4_023.6, 'LIVE SPOT')
  assert.ok(point)
  assert.equal(point?.close, 4_023.6)
  assert.equal(point?.actual, 4_023.6)
  assert.equal(point?.kind, 'live')
  assert.equal(isLiveChartPointSynced(point, 4_023.6), true)
  assert.equal(isLiveChartPointSynced(point, 4_023.61), false)
  assert.equal(buildLiveChartPoint(null), null)
  assert.equal(buildLiveChartPoint(Number.NaN), null)
})

test('daily official move alarm detects threshold-crossing rises and drops, not sub-threshold noise', () => {
  const rise = selectPriceMoveAlarm([{ source: 'daily', changeNprPerTola: 3_000 }], 2_000)
  assert.equal(rise?.source, 'daily')
  assert.equal(rise?.direction, 'surge')
  assert.equal(rise?.changeNprPerTola, 3_000)

  const drop = selectPriceMoveAlarm([{ source: 'daily', changeNprPerTola: -2_500 }], 2_000)
  assert.equal(drop?.direction, 'drop')
  assert.equal(selectPriceMoveAlarm([{ source: 'daily', changeNprPerTola: 1_999 }], 2_000), null)
  assert.equal(selectPriceMoveAlarm([{ source: 'daily', changeNprPerTola: null }], 2_000), null)
})

test('alarm priority preserves real daily moves while explicitly selected simulations can override', () => {
  const candidates = [
    { source: 'forecast' as const, changeNprPerTola: -4_000 },
    { source: 'daily' as const, changeNprPerTola: 3_000 },
  ]
  assert.equal(selectPriceMoveAlarm(candidates, 2_000)?.source, 'daily')
  assert.equal(selectPriceMoveAlarm([
    ...candidates,
    { source: 'simulated', changeNprPerTola: -2_600 },
  ], 2_000)?.source, 'simulated')
})
