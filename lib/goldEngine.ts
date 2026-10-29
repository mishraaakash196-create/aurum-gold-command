import type {
  BacktestMetric,
  LocalRatePoint,
  MetricQuote,
  NepalForecast,
  OhlcCandle,
  QuantForecast,
  ScenarioForecast,
  ScenarioInput,
  TechnicalIndicators,
  MacroFactorContributions,
  ParitySettings,
  TejabiRatioState,
} from './types'

export const TROY_OUNCE_GRAMS = 31.1034768
export const TOLA_GRAMS = 11.6638038
export const TEN_GRAMS = 10
export const GOLD_22K_PURITY = 0.9167
export const DEFAULT_TEJABI_RATIO = 0.9915
export const DEFAULT_CUSTOMS_DUTY_PCT = 15
export const DEFAULT_BANK_FREIGHT_PCT = 1

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export const roundToHundred = (value: number): number =>
  Math.round(value / 100) * 100

const mean = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null

/** EMA seeded with the first full-period SMA. Warm-up values are null, never invented. */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (!Number.isInteger(period) || period < 1 || values.length < period) return result
  const seed = mean(values.slice(0, period))
  if (seed === null) return result
  result[period - 1] = seed
  const multiplier = 2 / (period + 1)
  let previous = seed
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous
    result[index] = previous
  }
  return result
}

/** Wilder-smoothed RSI, using the standard 14 price changes by default. */
export function rsiSeries(values: number[], period = 14): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (period < 1 || values.length <= period) return result
  let gain = 0
  let loss = 0
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1]
    gain += Math.max(change, 0)
    loss += Math.max(-change, 0)
  }
  let averageGain = gain / period
  let averageLoss = loss / period
  const rsiAt = (g: number, l: number) =>
    l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l)
  result[period] = rsiAt(averageGain, averageLoss)
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period
    result[index] = rsiAt(averageGain, averageLoss)
  }
  return result
}

function emaNullable(values: Array<number | null>, period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  const first = values.findIndex((value) => value !== null && Number.isFinite(value))
  if (first < 0) return result
  const usable = values.slice(first).map((value) => (value !== null && Number.isFinite(value) ? value : null))
  let count = 0
  let seedSum = 0
  let previous: number | null = null
  const multiplier = 2 / (period + 1)
  for (let index = 0; index < usable.length; index += 1) {
    const value = usable[index]
    if (value === null) continue
    if (previous === null) {
      count += 1
      seedSum += value
      if (count === period) {
        previous = seedSum / period
        result[first + index] = previous
      }
      continue
    }
    previous = (value - previous) * multiplier + previous
    result[first + index] = previous
  }
  return result
}

function rollingSmaAndStd(values: number[], period: number) {
  const sma: Array<number | null> = Array(values.length).fill(null)
  const standardDeviation: Array<number | null> = Array(values.length).fill(null)
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1)
    const average = mean(window)
    if (average === null) continue
    const variance = window.reduce((sum, item) => sum + (item - average) ** 2, 0) / period
    sma[index] = average
    standardDeviation[index] = Math.sqrt(variance)
  }
  return { sma, standardDeviation }
}

/**
 * True range and 14-day ATR use Wilder smoothing. The first ATR is the mean of
 * the first full window of true ranges.
 */
export function atrSeries(candles: OhlcCandle[], period = 14): Array<number | null> {
  const result: Array<number | null> = Array(candles.length).fill(null)
  if (period < 1 || candles.length < period) return result
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return Math.max(0, candle.high - candle.low)
    const previousClose = candles[index - 1].close
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    )
  })
  let current = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  result[period - 1] = current
  for (let index = period; index < candles.length; index += 1) {
    current = (current * (period - 1) + trueRanges[index]) / period
    result[index] = current
  }
  return result
}

function finiteLast(values: Array<number | null>): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== null && Number.isFinite(value)) return value
  }
  return null
}

