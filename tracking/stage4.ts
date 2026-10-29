import type { AccuracyMetric, BaselineComparison, CalibrationSummary, EmpiricalRange, PredictionLogEntry, ProbabilisticForecast, ProbabilisticInstrumentForecast } from '@/lib/types'

export const STAGE4_MIN_MATCHED_OUTCOMES = 20
export const STAGE4_MIN_RANGE_OUTCOMES = 30
export const STAGE4_MIN_CALIBRATION_OUTCOMES = 100
const WINDOWS = [7, 30, 90] as const
const INSTRUMENTS: ProbabilisticInstrumentForecast['instrument'][] = ['xau-usd', 'nepal-24k', 'nepal-22k', 'nepal-tejabi']

export interface ScoredOutcome {
  entry: PredictionLogEntry
  instrument: ProbabilisticInstrumentForecast['instrument']
  prediction: PredictionLogEntry['predictions'][ProbabilisticInstrumentForecast['instrument']]
  actual: NonNullable<PredictionLogEntry['actuals'][ProbabilisticInstrumentForecast['instrument']]>
  reference: number
  targetAt: string
  precision: 'exact' | 'approximate-window'
}

function alignedOutcomes(entries: PredictionLogEntry[], instrument: ProbabilisticInstrumentForecast['instrument']): ScoredOutcome[] {
  const byTarget = new Map<string, ScoredOutcome>()
  for (const entry of entries) {
    const actual = entry.actuals?.[instrument]
    const prediction = entry.predictions?.[instrument]
    const window = entry.fixingWindow ?? entry.snapshot?.fixingWindow
    const reference = prediction?.reference
    if (!actual || !prediction || reference === null || reference === undefined || !Number.isFinite(reference) || !window?.startObservation) continue
    const targetAt = instrument === 'xau-usd' ? window.targetObservationTargetAt : entry.targetAt
    if (!targetAt || !Number.isFinite(Date.parse(targetAt))) continue
    const created = Date.parse(entry.createdAt)
    // Only grade forecasts issued before the relevant observed point.
    if (!Number.isFinite(created) || created >= Date.parse(targetAt)) continue
    if (instrument === 'xau-usd' && !window.targetObservation) continue
    const precision = instrument === 'xau-usd' ? window.targetObservation?.precision ?? 'approximate-window' : window.startObservation.precision
    const row: ScoredOutcome = { entry, instrument, prediction, actual, reference, targetAt, precision }
    const current = byTarget.get(entry.targetDate)
    if (!current || entry.createdAt > current.entry.createdAt) byTarget.set(entry.targetDate, row)
  }
  return [...byTarget.values()].sort((a, b) => a.targetAt.localeCompare(b.targetAt))
}

export function getMatchedOutcomes(entries: PredictionLogEntry[], instrument: ProbabilisticInstrumentForecast['instrument']): ScoredOutcome[] {
  return alignedOutcomes(entries, instrument)
}

export function summarizeFixingWindowQuality(entries: PredictionLogEntry[], now = new Date()) {
  const latestByTarget = new Map<string, PredictionLogEntry>()
  for (const entry of entries) {
    const window = entry.fixingWindow ?? entry.snapshot?.fixingWindow
    if (!window?.targetObservationTargetAt || Date.parse(entry.createdAt) >= Date.parse(window.targetObservationTargetAt)) continue
    const existing = latestByTarget.get(entry.targetDate)
    if (!existing || entry.createdAt > existing.createdAt) latestByTarget.set(entry.targetDate, entry)
  }
  const result = { exact: 0, approximate: 0, unavailable: 0, awaiting: 0 }
  for (const entry of latestByTarget.values()) {
    const window = entry.fixingWindow ?? entry.snapshot?.fixingWindow
    if (!window || Date.parse(window.targetObservationTargetAt) > now.getTime()) { result.awaiting += 1; continue }
    if (!window.targetObservation) {
      if (window.status === 'unavailable') result.unavailable += 1
      else result.awaiting += 1
    } else if (window.startObservation?.precision === 'exact' && window.targetObservation.precision === 'exact') result.exact += 1
    else result.approximate += 1
  }
  return { ...result, note: result.unavailable ? 'Unavailable target observations are excluded; no substitute price is fabricated.' : 'Exact and approximate windows are kept separate; older logs without snapshots are not retroactively aligned.' }
}

