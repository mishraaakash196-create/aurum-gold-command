import test from 'node:test'
import assert from 'node:assert/strict'
import type { FixingWindowAudit, PredictionLogEntry, PredictionSnapshot } from '@/lib/types'
import { applyEmpiricalRange, calculateBaselineComparison, calculateCalibrationSummary, applyIsotonicCalibration, empiricalErrorRange } from '@/tracking/stage4'
import { assessForecastReliability } from '@/engine/reliability'

function entry(index: number, day: string, options: { xauReference?: number; xauBase?: number; xauActual?: number; probability?: number; localReference?: number; localBase?: number; localActual?: number } = {}): PredictionLogEntry {
  const xauReference = options.xauReference ?? 1000
  const xauBase = options.xauBase ?? 1001
  const xauActual = options.xauActual ?? 1002
  const localReference = options.localReference ?? 100000
  const localBase = options.localBase ?? 100100
  const localActual = options.localActual ?? 100150
  const targetAt = `${day}T05:15:00.000Z`
  const createdAt = new Date(Date.parse(targetAt) - 45 * 60_000).toISOString()
  const targetPoint = { value: xauActual, observedAt: targetAt, source: 'Test spot snapshot', targetAt: new Date(Date.parse(targetAt) - 15 * 60_000).toISOString(), precision: 'exact' as const, note: 'Within five minutes of target window.' }
  const window: FixingWindowAudit = {
    previousFixingTargetAt: new Date(Date.parse(targetAt) - 86_400_000).toISOString(),
    targetObservationTargetAt: targetPoint.targetAt,
    startObservation: { value: xauReference, observedAt: new Date(Date.parse(targetAt) - 86_400_000).toISOString(), source: 'Test start', targetAt: new Date(Date.parse(targetAt) - 86_400_000).toISOString(), precision: 'exact', note: 'Test reference.' },
    targetObservation: targetPoint,
    status: 'exact-window',
    note: 'Aligned test window.',
  }
  const snapshot: PredictionSnapshot = {
    schemaVersion: 1, capturedAt: createdAt, feeds: {}, technical: null,
    localModelInputs: { official24kPerTolaNpr: localReference, rateDate: day, rateSource: 'FENEGOSIDA', rateAsOf: targetAt, localSpreadPct: null, localSpreadSamples: 0, tejabiRatio: null },
    model: { mode: 'heuristic-fallback', features: {}, weights: {}, regime: null, eventRisk: null },
    paritySettings: null, fixingWindow: window,
  }
  const prediction = (base: number, reference: number, probability = options.probability ?? 60) => ({
    low: base - 10, base, high: base + 10, direction: base > reference ? 'up' as const : base < reference ? 'down' as const : 'flat' as const,
    reference, upProbabilityPct: probability, downProbabilityPct: 100 - probability, confidencePct: 60, confidence: 'Medium' as const,
  })
  return {
    id: `stage4-${index}`, createdAt, targetDate: day, targetAt, snapshot, fixingWindow: window,
    inputs: { spotXauUsd: xauReference, usdNpr: 130, usdNprSource: 'NRB', xauSource: 'XAUS', localSpreadPct: 0, confidencePct: 60, macroContributions: null, modelFeatures: { technical: 0.2 }, observedMarketInputs: { dxy: null, dxyChangePct: null, us10yNominalPct: null, us10yRealPct: null, ratePathProxy: null, reportedEtfFlowUsdBn: null, reportedCentralBankTonnes: null, official24kPerTolaNpr: localReference } },
    predictions: {
      'xau-usd': prediction(xauBase, xauReference),
      'nepal-24k': prediction(localBase, localReference),
      'nepal-22k': prediction(localBase * 0.9167, localReference * 0.9167),
      'nepal-tejabi': prediction(localBase * 0.99, localReference * 0.99),
    },
    actuals: {
      'xau-usd': { value: xauActual, observedAt: targetAt, source: 'Test source' },
      'nepal-24k': { value: localActual, observedAt: targetAt, source: 'Test FENEGOSIDA' },
      'nepal-22k': { value: localActual * 0.9167, observedAt: targetAt, source: 'Derived test' },
      'nepal-tejabi': { value: localActual * 0.99, observedAt: targetAt, source: 'Test ratio' },
    },
  }
}

