import {
  calculateQuantForecast,
  clamp,
  type MacroForecastInputs,
} from './goldEngine'
import { aggregateGeopoliticalScore } from './sentiment'
import { buildEventImpact } from './eventImpact'
import type {
  AnalysisOutput,
  BacktestMetric,
  Driver,
  Impact,
  LiveEvent,
  MarketSnapshot,
  MetricQuote,
  NepalForecast,
  PredictionResponse,
  QuantForecast,
  ParitySettings,
} from './types'
import { calculateAnchoredNepalForecast, calculateImportParity, DEFAULT_PARITY_SETTINGS } from '@/engine/parity'
import { applyEnsembleToForecast, buildEnsembleDriverScores, buildEnsembleFeatures, getHeuristicModel } from '@/engine/ensemble'
import type { EnsembleModelSummary } from './types'

function impactFromScore(score: number): Impact {
  return score > 0.25 ? 'BULLISH' : score < -0.25 ? 'BEARISH' : 'NEUTRAL'
}

function readableNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
}

function freshChange(metric: MetricQuote): number | null {
  return !metric.stale && metric.change !== null && Number.isFinite(metric.change) ? metric.change : null
}

/** Converts only fresh observations into model inputs; unavailable or stale feeds stay neutral. */
export function macroInputsFromMarket(market: Pick<MarketSnapshot, 'macro' | 'institutionalDemand'>): MacroForecastInputs {
  const cb = market.institutionalDemand.centralBank
  const etf = market.institutionalDemand.goldEtf
  const realYield = market.macro.real10y
  const nominalYield = market.macro.nominal10y
  const realChange = freshChange(realYield)
  return {
    dxyChangePct: !market.macro.dxy.stale && market.macro.dxy.changePct !== null
      ? market.macro.dxy.changePct
      : null,
    real10yChangePp: realChange,
    nominal10yChangePp: realChange === null ? freshChange(nominalYield) : null,
    fedFundsFuturesChange: freshChange(market.macro.fedFundsFutures),
    etfFlowUsdBn: etf.provenance === 'reported' && !etf.stale ? etf.netFlowUsdBn : null,
    centralBankNetPurchasesTonnes: cb.provenance === 'reported' && !cb.stale ? cb.netPurchasesTonnes : null,
  }
}

function directionText(value: number | null, positive: string, negative: string): string {
  if (value === null || value === 0) return 'No directional change is available from the feed.'
  return value > 0 ? positive : negative
}

function technicalRegime(market: MarketSnapshot): string {
  const indicators = market.indicators
  const price = market.spot
  if (!indicators || !price) return 'INSUFFICIENT TECHNICAL HISTORY'
  const trend = indicators.ema20 && indicators.ema50 && indicators.ema200
    ? price > indicators.ema20 && indicators.ema20 > indicators.ema50 && indicators.ema50 > indicators.ema200
      ? 'UPTREND'
      : price < indicators.ema20 && indicators.ema20 < indicators.ema50 && indicators.ema50 < indicators.ema200
        ? 'DOWNTREND'
        : 'MIXED / RANGE'
    : 'SHORT-TERM / INCOMPLETE EMA STACK'
  const atrPct = indicators.atr14 && price ? (indicators.atr14 / price) * 100 : null
  return atrPct !== null && atrPct > 1.8 ? `${trend} · ELEVATED RANGE` : trend
}