function scoreRows(rows: ScoredOutcome[]) {
  if (!rows.length) return { observations: 0, mae: null, mapePct: null, directionAccuracyPct: null }
  let mae = 0; let mape = 0; let correct = 0
  for (const row of rows) {
    const error = Math.abs(row.prediction.base - row.actual.value)
    mae += error
    mape += error / row.actual.value * 100
    const actualDirection = Math.sign(row.actual.value - row.reference)
    const aurumDirection = Math.sign(row.prediction.base - row.reference)
    if (aurumDirection === actualDirection) correct += 1
  }
  return { observations: rows.length, mae: mae / rows.length, mapePct: mape / rows.length, directionAccuracyPct: correct / rows.length * 100 }
}

export function calculateBaselineComparison(entries: PredictionLogEntry[], instrument: 'xau-usd' | 'nepal-24k', now = new Date()): BaselineComparison {
  const outcomes = alignedOutcomes(entries, instrument)
  const totalMatched = outcomes.length
  const windows = WINDOWS.map((days) => {
    const cutoff = now.getTime() - days * 86_400_000
    const rows = outcomes.filter((row) => Date.parse(row.targetAt) >= cutoff && Date.parse(row.targetAt) <= now.getTime())
    const aurum = scoreRows(rows)
    let naiveMae = 0; let naiveMape = 0; let naiveDirection = 0
    for (const row of rows) {
      const error = Math.abs(row.reference - row.actual.value)
      naiveMae += error
      naiveMape += error / row.actual.value * 100
      if (Math.sign(row.actual.value - row.reference) === 0) naiveDirection += 1
    }
    const count = rows.length
    const naive = {
      observations: count,
      mae: count ? naiveMae / count : null,
      mapePct: count ? naiveMape / count : null,
      directionAccuracyPct: count ? naiveDirection / count * 100 : null,
    }
    const enough = totalMatched >= STAGE4_MIN_MATCHED_OUTCOMES
    const beats = enough && count > 0 && aurum.mae !== null && naive.mae !== null && aurum.mapePct !== null && naive.mapePct !== null && aurum.directionAccuracyPct !== null && naive.directionAccuracyPct !== null
      ? aurum.mae < naive.mae && aurum.mapePct < naive.mapePct && aurum.directionAccuracyPct >= naive.directionAccuracyPct
      : null
    return { days, aurum, naive, beatsBaseline: beats }
  })
  return { instrument, totalMatched, minimumRequired: STAGE4_MIN_MATCHED_OUTCOMES, status: totalMatched >= STAGE4_MIN_MATCHED_OUTCOMES ? 'ready' : 'not-enough-data', windows }
}

export function calculateStage4AccuracyMetrics(entries: PredictionLogEntry[], now = new Date()): AccuracyMetric[] {
  return WINDOWS.flatMap((days) => INSTRUMENTS.map((instrument) => {
    const cutoff = now.getTime() - days * 86_400_000
    const rows = alignedOutcomes(entries, instrument).filter((row) => Date.parse(row.targetAt) >= cutoff && Date.parse(row.targetAt) <= now.getTime())
    const scored = scoreRows(rows)
    let hits = 0
    for (const row of rows) if (row.actual.value >= row.prediction.low && row.actual.value <= row.prediction.high) hits += 1
    return { days, instrument, observations: rows.length, mae: scored.mae, mapePct: scored.mapePct, directionAccuracyPct: scored.directionAccuracyPct, rangeHitRatePct: rows.length ? hits / rows.length * 100 : null }
  }))
}

function quantile(values: number[], probability: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position); const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function empiricalErrorRange(entries: PredictionLogEntry[], instrument: ProbabilisticInstrumentForecast['instrument'], minimum = STAGE4_MIN_RANGE_OUTCOMES): EmpiricalRange | null {
  const rows = alignedOutcomes(entries, instrument)
  if (rows.length < minimum) return null
  const residuals = rows.map((row) => row.actual.value - row.prediction.base)
  const lowerError = quantile(residuals, 0.1)
  const upperError = quantile(residuals, 0.9)
  if (lowerError === null || upperError === null) return null
  return { method: 'empirical-error', samples: rows.length, lowerError, upperError, lowerQuantile: 10, upperQuantile: 90 }
}

export function applyEmpiricalRange(base: number, range: EmpiricalRange, regimeMultiplier: number): { low: number; high: number } {
  const multiplier = Number.isFinite(regimeMultiplier) && regimeMultiplier > 0 ? regimeMultiplier : 1
  return {
    low: Math.max(0, base + range.lowerError * multiplier),
    high: Math.max(0, base + range.upperError * multiplier),
  }
}