export function technicalMomentumScore(
  currentPrice: number,
  rsi14: number | null,
  ema20: number | null,
  ema50: number | null,
  ema200: number | null,
  macdHistogram: number | null,
  atr14: number | null,
): number {
  if (![currentPrice, ema20, ema50, ema200].every((value) => value !== null && Number.isFinite(value))) {
    return 0
  }
  const rsiScore = rsi14 === null ? 0 : clamp((rsi14 - 50) / 5, -5, 5) - Math.max(0, rsi14 - 70) * 0.12
  const trendScore = clamp(
    (currentPrice >= (ema20 as number) ? 1.5 : -1.5) +
      ((ema20 as number) >= (ema50 as number) ? 3 : -3) +
      ((ema50 as number) >= (ema200 as number) ? 4 : -4),
    -8.5,
    8.5,
  )
  const macdScore =
    macdHistogram === null || atr14 === null || atr14 <= 0
      ? 0
      : clamp((macdHistogram / atr14) * 24, -5, 5)
  return Math.round(clamp(trendScore * 0.4 + rsiScore * 0.28 + macdScore * 0.32, -10, 10) * 10) / 10
}

/** RSI, EMA(20/50/200), MACD histogram, Bollinger(20,2) and ATR(14). */
export function calculateTechnicalIndicators(candles: OhlcCandle[]): TechnicalIndicators | null {
  if (candles.length < 26) return null
  const closes = candles.map((candle) => candle.close)
  const ema20Series = emaSeries(closes, 20)
  const ema50Series = emaSeries(closes, 50)
  const ema200Series = emaSeries(closes, 200)
  const rsi = rsiSeries(closes, 14)
  const fast = emaSeries(closes, 12)
  const slow = emaSeries(closes, 26)
  const macd = closes.map((_, index) =>
    fast[index] !== null && slow[index] !== null ? (fast[index] as number) - (slow[index] as number) : null,
  )
  const signal = emaNullable(macd, 9)
  const histogram = macd.map((value, index) =>
    value !== null && signal[index] !== null ? value - (signal[index] as number) : null,
  )
  const bands = rollingSmaAndStd(closes, 20)
  const atr = atrSeries(candles, 14)
  const lastIndex = candles.length - 1
  const lastRsi = finiteLast(rsi)
  const lastEma20 = finiteLast(ema20Series)
  const lastEma50 = finiteLast(ema50Series)
  const lastEma200 = finiteLast(ema200Series)
  const lastHistogram = finiteLast(histogram)
  const lastMiddle = finiteLast(bands.sma)
  const lastStd = finiteLast(bands.standardDeviation)
  const lastAtr = finiteLast(atr)
  const currentPrice = candles[lastIndex].close

  return {
    rsi14: lastRsi,
    ema20: lastEma20,
    ema50: lastEma50,
    ema200: lastEma200,
    macdHistogram: lastHistogram,
    bollingerUpper: lastMiddle !== null && lastStd !== null ? lastMiddle + 2 * lastStd : null,
    bollingerMiddle: lastMiddle,
    bollingerLower: lastMiddle !== null && lastStd !== null ? lastMiddle - 2 * lastStd : null,
    atr14: lastAtr,
    technicalMomentumScore: technicalMomentumScore(
      currentPrice,
      lastRsi,
      lastEma20,
      lastEma50,
      lastEma200,
      lastHistogram,
      lastAtr,
    ),
    series: candles.map((candle, index) => {
      const middle = bands.sma[index]
      const deviation = bands.standardDeviation[index]
      return {
        date: candle.date,
        ema20: ema20Series[index],
        ema50: ema50Series[index],
        ema200: ema200Series[index],
        bollingerUpper: middle !== null && deviation !== null ? middle + 2 * deviation : null,
        bollingerMiddle: middle,
        bollingerLower: middle !== null && deviation !== null ? middle - 2 * deviation : null,
      }
    }),
  }
}

