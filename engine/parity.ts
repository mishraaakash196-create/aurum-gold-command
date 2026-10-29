import { DEFAULT_TEJABI_RATIO, GOLD_22K_PURITY, TOLA_GRAMS, TROY_OUNCE_GRAMS, roundToHundred, clamp } from '@/lib/goldEngine'
import type { NepalForecast, ParitySettings, TejabiRatioObservation, TejabiRatioState } from '@/lib/types'

export const DEFAULT_PARITY_SETTINGS: ParitySettings = {
  customsDutyPct: 15,
  vatOtherLevyPct: 1,
  dealerMarginPct: 0,
  tejabiManualRatio: DEFAULT_TEJABI_RATIO,
}

export interface ImportParityInput {
  spotXauUsd: number
  usdNpr: number
  usdNprMovePct?: number | null
  customsDutyPct: number
  vatOtherLevyPct: number
  dealerMarginPct: number
  rollingSpreadPct: number
  spreadSampleCount?: number
  today24kTola?: number | null
  tejabiRatioState?: TejabiRatioState
  manualTejabiRatio?: number
  manualRatioUpdatedAt?: string | null
  troyOunceGrams?: number
  tolaGrams?: number
}

/** Learns from the latest seven genuine daily source pairs; otherwise returns manual input. */
export function calculateTejabiRatio(
  observations: TejabiRatioObservation[],
  manualFallback = DEFAULT_TEJABI_RATIO,
  manualUpdatedAt: string | null = null,
): TejabiRatioState {
  const byDate = new Map<string, TejabiRatioObservation>()
  for (const item of observations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.rate24kTolaNpr <= 0 || item.tejabiTolaNpr <= 0) continue
    const ratio = item.tejabiTolaNpr / item.rate24kTolaNpr
    if (!Number.isFinite(ratio) || ratio < 0.9 || ratio > 1.05) continue
    byDate.set(item.date, item)
  }
  const latest = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-7)
  if (!latest.length) return {
    ratio: clamp(manualFallback, 0.9, 1.05), source: 'manual', sampleCount: 0, windowSize: 7, lastUpdatedAt: manualUpdatedAt,
  }
  const average = latest.reduce((sum, item) => sum + item.tejabiTolaNpr / item.rate24kTolaNpr, 0) / latest.length
  const last = latest[latest.length - 1]
  return {
    ratio: Math.round(average * 1_000_000) / 1_000_000,
    source: 'learned', sampleCount: latest.length, windowSize: 7,
    lastUpdatedAt: last.observedAt || `${last.date}T00:00:00.000Z`,
  }
}

function ratioFor(input: ImportParityInput) {
  return input.tejabiRatioState ?? calculateTejabiRatio([], input.manualTejabiRatio ?? DEFAULT_TEJABI_RATIO, input.manualRatioUpdatedAt ?? null)
}

function forecastFrom24k(input: ImportParityInput, exact24kTolaNpr: number, effectiveFx: number, fxMove: number, extra: Partial<NepalForecast> = {}): NepalForecast {
  const ratioState = ratioFor(input)
  const grams = input.tolaGrams ?? TOLA_GRAMS
  const exact24k10gNpr = exact24kTolaNpr * 10 / grams
  const exact22kTolaNpr = exact24kTolaNpr * GOLD_22K_PURITY
  const exact22k10gNpr = exact24k10gNpr * GOLD_22K_PURITY
  const exactTejabiTolaNpr = exact24kTolaNpr * ratioState.ratio
  const exactTejabi10gNpr = exact24k10gNpr * ratioState.ratio
  const predicted24kTolaNpr = roundToHundred(exact24kTolaNpr)
  return {
    predicted24kTolaNpr,
    predicted24k10gNpr: roundToHundred(exact24k10gNpr),
    predicted22kTolaNpr: roundToHundred(exact22kTolaNpr),
    predicted22k10gNpr: roundToHundred(exact22k10gNpr),
    predictedTejabiTolaNpr: roundToHundred(exactTejabiTolaNpr),
    predictedTejabi10gNpr: roundToHundred(exactTejabi10gNpr),
    expectedChangeTolaNpr: input.today24kTola == null ? null : predicted24kTolaNpr - input.today24kTola,
    exact24kTolaNpr, exact24k10gNpr, exact22kTolaNpr, exact22k10gNpr,
    baseNprPerGram: exact24kTolaNpr / grams,
    fxRate: effectiveFx,
    fxMovePct: fxMove,
    fxMoveSource: fxMove === 0 ? null : undefined,
    customsDutyPct: clamp(input.customsDutyPct, 0, 60),
    bankFreightPct: clamp(input.vatOtherLevyPct, 0, 40),
    vatOtherLevyPct: clamp(input.vatOtherLevyPct, 0, 40),
    dealerMarginPct: clamp(input.dealerMarginPct, 0, 35),
    localSpreadPct: clamp(input.rollingSpreadPct, -35, 35),
    spreadSampleCount: input.spreadSampleCount ?? 0,
    tejabiRatio: ratioState.ratio,
    tejabiRatioSource: ratioState.source,
    tejabiRatioSamples: ratioState.sampleCount,
    tejabiRatioLastUpdatedAt: ratioState.lastUpdatedAt,
    ...extra,
  }
}