function buildDrivers(market: MarketSnapshot, geopoliticalScore: number, macroScore: number, technicalScore: number): Driver[] {
  const drivers: Driver[] = []
  const indicators = market.indicators
  if (indicators && market.spot) {
    const rsiText = indicators.rsi14 === null ? 'RSI unavailable' : `RSI(14) ${readableNumber(indicators.rsi14, 1)}`
    const emaText = indicators.ema20 && indicators.ema50 && indicators.ema200
      ? `EMA20 ${readableNumber(indicators.ema20)} / EMA50 ${readableNumber(indicators.ema50)} / EMA200 ${readableNumber(indicators.ema200)}`
      : 'EMA stack is still warming up'
    const macdText = indicators.macdHistogram === null
      ? 'MACD histogram unavailable'
      : `MACD histogram ${readableNumber(indicators.macdHistogram)} USD`
    const atrText = indicators.atr14 === null ? '' : `; 14d ATR ${readableNumber(indicators.atr14)} USD`
    drivers.push({
      headline: `${rsiText} · ${emaText}`,
      impact: impactFromScore(technicalScore),
      score: technicalScore,
      reasoning: `${macdText}${atrText}. Indicator blend is directionally ${technicalScore > 0.5 ? 'positive' : technicalScore < -0.5 ? 'negative' : 'mixed'}; the score is a rules-based signal, not a probability.`,
      source: 'XAUS daily OHLC · in-app indicator engine',
    })
  }

  const dxy = market.macro.dxy
  if (dxy.value !== null) {
    const changePct = !dxy.stale && dxy.changePct !== null && Number.isFinite(dxy.changePct) ? dxy.changePct : null
    const score = changePct === null ? 0 : clamp(-changePct * 2.2, -6, 6)
    drivers.push({
      headline: `DXY ${readableNumber(dxy.value)}${changePct === null ? (dxy.stale ? ' · STALE' : '') : ` · ${changePct >= 0 ? '+' : ''}${readableNumber(changePct, 2)}% vs prior close`}`,
      impact: impactFromScore(score),
      score,
      reasoning: changePct === null
        ? 'The displayed DXY level has no fresh directional change; it contributes no forecast adjustment.'
        : directionText(changePct, 'A firmer dollar can pressure USD-denominated bullion.', 'A softer dollar can ease the USD headwind for bullion.'),
      source: dxy.source,
    })
  }

  const realYield = market.macro.real10y
  const nominalYield = market.macro.nominal10y
  if (realYield.value !== null && !realYield.stale) {
    const change = freshChange(realYield)
    const score = change === null ? 0 : clamp(-change * 65, -7, 7)
    drivers.push({
      headline: `10Y TIPS real yield ${readableNumber(realYield.value, 3)}%${change === null ? '' : ` · ${change >= 0 ? '+' : ''}${readableNumber(change, 3)} pp`}`,
      impact: impactFromScore(score),
      score,
      reasoning: change === null
        ? 'The latest real-yield level is fresh but has no previous observation; no directional yield adjustment is used.'
        : directionText(change, 'Higher real yields increase the opportunity cost of holding non-yielding gold.', 'Lower real yields reduce the carry headwind and can support bullion.'),
      source: realYield.source,
    })
  } else if (nominalYield.value !== null) {
    const change = freshChange(nominalYield)
    const score = change === null ? 0 : clamp(-change * 45, -5, 5)
    drivers.push({
      headline: `U.S. 10Y nominal yield ${readableNumber(nominalYield.value, 3)}%${change === null ? (nominalYield.stale ? ' · STALE' : '') : ` · ${change >= 0 ? '+' : ''}${readableNumber(change, 3)} pp`}`,
      impact: impactFromScore(score),
      score,
      reasoning: nominalYield.stale
        ? 'The nominal-yield observation is stale and contributes no direction; nominal yield is not a substitute for 10Y TIPS real yield.'
        : 'Nominal Treasury yield is shown as context only; it is not a substitute for the 10Y TIPS real-yield series.',
      source: nominalYield.source,
    })
  }

  const fedFunds = market.macro.fedFundsFutures
  if (fedFunds.value !== null) {
    const change = freshChange(fedFunds)
    const impliedRateChangeBps = change === null ? null : -change * 100
    const score = change === null ? 0 : clamp(change * 150, -6, 6)
    drivers.push({
      headline: `Fed-funds futures proxy ${readableNumber(fedFunds.value, 3)}${change === null ? (fedFunds.stale ? ' · STALE' : '') : ` · ${change >= 0 ? '+' : ''}${readableNumber(change, 3)} price points`}`,
      impact: impactFromScore(score),
      score,
      reasoning: change === null
        ? 'No fresh futures-price change is available, so the rate-path overlay is neutral.'
        : `Higher ZQ=F price implies about ${Math.abs(impliedRateChangeBps ?? 0).toFixed(0)} bp ${impliedRateChangeBps! < 0 ? 'lower' : 'higher'} implied average EFFR for that contract month. It is a front-month directional repricing proxy, not CME FedWatch next-meeting cut odds.`,
      source: fedFunds.source,
    })
  }

  const cbReport = market.institutionalDemand.centralBank
  if (cbReport.provenance === 'reported' && cbReport.netPurchasesTonnes !== null) {
    const score = cbReport.stale ? 0 : clamp(cbReport.netPurchasesTonnes * 0.06, -6, 6)
    const ytd = cbReport.ytdPurchasesTonnes === null ? '' : ` · YTD ${readableNumber(cbReport.ytdPurchasesTonnes, 0)}t`
    drivers.push({
      headline: `WGC reported central-bank net demand ${cbReport.netPurchasesTonnes >= 0 ? '+' : ''}${readableNumber(cbReport.netPurchasesTonnes, 0)}t${cbReport.period ? ` · ${cbReport.period}` : ''}${ytd}${cbReport.stale ? ' · STALE' : ''}`,
      impact: impactFromScore(score),
      score,
      reasoning: cbReport.stale
        ? 'The WGC report is stale and excluded from the short-horizon demand overlay; monthly central-bank reporting is lagged.'
        : 'Reported monthly central-bank purchases can support structural demand, but are lagged and are not treated as a same-day trade-flow signal.',
      source: cbReport.source,
      url: cbReport.url ?? undefined,
    })
  }

  const etfReport = market.institutionalDemand.goldEtf
  if (etfReport.provenance === 'reported' && etfReport.netFlowUsdBn !== null) {
    const score = etfReport.stale ? 0 : clamp(etfReport.netFlowUsdBn * 0.18, -6, 6)
    const tonnes = etfReport.holdingsChangeTonnes === null ? '' : ` / ${etfReport.holdingsChangeTonnes >= 0 ? '+' : ''}${readableNumber(etfReport.holdingsChangeTonnes, 0)}t holdings`
    drivers.push({
      headline: `WGC global gold ETF flow ${etfReport.netFlowUsdBn >= 0 ? '+' : ''}$${readableNumber(etfReport.netFlowUsdBn, 1)}bn${tonnes}${etfReport.period ? ` · ${etfReport.period}` : ''}${etfReport.stale ? ' · STALE' : ''}`,
      impact: impactFromScore(score),
      score,
      reasoning: etfReport.stale
        ? 'The monthly flow report is stale and excluded from the short-horizon demand overlay.'
        : 'Reported monthly ETF subscriptions support investment demand, but the data are lagged and do not measure today’s order flow.',
      source: etfReport.source,
      url: etfReport.url ?? undefined,
    })
  }

  const fx = market.macro.usdNprParity
  if (fx.value !== null) {
    const change = fx.changePct
    const score = change === null ? 0 : clamp(change * 2.5, -6, 6)
    const officialLabel = fx.source.includes('official rates API') ? 'NRB USD/NPR sell' : 'Indicative USD/NPR fallback'
    drivers.push({
      headline: `${officialLabel} ${readableNumber(fx.value, 3)}${change === null ? '' : ` · ${change >= 0 ? '+' : ''}${readableNumber(change, 2)}%`}`,
      impact: impactFromScore(score),
      score,
      reasoning: change === null
        ? 'The USD/NPR conversion level directly affects the NPR import-parity estimate; no prior quote is available for a change signal.'
        : change > 0
          ? 'NPR depreciation raises domestic NPR bullion parity even if XAU/USD is unchanged.'
          : 'NPR appreciation can partly offset a flat or rising global gold price in local parity.' ,
      source: fx.source,
    })
  }

  const inr = market.macro.usdInr
  if (inr.value !== null && inr.changePct !== null) {
    const score = clamp(inr.changePct * 1.4, -4, 4)
    drivers.push({
      headline: `USD/INR ${readableNumber(inr.value, 3)} · ${inr.changePct >= 0 ? '+' : ''}${readableNumber(inr.changePct, 2)}%`,
      impact: impactFromScore(score),
      score,
      reasoning: 'In a South Asian physical-gold corridor, INR moves can inform regional bullion flows; Nepal import parity is still calculated with USD/NPR, not USD/INR.',
      source: inr.source,
    })
  }

  if (market.macro.brent.value !== null && market.macro.brent.changePct !== null) {
    const score = clamp(market.macro.brent.changePct * 0.35, -3, 3)
    drivers.push({
      headline: `Brent ${readableNumber(market.macro.brent.value, 2)} USD/bbl · ${market.macro.brent.changePct >= 0 ? '+' : ''}${readableNumber(market.macro.brent.changePct, 2)}%`,
      impact: impactFromScore(score),
      score,
      reasoning: 'Oil can transmit energy and inflation risk; the link to gold is conditional and is not treated as a one-for-one signal.',
      source: market.macro.brent.source,
    })
  }

  for (const headline of market.news.slice(0, 8)) {
    drivers.push({
      headline: headline.title,
      impact: headline.impact,
      score: headline.sentimentScore,
      reasoning: headline.reasoning,
      source: headline.source,
      url: headline.url,
    })
  }

  if (!market.news.length) {
    drivers.push({
      headline: 'No verified recent headlines received',
      impact: 'NEUTRAL',
      score: 0,
      reasoning: 'The feed returned no recent items. The rules-based fallback does not invent geopolitical headlines.',
      source: 'Google News RSS · unavailable',
    })
  }
  if (market.macro.real10y.value === null) {
    drivers.push({
      headline: 'Real-yield feed unavailable',
      impact: 'NEUTRAL',
      score: 0,
      reasoning: 'No 10Y TIPS observation was received. Nominal yields are explicitly kept separate and real-yield direction is not inferred.',
      source: 'FRED DFII10 · optional FRED_API_KEY',
    })
  }
  return drivers
}