export function atrMoveLimitPct(atr14Usd: number, currentPrice: number): number {
  if (!Number.isFinite(atr14Usd) || !Number.isFinite(currentPrice) || currentPrice <= 0) return 0.35
  return clamp((Math.max(0, atr14Usd) / currentPrice) * 100 * 1.4, 0.35, 4.5)
}

export function constrainMoveByAtr(
  changePct: number,
  atr14Usd: number,
  currentPrice: number,
  severeEventException = false,
): { changePct: number; normalLimitPct: number; appliedLimitPct: number; severeEventException: boolean } {
  const normalLimitPct = atrMoveLimitPct(atr14Usd, currentPrice)
  const appliedLimitPct = severeEventException ? 8 : normalLimitPct
  return {
    changePct: clamp(changePct, -appliedLimitPct, appliedLimitPct),
    normalLimitPct,
    appliedLimitPct,
    severeEventException,
  }
}

export interface MacroForecastInputs {
  /** Fresh daily DXY percent change; a stronger dollar is bearish for USD gold. */
  dxyChangePct?: number | null
  /** Prefer the 10Y TIPS real-yield change; nominal is fallback context only. */
  real10yChangePp?: number | null
  nominal10yChangePp?: number | null
  /** Daily price change in ZQ=F; a higher futures price implies lower average EFFR. */
  fedFundsFuturesChange?: number | null
  /** Reported WGC global monthly flow, USD billions. */
  etfFlowUsdBn?: number | null
  /** Reported WGC central-bank net monthly purchases, tonnes. */
  centralBankNetPurchasesTonnes?: number | null
}

/**
 * Conservative, capped one-session overlay. Coefficients are explicit heuristics,
 * not fitted response estimates. Inputs should be passed only when their source
 * is present and within the caller's freshness window.
 */
export function calculateMacroFactorContributions(inputs: MacroForecastInputs = {}): MacroFactorContributions {
  const usable = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value)
  const dxyPct = usable(inputs.dxyChangePct)
    ? clamp(-inputs.dxyChangePct * 0.24, -0.18, 0.18)
    : null
  const yieldChange = usable(inputs.real10yChangePp)
    ? inputs.real10yChangePp
    : usable(inputs.nominal10yChangePp) ? inputs.nominal10yChangePp : null
  const us10yYieldPct = yieldChange === null
    ? null
    : clamp(-yieldChange * 0.60, -0.12, 0.12)
  const rateCutExpectationsPct = usable(inputs.fedFundsFuturesChange)
    ? clamp(inputs.fedFundsFuturesChange * 0.75, -0.10, 0.10)
    : null
  const etfFlowsPct = usable(inputs.etfFlowUsdBn)
    ? clamp(inputs.etfFlowUsdBn * 0.006, -0.08, 0.08)
    : null
  const centralBankDemandPct = usable(inputs.centralBankNetPurchasesTonnes)
    ? clamp(inputs.centralBankNetPurchasesTonnes * 0.0012, -0.07, 0.07)
    : null
  const available = [dxyPct, us10yYieldPct, rateCutExpectationsPct, etfFlowsPct, centralBankDemandPct]
    .filter((value): value is number => value !== null)
  return {
    dxyPct,
    us10yYieldPct,
    rateCutExpectationsPct,
    etfFlowsPct,
    centralBankDemandPct,
    totalPct: clamp(available.reduce((sum, value) => sum + value, 0), -0.42, 0.42),
    activeFactors: available.length,
  }
}

