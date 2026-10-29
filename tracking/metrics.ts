import type { AccuracyMetric, PredictionLogEntry, ProbabilisticInstrumentForecast } from '@/lib/types'
import { calculateStage4AccuracyMetrics, getMatchedOutcomes } from './stage4'

export function calculateAccuracyMetrics(entries: PredictionLogEntry[], now = new Date()): AccuracyMetric[] {
  return calculateStage4AccuracyMetrics(entries, now)
}

export function buildAccuracySeries(entries: PredictionLogEntry[], maximum = 120) {
  const instruments: ProbabilisticInstrumentForecast['instrument'][] = ['xau-usd', 'nepal-24k', 'nepal-22k', 'nepal-tejabi']
  return instruments.flatMap((instrument) => getMatchedOutcomes(entries, instrument)
    .slice(-maximum)
    .map((row) => {
      const window = row.entry.fixingWindow ?? row.entry.snapshot?.fixingWindow
      const targetPoint = window?.targetObservation
      const startPoint = window?.startObservation
      const localInputs = row.entry.snapshot?.localModelInputs
      const localAsOf = localInputs?.rateAsOf ?? null
      const localHasExactTime = Boolean(localAsOf && /T\d{2}:\d{2}/.test(localAsOf))
      return {
        date: row.targetAt,
        targetDate: row.entry.targetDate,
        instrument,
        predicted: row.prediction.base,
        actual: row.actual.value,
        referenceValue: row.reference,
        referenceSource: instrument === 'xau-usd' ? startPoint?.source ?? null : localInputs?.rateSource ?? null,
        referenceDate: instrument === 'xau-usd' ? startPoint?.observedAt.slice(0, 10) ?? null : localInputs?.rateDate ?? null,
        windowStartTargetAt: window?.previousFixingTargetAt ?? null,
        windowStartObservedAt: instrument === 'xau-usd' ? startPoint?.observedAt ?? null : localHasExactTime ? localAsOf : null,
        windowTargetAt: instrument === 'xau-usd' ? window?.targetObservationTargetAt ?? null : row.entry.targetAt,
        windowActualObservedAt: instrument === 'xau-usd' ? targetPoint?.observedAt ?? null : localHasExactTime ? row.actual.observedAt : null,
        windowPrecision: instrument === 'xau-usd' ? targetPoint?.precision ?? null : 'FENEGOSIDA date-only source; nominal 11:00 NPT fixing',
        windowNote: instrument === 'xau-usd' ? targetPoint?.note ?? window?.note ?? null : `${localInputs?.rateSource ?? 'FENEGOSIDA'} fixing dated ${localInputs?.rateDate ?? 'unknown'}; source does not report an exact observation time.`,
        rangeMethod: row.entry.snapshot?.model.rangeMethods?.[instrument] ?? 'volatility-based, not error-based',
        source: row.actual.source,
      }
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
