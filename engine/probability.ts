import type { NepalForecast, QuantForecast } from '@/lib/types'
import { parityByXauBounds } from './parity'

export type ConfidenceLevel = 'Low' | 'Medium' | 'High'
export interface ProbabilisticInstrumentForecast {
  instrument: 'xau-usd' | 'nepal-24k' | 'nepal-22k' | 'nepal-tejabi'
  label: string
  unit: 'USD/oz' | 'NPR/tola'
  direction: 'up' | 'down' | 'flat'
  upProbabilityPct: number
  downProbabilityPct: number
  low: number
  base: number
  high: number
  reference: number | null
  confidencePct: number
  confidence: ConfidenceLevel
}
export type ProbabilisticForecast = Record<ProbabilisticInstrumentForecast['instrument'], ProbabilisticInstrumentForecast>

export function confidenceLevel(percent: number): ConfidenceLevel {
  return percent >= 72 ? 'High' : percent >= 58 ? 'Medium' : 'Low'
}

function probabilities(changePct: number, volatilityPct: number, confidencePct: number): { direction: 'up' | 'down' | 'flat'; upProbabilityPct: number; downProbabilityPct: number } {
  const direction = changePct > 0.015 ? 'up' : changePct < -0.015 ? 'down' : 'flat'
  if (direction === 'flat') return { direction, upProbabilityPct: 50, downProbabilityPct: 50 }
  const normalized = volatilityPct > 0 ? Math.abs(changePct) / volatilityPct : 0
  const edge = Math.round(Math.min(22, Math.max(4, 4 + Math.min(1.5, normalized) * 11) * Math.min(1.15, Math.max(0.7, confidencePct / 65))) * 10) / 10
  const favored = Math.min(72, 50 + edge)
  return {
    direction,
    upProbabilityPct: direction === 'up' ? favored : 100 - favored,
    downProbabilityPct: direction === 'down' ? favored : 100 - favored,
  }
}

export function buildProbabilisticForecast(
  global: QuantForecast | null,
  nepal: NepalForecast | null,
  references: { xauUsd: number | null; nepal24k: number | null; nepal22k?: number | null; tejabi?: number | null },
): ProbabilisticForecast | null {
  if (!global) return null
  const confidencePct = global.confidencePct
  const xauReference = references.xauUsd !== null && references.xauUsd > 0 ? references.xauUsd : global.currentXauUsd
  const xauVolatilityPct = global.currentXauUsd > 0 ? Math.max(0.15, global.atr14Usd / global.currentXauUsd * 100) : 0.5
  const xauMove = xauReference > 0 ? (global.predictedXauUsd - xauReference) / xauReference * 100 : 0
  const xauProbability = probabilities(xauMove, xauVolatilityPct, confidencePct)
  const xau: ProbabilisticInstrumentForecast = {
    instrument: 'xau-usd', label: 'XAU/USD', unit: 'USD/oz', ...xauProbability,
    low: global.rangeLow, base: global.predictedXauUsd, high: global.rangeHigh,
    reference: references.xauUsd, confidencePct, confidence: confidenceLevel(confidencePct),
  }
  if (!nepal) {
    return {
      'xau-usd': xau,
      'nepal-24k': emptyLocal('nepal-24k', '24K Hallmark', 0, confidencePct),
      'nepal-22k': emptyLocal('nepal-22k', '22K', 0, confidencePct),
      'nepal-tejabi': emptyLocal('nepal-tejabi', 'Tejabi · modelled ratio', 0, confidencePct),
    }
  }
  const ranges = parityByXauBounds(nepal, global.rangeLow, global.predictedXauUsd, global.rangeHigh)
  const buildLocal = (
    instrument: ProbabilisticInstrumentForecast['instrument'], label: string, range: { low: number; base: number; high: number }, reference: number | null,
  ): ProbabilisticInstrumentForecast => {
    const movePct = reference && reference > 0 ? ((range.base - reference) / reference) * 100 : xauMove
    const localProbability = probabilities(movePct, xauVolatilityPct, confidencePct)
    return {
      instrument, label, unit: 'NPR/tola', ...localProbability,
      low: range.low, base: range.base, high: range.high,
      reference, confidencePct, confidence: confidenceLevel(confidencePct),
    }
  }
  return {
    'xau-usd': xau,
    'nepal-24k': buildLocal('nepal-24k', '24K Hallmark', ranges.nepal24k, references.nepal24k),
    'nepal-22k': buildLocal('nepal-22k', '22K', ranges.nepal22k, references.nepal22k ?? (references.nepal24k === null ? null : references.nepal24k * 0.9167)),
    'nepal-tejabi': buildLocal('nepal-tejabi', 'Tejabi · modelled ratio', ranges.tejabi, references.tejabi ?? (references.nepal24k === null ? null : references.nepal24k * nepal.tejabiRatio)),
  }
}

function emptyLocal(instrument: ProbabilisticInstrumentForecast['instrument'], label: string, value: number, confidencePct: number): ProbabilisticInstrumentForecast {
  return {
    instrument, label, unit: 'NPR/tola', direction: 'flat', upProbabilityPct: 50, downProbabilityPct: 50,
    low: value, base: value, high: value, reference: null,
    confidencePct, confidence: confidenceLevel(confidencePct),
  }
}