function dateFrom(base: string, offset: number) {
  const date = new Date(`${base}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

test('naive tomorrow=today baseline compares XAU and Nepal 24K on one matched outcome per fixing date', () => {
  const now = new Date('2026-06-30T12:00:00Z')
  const entries = Array.from({ length: 25 }, (_, index) => entry(index, dateFrom('2026-06-06', index), {
    xauReference: 1000, xauBase: 1001.8, xauActual: 1002,
    localReference: 100000, localBase: 100080, localActual: 100100,
  }))
  const result = calculateBaselineComparison(entries, 'xau-usd', now)
  assert.equal(result.status, 'ready')
  assert.equal(result.totalMatched, 25)
  const seven = result.windows.find((item) => item.days === 7)!
  assert.equal(seven.aurum.observations, 7)
  assert.equal(seven.beatsBaseline, true)
  assert.ok((seven.aurum.mae ?? Infinity) < (seven.naive.mae ?? 0))
  const local = calculateBaselineComparison(entries, 'nepal-24k', now)
  assert.equal(local.status, 'ready')
  assert.equal(local.windows.find((item) => item.days === 30)?.beatsBaseline, true)
})

test('baseline stays hidden until 20 aligned matched outcomes are present', () => {
  const result = calculateBaselineComparison(Array.from({ length: 19 }, (_, index) => entry(index, dateFrom('2026-06-01', index))), 'nepal-24k', new Date('2026-07-01T12:00:00Z'))
  assert.equal(result.totalMatched, 19)
  assert.equal(result.status, 'not-enough-data')
  assert.equal(result.minimumRequired, 20)
})

test('empirical ranges use P10/P90 forecast errors and scale by the current regime', () => {
  const entries = Array.from({ length: 40 }, (_, index) => entry(index, dateFrom('2026-04-01', index), { xauReference: 1000, xauBase: 1000, xauActual: 1000 + index - 20 }))
  const range = empiricalErrorRange(entries, 'xau-usd')!
  assert.equal(range.method, 'empirical-error')
  assert.equal(range.samples, 40)
  assert.ok(range.lowerError < -15 && range.lowerError > -17)
  assert.ok(range.upperError > 14 && range.upperError < 16)
  const bounds = applyEmpiricalRange(2000, range, 1.25)
  assert.ok(bounds.low < 1980 && bounds.high > 2017)
})

test('isotonic calibration buckets and adjustment are built only after 100 matched directions', () => {
  const entries = Array.from({ length: 100 }, (_, index) => {
    const day = dateFrom('2026-01-01', index)
    const isUp = index % 4 !== 0
    return entry(index, day, {
      xauReference: 1000,
      xauBase: isUp ? 1001 : 999,
      xauActual: isUp ? 1002 : 998,
      probability: 30 + (index % 6) * 10,
    })
  })
  const summary = calculateCalibrationSummary(entries, 'xau-usd')
  assert.equal(summary.method, 'isotonic')
  assert.equal(summary.samples, 100)
  assert.equal(summary.buckets.reduce((sum, bucket) => sum + bucket.observations, 0), 100)
  assert.ok(summary.buckets.some((bucket) => bucket.actualUpRatePct !== null))
  const adjusted = applyIsotonicCalibration(55, summary.isotonicBlocks)
  assert.ok(adjusted >= 0 && adjusted <= 100)
})

test('feed reliability gate rejects spot beyond configured session age and a stale official fixing', () => {
  const now = new Date('2026-01-05T12:00:00.000Z')
  const market = {
    spot: 3000,
    spotSource: 'XAUS · indicative mid',
    spotAsOf: new Date(now.getTime() - 11 * 60_000).toISOString(),
    spotStale: false,
    macro: { usdNprParity: { value: 135, source: 'NRB official rates API', asOf: new Date(now.getTime() - 30 * 60_000).toISOString(), stale: false } },
    nepal: { rate24kTola: 250000, rateDate: '2026-01-02', rateAsOf: '2026-01-02T05:15:00Z', rateStale: false, rate24kManualEntry: false },
  } as any
  const reliability = assessForecastReliability(market, now)
  assert.equal(reliability.global.state, 'low-reliability')
  assert.equal(reliability.global.feeds[0].state, 'stale')
  assert.equal(reliability.nepal.feeds.find((feed) => feed.name === 'FENEGOSIDA official 24K')?.state, 'stale')
  assert.match(reliability.nepal.reasons.join(' '), /FENEGOSIDA official rate is stale/)
})