/** A one-step, factor-weighted indicator ensemble. This is a transparent heuristic, not a trained ML model. */
export function calculateQuantForecast(
  candles: OhlcCandle[],
  currentPrice: number,
  indicators = calculateTechnicalIndicators(candles),
  macroFactors?: MacroForecastInputs,
): QuantForecast | null {
  if (!indicators || candles.length < 21 || !Number.isFinite(currentPrice) || currentPrice <= 0) return null
  const closes = candles.map((candle) => candle.close)
  const end = closes.length - 1
  const prior5 = closes[Math.max(0, end - 5)]
  const prior20 = closes[Math.max(0, end - 20)]
  const fiveDayReturn = prior5 > 0 ? currentPrice / prior5 - 1 : 0
  const twentyDayReturn = prior20 > 0 ? currentPrice / prior20 - 1 : fiveDayReturn
  const fiveDayDriftPct = (fiveDayReturn / Math.min(5, end + 1)) * 100
  const twentyDayDriftPct = (twentyDayReturn / Math.min(20, end + 1)) * 100
  const driftFactorPct = clamp(0.62 * fiveDayDriftPct + 0.38 * twentyDayDriftPct, -0.55, 0.55)
  const ema20 = indicators.ema20 ?? currentPrice
  const ema50 = indicators.ema50 ?? currentPrice
  const ema200 = indicators.ema200 ?? currentPrice
  const trendFactorPct = clamp(
    ((ema20 - ema50) / currentPrice) * 100 * 0.62 + ((ema50 - ema200) / currentPrice) * 100 * 0.18,
    -0.55,
    0.55,
  )
  const rsiFactorPct = indicators.rsi14 === null ? 0 : clamp((50 - indicators.rsi14) * 0.006, -0.30, 0.30)
  const macdFactorPct = indicators.macdHistogram === null
    ? 0
    : clamp((indicators.macdHistogram / currentPrice) * 100 * 0.48, -0.35, 0.35)
  const ensembleMovePct = driftFactorPct * 0.34 + trendFactorPct * 0.28 + rsiFactorPct * 0.18 + macdFactorPct * 0.20
  const macroFactorContributions = calculateMacroFactorContributions(macroFactors)
  const atr14Usd = Math.max(0, indicators.atr14 ?? 0)
  const atrPct = (atr14Usd / currentPrice) * 100
  const boundedMove = constrainMoveByAtr(ensembleMovePct + macroFactorContributions.totalPct, atr14Usd, currentPrice)
  const changePct = boundedMove.changePct
  const predictedXauUsd = currentPrice * (1 + changePct / 100)
  const directionSignals = [
    currentPrice > (indicators.ema20 ?? currentPrice) ? 1 : -1,
    currentPrice > (indicators.ema50 ?? currentPrice) ? 1 : -1,
    indicators.macdHistogram === null ? 0 : indicators.macdHistogram > 0 ? 1 : -1,
    indicators.rsi14 === null ? 0 : indicators.rsi14 > 50 ? 1 : -1,
    ...(macroFactorContributions.activeFactors > 0 ? [Math.sign(macroFactorContributions.totalPct)] : []),
  ]
  const agreement = Math.abs(directionSignals.reduce((sum, signal) => sum + signal, 0)) / directionSignals.length
  const warmup = clamp((candles.length - 80) / 160, 0, 1) * 8
  const volatilityPenalty = clamp((atrPct - 1.2) * 2.5, 0, 8)
  const confidencePct = Math.round(clamp(52 + agreement * 15 + warmup - volatilityPenalty, 40, 79))
  return {
    currentXauUsd: currentPrice,
    predictedXauUsd,
    changeUsd: predictedXauUsd - currentPrice,
    changePct,
    rangeLow: Math.max(0, predictedXauUsd - atr14Usd),
    rangeHigh: predictedXauUsd + atr14Usd,
    atr14Usd,
    confidencePct,
    confidenceLabel: 'Signal confidence · uncalibrated',
    method: macroFactorContributions.activeFactors > 0
      ? 'Weighted drift / EMA / RSI / MACD plus freshness-gated DXY, U.S. 10Y, fed-funds futures, WGC ETF and central-bank overlays; ATR-constrained. Macro overlay is not included in the technical-only historical backtest.'
      : 'Weighted drift / EMA trend / RSI / MACD ensemble; ATR-constrained move. Signal is uncalibrated.',
    macroFactorContributions,
    technicalFactorContributions: [
      { key: 'five-day-drift', label: '5/20-session drift', impactPct: driftFactorPct * 0.34 },
      { key: 'ema-trend', label: 'EMA trend', impactPct: trendFactorPct * 0.28 },
      { key: 'rsi-reversion', label: 'RSI mean-reversion', impactPct: rsiFactorPct * 0.18 },
      { key: 'macd-momentum', label: 'MACD momentum', impactPct: macdFactorPct * 0.20 },
    ],
  }
}