function rulesBasedScores(market: MarketSnapshot) {
  const geopolitical = aggregateGeopoliticalScore(market.news)
  const useRealYield = market.macro.real10y.value !== null && !market.macro.real10y.stale
  const yieldMetric = useRealYield ? market.macro.real10y : market.macro.nominal10y
  const yieldChange = freshChange(yieldMetric)
  const dxyChangePct = !market.macro.dxy.stale && market.macro.dxy.changePct !== null
    ? market.macro.dxy.changePct
    : null
  const futuresChange = freshChange(market.macro.fedFundsFutures)
  const ratePathScore = futuresChange === null ? 0 : clamp(futuresChange * 35, -3, 3)
  const yieldScore = clamp(
    -(yieldChange ?? 0) * (useRealYield ? 65 : 45) - (dxyChangePct ?? 0) * 2.2 + ratePathScore,
    -10,
    10,
  )
  const technical = market.indicators?.technicalMomentumScore ?? 0
  return { geopolitical, macroYield: Math.round(yieldScore * 10) / 10, technical }
}

function finalGlobalForecast(
  market: MarketSnapshot,
  quant: QuantForecast,
  scores: { geopolitical: number },
  raw?: Partial<AnalysisOutput> | null,
  applyGeopoliticalOverlay = true,
): AnalysisOutput['global_forecast_24h'] {
  const current = market.spot ?? quant.currentXauUsd
  const modelPrediction = raw?.global_forecast_24h
  let changePct: number
  let confidencePct = quant.confidencePct
  if (modelPrediction && (Number.isFinite(modelPrediction.change_pct) || Number.isFinite(modelPrediction.predicted_xau_usd))) {
    const fromPrice = Number.isFinite(modelPrediction.predicted_xau_usd)
      ? ((modelPrediction.predicted_xau_usd - current) / current) * 100
      : null
    const fromPct = Number.isFinite(modelPrediction.change_pct) ? modelPrediction.change_pct : null
    const modelPct = fromPrice !== null && fromPct !== null ? fromPrice * 0.65 + fromPct * 0.35 : fromPrice ?? fromPct ?? quant.changePct
    const maxModelMovePct = clamp((quant.atr14Usd / current) * 2.4, 1.0, 5.0)
    const guardedModelPct = clamp(modelPct, -maxModelMovePct, maxModelMovePct)
    changePct = quant.changePct * 0.68 + guardedModelPct * 0.32
    if (Number.isFinite(modelPrediction.confidence_pct)) {
      confidencePct = Math.round(clamp(quant.confidencePct * 0.75 + modelPrediction.confidence_pct * 0.25, 35, 90))
    }
  } else {
    // DXY, yields and WGC monthly demand already enter the quantitative baseline.
    // Add sentiment only when it has not already entered through the fitted ensemble.
    const scoreAdjustmentPct = applyGeopoliticalOverlay ? scores.geopolitical * 0.022 : 0
    changePct = clamp(quant.changePct + scoreAdjustmentPct, -5, 5)
  }
  const predicted = current * (1 + changePct / 100)
  const atr = quant.atr14Usd
  return {
    predicted_xau_usd: predicted,
    change_usd: predicted - current,
    change_pct: changePct,
    range_low: Math.max(0, predicted - atr),
    range_high: predicted + atr,
    confidence_pct: confidencePct,
  }
}

