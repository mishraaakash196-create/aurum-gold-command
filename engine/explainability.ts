import type { EnsembleDriverScore, EnsembleModelSummary, ForecastWhyFactor, MarketSnapshot, NepalForecast, QuantForecast } from '@/lib/types'

const SCALE = 0.01

export function buildGlobalWhyFactors(
  market: MarketSnapshot,
  forecast: QuantForecast | null,
  drivers: EnsembleDriverScore[] = [],
  model?: EnsembleModelSummary,
): ForecastWhyFactor[] {
  if (!forecast) return []
  const baseScale = model?.mode === 'ridge-learned' ? 0.55 : 1
  const candidates: ForecastWhyFactor[] = []
  const pushPct = (key: string, label: string, value: number | null | undefined, source: string, asOf: string | null) => {
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.0005) candidates.push({ key, label, impact: value, unit: 'percent', source, asOf })
  }
  for (const factor of forecast.technicalFactorContributions ?? []) {
    pushPct(factor.key, factor.label, factor.impactPct * baseScale, market.historySource, market.historyAsOf)
  }
  const macro = forecast.macroFactorContributions
  if (macro) {
    if (!market.macro.dxy.stale && market.macro.dxy.value !== null) pushPct('dxy', 'U.S. dollar index (DXY)', macro.dxyPct === null ? null : macro.dxyPct * baseScale, market.macro.dxy.source, market.macro.dxy.asOf)
    const yieldMetric = macro.us10yYieldPct !== null && !market.macro.real10y.stale && market.macro.real10y.value !== null ? market.macro.real10y : market.macro.nominal10y
    pushPct('us10y-yield', yieldMetric === market.macro.real10y ? '10Y TIPS real yield' : '10Y nominal yield proxy', macro.us10yYieldPct === null ? null : macro.us10yYieldPct * baseScale, yieldMetric.source, yieldMetric.asOf)
    if (!market.macro.fedFundsFutures.stale && market.macro.fedFundsFutures.value !== null) pushPct('rate-path', 'Front-month fed-funds futures proxy', macro.rateCutExpectationsPct === null ? null : macro.rateCutExpectationsPct * baseScale, market.macro.fedFundsFutures.source, market.macro.fedFundsFutures.asOf)
    const etf = market.institutionalDemand.goldEtf
    if (etf.provenance === 'reported' && !etf.stale) pushPct('reported-etf-flows', 'Reported gold ETF flows', macro.etfFlowsPct === null ? null : macro.etfFlowsPct * baseScale, etf.source, etf.publishedAt)
    const central = market.institutionalDemand.centralBank
    if (central.provenance === 'reported' && !central.stale) pushPct('central-bank-demand', 'Reported central-bank demand', macro.centralBankDemandPct === null ? null : macro.centralBankDemandPct * baseScale, central.source, central.publishedAt)
  }
  for (const driver of drivers) {
    if (driver.contributionPct === null || !['ridge-blend', 'heuristic-overlay', 'rules-overlay'].includes(driver.contributionKind)) continue
    if (!['fresh', 'proxy', 'manual'].includes(driver.status)) continue
    if (Math.abs(driver.contributionPct) <= 0.0005) continue
    const suffix = driver.status === 'proxy' ? ' · proxy' : driver.status === 'manual' ? ' · manual input' : ''
    candidates.push({ key: `stage2-${driver.key}`, label: `${driver.label}${suffix}`, impact: driver.contributionPct, unit: 'percent', source: driver.source, asOf: driver.asOf })
  }
  return candidates.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5)
}

export function buildNepalWhyFactors(
  market: MarketSnapshot,
  nepalForecast: NepalForecast | null,
  globalFactors: ForecastWhyFactor[],
): ForecastWhyFactor[] {
  if (!nepalForecast?.usedOfficialAnchor) return []
  const anchor = nepalForecast.official24kAnchorNpr ?? market.nepal.rate24kTola
  if (anchor === null || anchor === undefined || anchor <= 0) return []
  const candidates: ForecastWhyFactor[] = globalFactors.slice(0, 4).map((factor) => ({
    ...factor,
    label: `${factor.label} · local pass-through`,
    impact: factor.impact * anchor * SCALE,
    unit: 'npr-per-tola',
  }))
  const fxImpact = nepalForecast.fxAdjustmentNpr
  if (typeof fxImpact === 'number' && Number.isFinite(fxImpact) && Math.abs(fxImpact) >= 1) {
    candidates.push({
      key: 'usd-npr-conversion',
      label: 'USD/NPR conversion adjustment',
      impact: fxImpact,
      unit: 'npr-per-tola',
      source: nepalForecast.fxMoveSource ?? market.macro.usdNprParity.source,
      asOf: market.macro.usdNprParity.asOf,
    })
  }
  return candidates.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5)
}