export interface SpreadResult {
  spreadPct: number | null
  sampleCount: number
  method: 'rolling-30d-anchored' | 'rolling-30d-median' | 'latest-rate-calibration' | 'unavailable'
}

function dateMinusDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

function nearestPrevious(
  values: Map<string, number>,
  date: string,
  maxDays: number,
): number | null {
  for (let distance = 0; distance <= maxDays; distance += 1) {
    const value = values.get(dateMinusDays(date, distance))
    if (value !== undefined && Number.isFinite(value) && value > 0) return value
  }
  return null
}

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Calibrates a rolling implied local premium from matched FENEGOSIDA, XAU and
 * USD/NPR observations. Historical dates are aligned to the prior available
 * market close (weekends/holidays carry forward), never back-filled with guesses.
 */
export function calculateRollingImpliedSpread(
  localHistory: LocalRatePoint[],
  goldCandles: OhlcCandle[],
  fxHistory: Array<{ date: string; value: number }>,
  fallback: {
    latestLocalTola: number | null
    latestXauUsd: number | null
    latestFx: number | null
    date: string
  },
  customsDutyPct = DEFAULT_CUSTOMS_DUTY_PCT,
  bankFreightPct = DEFAULT_BANK_FREIGHT_PCT,
): SpreadResult {
  const goldByDate = new Map(goldCandles.map((candle) => [candle.date, candle.close]))
  const fxByDate = new Map(fxHistory.map((item) => [item.date, item.value]))
  const dutyMultiplier = 1 + customsDutyPct / 100
  const freightMultiplier = 1 + bankFreightPct / 100
  const observations = [...localHistory]
    .filter((point) => point.perTola > 0 && point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)
    .map((point) => {
      const gold = nearestPrevious(goldByDate, point.date, 4)
      const fx = nearestPrevious(fxByDate, point.date, 5)
      if (!gold || !fx) return null
      const parityBeforeSpread =
        (gold / TROY_OUNCE_GRAMS) * fx * TOLA_GRAMS * dutyMultiplier * freightMultiplier
      if (!Number.isFinite(parityBeforeSpread) || parityBeforeSpread <= 0) return null
      return clamp((point.perTola / parityBeforeSpread - 1) * 100, -35, 35)
    })
    .filter((value): value is number => value !== null)

  if (observations.length >= 3) {
    const initialMedian = median(observations)
    const absoluteDeviations = initialMedian === null ? [] : observations.map((value) => Math.abs(value - initialMedian))
    const mad = median(absoluteDeviations) ?? 0
    const robustTolerance = Math.max(2, mad * 3.5)
    const robustObservations = initialMedian === null
      ? observations
      : observations.filter((value) => Math.abs(value - initialMedian) <= robustTolerance)
    const calibrationWindow = robustObservations.length >= 3 ? robustObservations : observations
    const rollingMedian = median(calibrationWindow)
    const shortWindowMedian = median(calibrationWindow.slice(-5)) ?? rollingMedian
    const latestMatched = observations.at(-1)
    const winsorizedLatest = latestMatched !== undefined && rollingMedian !== null
      ? clamp(latestMatched, rollingMedian - robustTolerance, rollingMedian + robustTolerance)
      : latestMatched ?? rollingMedian
    // Sparse history leans harder on the latest official benchmark; a fuller
    // matched window gradually gives more weight to the robust recent regime.
    const latestWeight = clamp(0.78 - ((calibrationWindow.length - 3) / 27) * 0.22, 0.56, 0.78)
    return {
      spreadPct: rollingMedian !== null && winsorizedLatest !== null
        ? clamp(winsorizedLatest * latestWeight + (shortWindowMedian ?? rollingMedian) * (1 - latestWeight), -35, 35)
        : rollingMedian,
      sampleCount: observations.length,
      method: 'rolling-30d-anchored',
    }
  }

  const { latestLocalTola, latestXauUsd, latestFx } = fallback
  if (
    latestLocalTola !== null && latestXauUsd !== null && latestFx !== null &&
    latestLocalTola > 0 && latestXauUsd > 0 && latestFx > 0
  ) {
    const parityBeforeSpread =
      (latestXauUsd / TROY_OUNCE_GRAMS) * latestFx * TOLA_GRAMS * dutyMultiplier * freightMultiplier
    return {
      spreadPct: clamp((latestLocalTola / parityBeforeSpread - 1) * 100, -35, 35),
      sampleCount: observations.length,
      method: 'latest-rate-calibration',
    }
  }
  return { spreadPct: null, sampleCount: observations.length, method: 'unavailable' }
}