/** Formula-based fallback only when there is no usable FENEGOSIDA 24K anchor. */
export function calculateImportParity(input: ImportParityInput): NepalForecast | null {
  const { spotXauUsd, usdNpr } = input
  if (![spotXauUsd, usdNpr, input.customsDutyPct, input.vatOtherLevyPct, input.dealerMarginPct, input.rollingSpreadPct].every(Number.isFinite)) return null
  if (spotXauUsd <= 0 || usdNpr <= 0) return null
  const ozGrams = input.troyOunceGrams ?? TROY_OUNCE_GRAMS
  const tolaGrams = input.tolaGrams ?? TOLA_GRAMS
  if (![ozGrams, tolaGrams].every((value) => Number.isFinite(value) && value > 0)) return null
  const duty = clamp(input.customsDutyPct, 0, 60)
  const levies = clamp(input.vatOtherLevyPct, 0, 40)
  const margin = clamp(input.dealerMarginPct, 0, 35)
  const spread = clamp(input.rollingSpreadPct, -35, 35)
  const fxMove = Number.isFinite(input.usdNprMovePct) ? clamp(input.usdNprMovePct as number, -0.5, 0.5) : 0
  const effectiveFx = usdNpr * (1 + fxMove / 100)
  const metalValuePerGram = (spotXauUsd / ozGrams) * effectiveFx
  const multiplier = (1 + duty / 100) * (1 + levies / 100) * (1 + margin / 100) * (1 + spread / 100)
  const exact24kTolaNpr = metalValuePerGram * tolaGrams * multiplier
  const result = forecastFrom24k(input, exact24kTolaNpr, effectiveFx, fxMove)
  result.usedOfficialAnchor = false
  return result
}

/** Applies the market's predicted XAU/USD and USD/NPR movements to the last official local fixing. */
export function calculateAnchoredNepalForecast(input: ImportParityInput & {
  official24kTolaNpr: number
  officialRateDate: string | null
  currentXauUsd: number
  predictedXauUsd: number
}): NepalForecast | null {
  if (![input.official24kTolaNpr, input.currentXauUsd, input.predictedXauUsd, input.usdNpr].every(Number.isFinite) || input.official24kTolaNpr <= 0 || input.currentXauUsd <= 0 || input.usdNpr <= 0) return null
  const rawSpotMove = (input.predictedXauUsd / input.currentXauUsd - 1) * 100
  const spotMove = clamp(rawSpotMove, -8, 8)
  const fxMove = Number.isFinite(input.usdNprMovePct) ? clamp(input.usdNprMovePct as number, -0.5, 0.5) : 0
  const spotFactor = 1 + spotMove / 100
  const fxFactor = 1 + fxMove / 100
  const exact24kTolaNpr = input.official24kTolaNpr * spotFactor * fxFactor
  const spotAdjustmentNpr = input.official24kTolaNpr * (spotFactor - 1)
  const fxAdjustmentNpr = input.official24kTolaNpr * spotFactor * (fxFactor - 1)
  const effectiveFx = input.usdNpr * fxFactor
  const fallbackParity = input.spreadSampleCount && input.spreadSampleCount > 0 ? calculateImportParity({
    ...input, spotXauUsd: input.predictedXauUsd, usdNprMovePct: fxMove,
  }) : null
  return forecastFrom24k(input, exact24kTolaNpr, effectiveFx, fxMove, {
    usedOfficialAnchor: true,
    official24kAnchorNpr: input.official24kTolaNpr,
    officialRateDate: input.officialRateDate,
    spotMovePct: spotMove,
    spotAdjustmentNpr,
    fxAdjustmentNpr,
    unanchoredImportParity24kNpr: fallbackParity?.predicted24kTolaNpr ?? null,
    unanchoredImportParityDeltaNpr: fallbackParity ? fallbackParity.predicted24kTolaNpr - input.official24kTolaNpr : null,
  })
}

export function parityByXauBounds(base: NepalForecast, lowXau: number, baseXau: number, highXau: number): {
  nepal24k: { low: number; base: number; high: number }
  nepal22k: { low: number; base: number; high: number }
  tejabi: { low: number; base: number; high: number }
} {
  const ratio = (value: number) => baseXau > 0 ? value / baseXau : 1
  const price = (value: number) => roundToHundred(value)
  const local = (factor: number) => ({
    low: price(base.exact24kTolaNpr * ratio(lowXau) * factor),
    base: price(base.exact24kTolaNpr * factor),
    high: price(base.exact24kTolaNpr * ratio(highXau) * factor),
  })
  return {
    nepal24k: local(1),
    nepal22k: local(GOLD_22K_PURITY),
    tejabi: local(base.tejabiRatio),
  }
}