function fxForParity(market: MarketSnapshot): number | null {
  const parity = market.macro.usdNprParity
  return parity.stale ? null : parity.value
}

function freshUsdNprMove(market: MarketSnapshot): { changePct: number | null; source: string | null } {
  const parity = market.macro.usdNprParity
  if (!parity.stale && parity.changePct !== null && Number.isFinite(parity.changePct)) {
    return { changePct: parity.changePct, source: parity.source }
  }
  const trend = market.macro.usdNprTrend
  if (!trend.stale && trend.changePct !== null && Number.isFinite(trend.changePct)) {
    return { changePct: trend.changePct, source: trend.source }
  }
  const spot = market.macro.usdNprSpot
  if (!spot.stale && spot.changePct !== null && Number.isFinite(spot.changePct)) {
    return { changePct: spot.changePct, source: spot.source }
  }
  return { changePct: null, source: null }
}

function nepalFromGlobal(market: MarketSnapshot, global: AnalysisOutput['global_forecast_24h'], settings: ParitySettings = DEFAULT_PARITY_SETTINGS): NepalForecast | null {
  const fx = fxForParity(market)
  if (fx === null) return null
  const fxMove = freshUsdNprMove(market)
  const shared = {
    spotXauUsd: global.predicted_xau_usd,
    usdNpr: fx,
    customsDutyPct: settings.customsDutyPct,
    vatOtherLevyPct: settings.vatOtherLevyPct,
    dealerMarginPct: settings.dealerMarginPct,
    rollingSpreadPct: market.localSpreadPct ?? 0,
    spreadSampleCount: market.localSpreadSamples,
    today24kTola: market.nepal.rate24kTola,
    usdNprMovePct: fxMove.changePct,
    tejabiRatioState: market.nepal.tejabiRatioState,
    manualTejabiRatio: settings.tejabiManualRatio,
    manualRatioUpdatedAt: settings.updatedAt ?? null,
  }
  if (market.nepal.rate24kTola !== null && market.spot !== null) {
    const anchored = calculateAnchoredNepalForecast({
      ...shared,
      official24kTolaNpr: market.nepal.rate24kTola,
      officialRateDate: market.nepal.rateDate,
      currentXauUsd: market.spot,
      predictedXauUsd: global.predicted_xau_usd,
    })
    if (anchored) {
      anchored.fxMoveSource = fxMove.source
      return anchored
    }
  }
  if (market.localSpreadPct === null) return null
  const parity = calculateImportParity(shared)
  if (parity) parity.fxMoveSource = fxMove.source
  return parity
}