export function calculateNepalForecast(input: {
  predictedXauUsd: number
  usdNpr: number
  customsDutyPct: number
  bankFreightPct: number
  localSpreadPct: number
  spreadSampleCount?: number
  today24kTola?: number | null
  /** Optional fresh daily USD/NPR trend used as a tightly capped next-fixing FX pass-through. */
  usdNprMovePct?: number | null
  usdNprMoveSource?: string | null
  dealerMarginPct?: number
  tejabiRatioState?: TejabiRatioState
}): NepalForecast | null {
  const { predictedXauUsd, usdNpr, customsDutyPct, bankFreightPct, localSpreadPct } = input
  if (![predictedXauUsd, usdNpr, customsDutyPct, bankFreightPct, localSpreadPct].every(Number.isFinite)) return null
  if (predictedXauUsd <= 0 || usdNpr <= 0) return null
  const safeDuty = clamp(customsDutyPct, 0, 60)
  const safeFreight = clamp(bankFreightPct, 0, 20)
  const safeSpread = clamp(localSpreadPct, -35, 35)
  const safeDealerMargin = clamp(input.dealerMarginPct ?? 0, 0, 35)
  const safeFxMovePct = Number.isFinite(input.usdNprMovePct)
    ? clamp(input.usdNprMovePct as number, -0.5, 0.5)
    : 0
  const forecastUsdNpr = usdNpr * (1 + safeFxMovePct / 100)
  const baseNprPerGram = (predictedXauUsd / TROY_OUNCE_GRAMS) * forecastUsdNpr
  const totalMultiplier = (1 + safeDuty / 100) * (1 + safeFreight / 100) * (1 + safeDealerMargin / 100) * (1 + safeSpread / 100)
  const exact24kTolaNpr = baseNprPerGram * TOLA_GRAMS * totalMultiplier
  const exact24k10gNpr = baseNprPerGram * TEN_GRAMS * totalMultiplier
  const exact22kTolaNpr = exact24kTolaNpr * GOLD_22K_PURITY
  const exact22k10gNpr = exact24k10gNpr * GOLD_22K_PURITY
  const tejabiRatioState = input.tejabiRatioState ?? { ratio: DEFAULT_TEJABI_RATIO, source: 'manual' as const, sampleCount: 0, windowSize: 7 as const, lastUpdatedAt: null }
  const exactTejabiTolaNpr = exact24kTolaNpr * tejabiRatioState.ratio
  const exactTejabi10gNpr = exact24k10gNpr * tejabiRatioState.ratio
  const predicted24kTolaNpr = roundToHundred(exact24kTolaNpr)
  const predicted24k10gNpr = roundToHundred(exact24k10gNpr)
  const predicted22kTolaNpr = roundToHundred(exact22kTolaNpr)
  const predicted22k10gNpr = roundToHundred(exact22k10gNpr)
  const predictedTejabiTolaNpr = roundToHundred(exactTejabiTolaNpr)
  const predictedTejabi10gNpr = roundToHundred(exactTejabi10gNpr)
  const expectedChangeTolaNpr =
    input.today24kTola === null || input.today24kTola === undefined
      ? null
      : predicted24kTolaNpr - input.today24kTola
  return {
    predicted24kTolaNpr,
    predicted24k10gNpr,
    predicted22kTolaNpr,
    predicted22k10gNpr,
    predictedTejabiTolaNpr,
    predictedTejabi10gNpr,
    expectedChangeTolaNpr,
    exact24kTolaNpr,
    exact24k10gNpr,
    exact22kTolaNpr,
    exact22k10gNpr,
    baseNprPerGram,
    fxRate: forecastUsdNpr,
    fxMovePct: safeFxMovePct,
    fxMoveSource: safeFxMovePct === 0 ? null : input.usdNprMoveSource ?? null,
    customsDutyPct: safeDuty,
    bankFreightPct: safeFreight,
    vatOtherLevyPct: safeFreight,
    dealerMarginPct: safeDealerMargin,
    localSpreadPct: safeSpread,
    tejabiRatio: tejabiRatioState.ratio,
    tejabiRatioSource: tejabiRatioState.source,
    tejabiRatioSamples: tejabiRatioState.sampleCount,
    tejabiRatioLastUpdatedAt: tejabiRatioState.lastUpdatedAt,
    spreadSampleCount: input.spreadSampleCount ?? 0,
  }
}