interface CalibrationPair { probability: number; outcome: 0 | 1 }
interface IsotonicBlock { minProbability: number; maxProbability: number; calibratedProbability: number; count: number }

function calibrationPairs(entries: PredictionLogEntry[], instrument: ProbabilisticInstrumentForecast['instrument']): CalibrationPair[] {
  return alignedOutcomes(entries, instrument).flatMap((row) => {
    const raw = row.prediction.upProbabilityPct / 100
    const actualDirection = Math.sign(row.actual.value - row.reference)
    if (!Number.isFinite(raw) || actualDirection === 0) return []
    return [{ probability: Math.max(0, Math.min(1, raw)), outcome: actualDirection > 0 ? 1 as const : 0 as const }]
  })
}

function fitIsotonic(pairs: CalibrationPair[]): IsotonicBlock[] {
  const sorted = [...pairs].sort((a, b) => a.probability - b.probability)
  const blocks: Array<{ sumP: number; sumY: number; count: number; min: number; max: number }> = []
  for (const pair of sorted) {
    blocks.push({ sumP: pair.probability, sumY: pair.outcome, count: 1, min: pair.probability, max: pair.probability })
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1]
      const left = blocks[blocks.length - 2]
      if (left.sumY / left.count <= right.sumY / right.count) break
      blocks.splice(-2, 2, { sumP: left.sumP + right.sumP, sumY: left.sumY + right.sumY, count: left.count + right.count, min: left.min, max: right.max })
    }
  }
  return blocks.map((block) => ({ minProbability: block.min, maxProbability: block.max, calibratedProbability: block.sumY / block.count, count: block.count }))
}

export function applyIsotonicCalibration(upProbabilityPct: number, blocks: IsotonicBlock[]): number {
  const p = Math.max(0, Math.min(1, upProbabilityPct / 100))
  if (!blocks.length) return upProbabilityPct
  const block = blocks.find((item) => p >= item.minProbability && p <= item.maxProbability)
    ?? (p < blocks[0].minProbability ? blocks[0] : blocks[blocks.length - 1])
  return Math.round(block.calibratedProbability * 1000) / 10
}

function bucketLabel(index: number) { const lower = 20 + index * 10; return `${lower}–${lower + 10}%` }

export function calculateCalibrationSummary(entries: PredictionLogEntry[], instrument: ProbabilisticInstrumentForecast['instrument']): CalibrationSummary {
  const pairs = calibrationPairs(entries, instrument)
  const calibrated = pairs.length >= STAGE4_MIN_CALIBRATION_OUTCOMES
  const bins = Array.from({ length: 6 }, (_, index) => ({ label: bucketLabel(index), lower: (20 + index * 10) / 100, upper: (30 + index * 10) / 100, probs: [] as number[], hits: 0 }))
  for (const pair of pairs) {
    const index = Math.min(5, Math.max(0, Math.floor((pair.probability - 0.2) * 10)))
    bins[index].probs.push(pair.probability)
    bins[index].hits += pair.outcome
  }
  const blocks = calibrated ? fitIsotonic(pairs) : []
  return {
    instrument,
    method: calibrated ? 'isotonic' : 'uncalibrated',
    samples: pairs.length,
    minimumRequired: STAGE4_MIN_CALIBRATION_OUTCOMES,
    buckets: bins.map((bin) => ({ label: bin.label, observations: bin.probs.length, meanForecastPct: bin.probs.length ? bin.probs.reduce((sum, value) => sum + value, 0) / bin.probs.length * 100 : null, actualUpRatePct: bin.probs.length ? bin.hits / bin.probs.length * 100 : null })),
    isotonicBlocks: blocks,
  }
}

export function calibrateProbabilisticForecast(forecast: ProbabilisticForecast, summaries: Record<string, CalibrationSummary>): ProbabilisticForecast {
  const calibrated = { ...forecast }
  for (const instrument of INSTRUMENTS) {
    const summary = summaries[instrument]
    if (!summary || summary.method !== 'isotonic') continue
    const item = calibrated[instrument]
    const up = applyIsotonicCalibration(item.upProbabilityPct, summary.isotonicBlocks)
    calibrated[instrument] = { ...item, upProbabilityPct: up, downProbabilityPct: Math.round((100 - up) * 10) / 10 }
  }
  return calibrated
}