export function buildRulesBasedAnalysis(market: MarketSnapshot, quant: QuantForecast | null, paritySettings: ParitySettings = DEFAULT_PARITY_SETTINGS, applyGeopoliticalOverlay = true): AnalysisOutput | null {
  if (!quant) return null
  const scores = rulesBasedScores(market)
  const global = finalGlobalForecast(market, quant, scores, null, applyGeopoliticalOverlay)
  const nepal = nepalFromGlobal(market, global, paritySettings)
  if (!nepal || nepal.expectedChangeTolaNpr === null) return null
  return {
    geopolitical_risk_score: scores.geopolitical,
    macro_yield_score: scores.macroYield,
    technical_momentum_score: scores.technical,
    market_regime: technicalRegime(market),
    global_forecast_24h: global,
    nepal_forecast_11am: {
      predicted_24k_tola_npr: nepal.predicted24kTolaNpr,
      predicted_22k_tola_npr: nepal.predicted22kTolaNpr,
      predicted_24k_10g_npr: nepal.predicted24k10gNpr,
      expected_change_tola_npr: nepal.expectedChangeTolaNpr,
    },
    key_drivers_explanation: buildDrivers(market, scores.geopolitical, scores.macroYield, scores.technical),
  }
}

function groundedDrivers(
  market: MarketSnapshot,
  providerDrivers: Driver[] | undefined,
  deterministic: Driver[],
  userHeadline = '',
): Driver[] {
  if (!providerDrivers?.length) return deterministic
  const knownHeadlines = market.news.map((item) => item.title.toLowerCase())
  if (userHeadline.trim()) knownHeadlines.push(userHeadline.toLowerCase().trim())
  const grounded = providerDrivers.filter((driver) => {
    const normalized = driver.headline.toLowerCase().trim()
    if (knownHeadlines.some((title) => normalized && (title.includes(normalized) || normalized.includes(title.slice(0, Math.min(title.length, 36)))))) return true
    if (/rsi|ema|macd|atr|bollinger/.test(normalized)) return market.indicators !== null
    if (/real yield|tips|dfii10/.test(normalized)) return market.macro.real10y.value !== null
    if (/nominal yield|treasury|10y/.test(normalized)) return market.macro.nominal10y.value !== null
    if (/dxy|dollar index/.test(normalized)) return market.macro.dxy.value !== null
    if (/fed.?funds|zq|cut expectation|rate-cut|policy repricing/.test(normalized)) return market.macro.fedFundsFutures.value !== null
    if (/etf|fund flow/.test(normalized)) return market.institutionalDemand.goldEtf.provenance === 'reported'
    if (/central bank|gold reserve|official reserve|gold purchase/.test(normalized)) return market.institutionalDemand.centralBank.provenance === 'reported' || market.institutionalDemand.goldReserves.some((reserve) => reserve.tonnes !== null)
    if (/usd\s*\/\s*npr|nrb|npr/.test(normalized)) return market.macro.usdNprParity.value !== null || market.macro.nrbUsdNprSell.value !== null || market.macro.usdNprSpot.value !== null
    if (/usd\s*\/\s*inr|inr/.test(normalized)) return market.macro.usdInr.value !== null
    if (/brent|crude|oil/.test(normalized)) return market.macro.brent.value !== null
    return false
  }).slice(0, 8)
  return [...grounded, ...deterministic.filter((driver) => !grounded.some((item) => item.headline === driver.headline))].slice(0, 12)
}