function forecastOnPrefix(candles: OhlcCandle[]): QuantForecast | null {
  if (candles.length < 201) return null
  return calculateQuantForecast(candles, candles[candles.length - 1].close)
}

/** Chronological, walk-forward one-day backtest. Every estimate sees only past candles. */
export function calculateBacktest(candles: OhlcCandle[]): BacktestMetric[] {
  // No synchronized historical macro snapshots are stored, so only the technical
  // baseline is replayed here; current reported demand is never leaked backward.
  const windows = [
    { label: '7-session walk-forward', days: 7 },
    { label: '30-day walk-forward', days: 30 },
    { label: '90-session walk-forward', days: 90 },
  ]
  return windows.map(({ label, days }) => {
    const start = Math.max(200, candles.length - days - 1)
    const squaredErrors: number[] = []
    const percentageErrors: number[] = []
    let directionalWins = 0
    for (let index = start; index < candles.length - 1; index += 1) {
      const history = candles.slice(0, index + 1)
      const forecast = forecastOnPrefix(history)
      const actual = candles[index + 1]?.close
      const observedStart = candles[index]?.close
      if (forecast && actual && actual > 0 && observedStart > 0) {
        const errorUsd = forecast.predictedXauUsd - actual
        squaredErrors.push(errorUsd ** 2)
        percentageErrors.push((Math.abs(errorUsd) / actual) * 100)
        const predictedDirection = Math.sign(forecast.predictedXauUsd - observedStart)
        const actualDirection = Math.sign(actual - observedStart)
        if (predictedDirection === actualDirection) directionalWins += 1
      }
    }
    const observations = percentageErrors.length
    return {
      label,
      days,
      observations,
      mapePct: observations ? percentageErrors.reduce((sum, value) => sum + value, 0) / observations : null,
      directionalWinRatePct: observations ? (directionalWins / observations) * 100 : null,
      rmseUsd: observations ? Math.sqrt(squaredErrors.reduce((sum, value) => sum + value, 0) / observations) : null,
    }
  })
}

