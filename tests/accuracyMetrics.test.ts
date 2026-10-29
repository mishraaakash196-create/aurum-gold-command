import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateAccuracyMetrics } from '@/tracking/metrics'
import type { PredictionLogEntry } from '@/lib/types'

function log(id: string, daysAgo: number, base: number, low: number, high: number, direction: 'up' | 'down' | 'flat', reference: number, actual: number): PredictionLogEntry {
  const day = new Date(Date.UTC(2026, 5, 1) - daysAgo * 86_400_000).toISOString().slice(0, 10)
  const targetAt = `${day}T05:15:00.000Z`
  const createdAt = new Date(Date.parse(targetAt) - 60 * 60_000).toISOString()
  const prediction = { low, base, high, direction, reference, upProbabilityPct: 60, downProbabilityPct: 40, confidencePct: 60, confidence: 'Medium' as const }
  const start = { value: reference, observedAt: new Date(Date.parse(targetAt) - 86_400_000).toISOString(), source: 'test', targetAt, precision: 'exact' as const, note: 'test window' }
  const end = { value: actual, observedAt: targetAt, source: 'test', targetAt, precision: 'exact' as const, note: 'test target' }
  return {
    id, createdAt, targetDate: day, targetAt,
    fixingWindow: { previousFixingTargetAt: start.targetAt, targetObservationTargetAt: targetAt, startObservation: start, targetObservation: end, status: 'exact-window', note: 'test' },
    inputs: { spotXauUsd: reference, usdNpr: null, usdNprSource: 'NRB', xauSource: 'XAUS', localSpreadPct: null, confidencePct: 60, macroContributions: null, observedMarketInputs: { dxy: null, dxyChangePct: null, us10yNominalPct: null, us10yRealPct: null, ratePathProxy: null, reportedEtfFlowUsdBn: null, reportedCentralBankTonnes: null, official24kPerTolaNpr: null } },
    predictions: { 'xau-usd': prediction, 'nepal-24k': prediction, 'nepal-22k': prediction, 'nepal-tejabi': prediction },
    actuals: { 'xau-usd': { value: actual, observedAt: targetAt, source: 'test fixture' } },
  }
}

test('accuracy metrics calculate aligned range hit rate, MAE, MAPE and direction accuracy', () => {
  const entries = [
    log('a', 1, 100, 90, 110, 'up', 95, 105),
    log('b', 2, 200, 190, 210, 'down', 210, 220),
    log('old', 40, 400, 350, 450, 'flat', 400, 400),
  ]
  const now = new Date('2026-06-01T12:00:00.000Z')
  const metric7 = calculateAccuracyMetrics(entries, now).find((item) => item.days === 7 && item.instrument === 'xau-usd')!
  assert.equal(metric7.observations, 2)
  assert.equal(metric7.rangeHitRatePct, 50)
  assert.equal(metric7.mae, 12.5)
  assert.equal(metric7.directionAccuracyPct, 50)
  assert.ok(metric7.mapePct !== null && metric7.mapePct > 6.9 && metric7.mapePct < 7.0)
  const metric30 = calculateAccuracyMetrics(entries, now).find((item) => item.days === 30 && item.instrument === 'xau-usd')!
  assert.equal(metric30.observations, 2)
  const metric90 = calculateAccuracyMetrics(entries, now).find((item) => item.days === 90 && item.instrument === 'xau-usd')!
  assert.equal(metric90.observations, 3)
})