export function composePrediction(
  market: MarketSnapshot,
  backtest: BacktestMetric[],
  providerAnalysis: Partial<AnalysisOutput> | null = null,
  provider: PredictionResponse['analysisMode'] = 'rules-based',
  providerError?: string,
  userHeadline = '',
  paritySettings: ParitySettings = DEFAULT_PARITY_SETTINGS,
  ensembleModel: EnsembleModelSummary = getHeuristicModel(),
): PredictionResponse {
  const indicators = market.indicators
  const hasLongHistory = market.candles.length >= 201 && indicators?.ema200 !== null && indicators?.ema200 !== undefined
  const ensembleFeatures = buildEnsembleFeatures(market, paritySettings)
  const rawQuantitativeForecast = market.spot && hasLongHistory
    ? calculateQuantForecast(market.candles, market.spot, indicators, macroInputsFromMarket(market))
    : null
  const quantitativeForecast = rawQuantitativeForecast
    ? applyEnsembleToForecast(rawQuantitativeForecast, ensembleFeatures, ensembleModel)
    : null
  const rules = buildRulesBasedAnalysis(market, quantitativeForecast, paritySettings, ensembleModel.mode !== 'ridge-learned')
  let analysis = rules
  let analysisMode: PredictionResponse['analysisMode'] = 'rules-based'
  let analysisStatus: PredictionResponse['analysisStatus'] = rules ? 'fallback' : 'unavailable'
  let modelNote = rules
    ? `Rules-based fallback · technical baseline, freshness-gated macro/demand inputs, plus the ${ensembleModel.mode} ensemble. ${ensembleModel.note} Nepal pricing is re-anchored to the latest official FENEGOSIDA fixing; predictions are not calibrated probabilities.`
    : 'Forecast withheld: an aligned live/last-observed price, 200-day EMA history, NRB/USD conversion, FENEGOSIDA benchmark, and local spread are required.'

  if (providerAnalysis && quantitativeForecast && rules) {
    const scores = {
      geopolitical: Number.isFinite(providerAnalysis.geopolitical_risk_score)
        ? clamp(providerAnalysis.geopolitical_risk_score as number, -10, 10)
        : rules.geopolitical_risk_score,
      macroYield: Number.isFinite(providerAnalysis.macro_yield_score)
        ? clamp(providerAnalysis.macro_yield_score as number, -10, 10)
        : rules.macro_yield_score,
      technical: Number.isFinite(providerAnalysis.technical_momentum_score)
        ? clamp(providerAnalysis.technical_momentum_score as number, -10, 10)
        : rules.technical_momentum_score,
    }
    const global = finalGlobalForecast(market, quantitativeForecast, scores, providerAnalysis)
    const nepal = nepalFromGlobal(market, global, paritySettings)
    if (nepal && nepal.expectedChangeTolaNpr !== null) {
      const deterministicDrivers = buildDrivers(market, scores.geopolitical, scores.macroYield, scores.technical)
      analysis = {
        geopolitical_risk_score: scores.geopolitical,
        macro_yield_score: scores.macroYield,
        technical_momentum_score: scores.technical,
        market_regime: typeof providerAnalysis.market_regime === 'string' && providerAnalysis.market_regime.trim()
          ? providerAnalysis.market_regime.trim().slice(0, 72)
          : rules.market_regime,
        global_forecast_24h: global,
        nepal_forecast_11am: {
          predicted_24k_tola_npr: nepal.predicted24kTolaNpr,
          predicted_22k_tola_npr: nepal.predicted22kTolaNpr,
          predicted_24k_10g_npr: nepal.predicted24k10gNpr,
          expected_change_tola_npr: nepal.expectedChangeTolaNpr,
        },
        key_drivers_explanation: groundedDrivers(market, providerAnalysis.key_drivers_explanation, deterministicDrivers, userHeadline),
      }
      analysisMode = provider
      analysisStatus = 'ready'
      modelNote = `AI-assisted blend · 68% quantitative baseline / 32% guarded model forecast, with ${ensembleModel.mode} ensemble. ${ensembleModel.note} Nepal pricing is recalculated from USD/NPR import parity and anchored to the latest official FENEGOSIDA fixing; model-generated local prices are not used. No output is a calibrated probability. ${providerError ? `Provider note: ${providerError}` : ''}`.trim()
    }
  }

  const globalForecast = analysis?.global_forecast_24h
  const quantitativeDisplay: QuantForecast | null = quantitativeForecast && globalForecast
    ? {
        ...quantitativeForecast,
        predictedXauUsd: globalForecast.predicted_xau_usd,
        changeUsd: globalForecast.change_usd,
        changePct: globalForecast.change_pct,
        rangeLow: globalForecast.range_low,
        rangeHigh: globalForecast.range_high,
        confidencePct: globalForecast.confidence_pct,
      }
    : quantitativeForecast
  const defaultNepalForecast = globalForecast
    ? nepalFromGlobal(market, globalForecast, paritySettings)
    : null
  const eventBaseXau = globalForecast?.predicted_xau_usd ?? quantitativeDisplay?.predictedXauUsd ?? market.spot
  const eventBaseNepal = defaultNepalForecast?.predicted24kTolaNpr ?? market.nepal.rate24kTola
  const events: LiveEvent[] = market.news
    .map((headline) => buildEventImpact({
      headline,
      baseXauUsd: eventBaseXau,
      baseNepalTolaNpr: eventBaseNepal,
    }))
    .filter((event): event is LiveEvent => event !== null)

  const ensembleDrivers = buildEnsembleDriverScores(market, ensembleFeatures, ensembleModel)
  return {
    market,
    events,
    quantitativeForecast: quantitativeDisplay,
    analysis,
    analysisMode,
    analysisStatus,
    modelNote: providerError && !providerAnalysis
      ? `${modelNote} Provider call failed; the rules-based fallback remains active.`
      : modelNote,
    backtest,
    defaultNepalForecast,
    paritySettings,
    ensembleModel,
    ensembleDrivers,
    ensembleFeatures: Object.fromEntries(Object.entries(ensembleFeatures).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
  }
}