export function defaultScenarioInput(usdNpr: number | null): ScenarioInput {
  return {
    warEscalation: 0,
    dxyShiftPct: 0,
    yieldShiftBps: 0,
    usdNpr: usdNpr ?? 0,
    customsDutyPct: DEFAULT_CUSTOMS_DUTY_PCT,
    bankFreightPct: DEFAULT_BANK_FREIGHT_PCT,
    headline: '',
  }
}

export interface ScenarioBase {
  market: {
    spot: number | null
    indicators: TechnicalIndicators | null
    localSpreadPct: number | null
    localSpreadSamples: number
    nepal: { rate24kTola: number | null; tejabiRatioState?: TejabiRatioState }
    macro: { usdNprParity: MetricQuote }
  }
  forecast: QuantForecast | null
  analysisScores: {
    geopolitical: number
    macroYield: number
    technical: number
  }
  headlineScore: number
}

/** Reprices the quant/AI blend with transparent, bounded scenario shocks. */
export function calculateScenarioForecast(
  base: ScenarioBase,
  scenario: ScenarioInput,
  manualHeadlineScore: number,
  eventOverlayPct = 0,
  severeEventException = false,
  paritySettings?: ParitySettings,
): ScenarioForecast | null {
  const forecast = base.forecast
  const current = base.market.spot ?? forecast?.currentXauUsd ?? null
  if (!forecast || !current || current <= 0) return null
  const geoDeltaScore = clamp(scenario.warEscalation * 1.8 + manualHeadlineScore, -10, 10)
  const headlineAndConflictPct = geoDeltaScore * 0.09
  const dxyPct = -scenario.dxyShiftPct * 0.45
  const yieldPct = -scenario.yieldShiftBps * 0.0018
  const boundedEventPct = clamp(eventOverlayPct, -1.2, 1.2)
  const totalScenarioPct = headlineAndConflictPct + dxyPct + yieldPct + boundedEventPct
  const moveConstraint = constrainMoveByAtr(forecast.changePct + totalScenarioPct, forecast.atr14Usd, current, severeEventException && boundedEventPct !== 0)
  const changePct = moveConstraint.changePct
  const predictedXauUsd = current * (1 + changePct / 100)
  const atr = forecast.atr14Usd
  const global: QuantForecast = {
    ...forecast,
    currentXauUsd: current,
    predictedXauUsd,
    changeUsd: predictedXauUsd - current,
    changePct,
    rangeLow: Math.max(0, predictedXauUsd - atr),
    rangeHigh: predictedXauUsd + atr,
  }
  const fx = scenario.usdNpr > 0
    ? scenario.usdNpr
    : base.market.macro.usdNprParity.stale ? 0 : base.market.macro.usdNprParity.value ?? 0
  const spread = base.market.localSpreadPct
  const nepal = fx > 0 && spread !== null
    ? calculateNepalForecast({
        predictedXauUsd,
        usdNpr: fx,
        customsDutyPct: scenario.customsDutyPct,
        bankFreightPct: scenario.bankFreightPct,
        localSpreadPct: spread,
        spreadSampleCount: base.market.localSpreadSamples,
        today24kTola: base.market.nepal.rate24kTola,
        dealerMarginPct: paritySettings?.dealerMarginPct ?? 0,
        tejabiRatioState: base.market.nepal.tejabiRatioState,
      })
    : null
  return {
    global,
    nepal,
    contributions: { headlineAndConflictPct, dxyPct, yieldPct, eventOverlayPct: boundedEventPct, totalScenarioPct },
    atrMoveCapPct: moveConstraint.normalLimitPct,
    severeEventException: moveConstraint.severeEventException,
    scenarioGeopoliticalScore: clamp(base.analysisScores.geopolitical + geoDeltaScore, -10, 10),
    scenarioHeadlineScore: manualHeadlineScore,
  }
}
