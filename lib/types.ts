export type Impact = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface OhlcCandle {
  date: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  ema20?: number | null
  ema50?: number | null
  ema200?: number | null
}

export interface MetricQuote {
  value: number | null
  previous: number | null
  change: number | null
  changePct: number | null
  unit: string
  source: string
  asOf: string | null
  rateDate?: string | null
  stale: boolean
  note?: string
  history?: Array<{ date: string; value: number }>
}

export interface ReportedCentralBankPurchase {
  countryCode: string
  country: string
  monthlyTonnes: number | null
  ytdTonnes: number | null
  period: string
  sourceUrl: string
}

export interface OfficialGoldReserve {
  countryCode: string
  country: string
  tonnes: number | null
  asOf: string | null
  changeTonnes: number | null
  stale: boolean
  anomalyDetected: boolean
  sourceUrl: string
  note: string
}

export interface CentralBankDemandReport {
  provenance: 'reported' | 'unavailable'
  source: string
  url: string | null
  publishedAt: string | null
  period: string | null
  netPurchasesTonnes: number | null
  ytdPurchasesTonnes: number | null
  purchases: ReportedCentralBankPurchase[]
  stale: boolean
  note: string
}

export interface GoldEtfFlowReport {
  provenance: 'reported' | 'unavailable'
  source: string
  url: string | null
  publishedAt: string | null
  period: string | null
  netFlowUsdBn: number | null
  holdingsChangeTonnes: number | null
  stale: boolean
  note: string
}

export interface InstitutionalDemandSnapshot {
  generatedAt: string
  status: 'reported' | 'partial' | 'unavailable'
  centralBank: CentralBankDemandReport
  goldEtf: GoldEtfFlowReport
  goldReserves: OfficialGoldReserve[]
  note: string
}

export interface MacroFactorContributions {
  dxyPct: number | null
  us10yYieldPct: number | null
  rateCutExpectationsPct: number | null
  etfFlowsPct: number | null
  centralBankDemandPct: number | null
  totalPct: number
  activeFactors: number
}

export interface LocalRatePoint {
  date: string
  perTola: number
  per10g: number
}

export interface ManualOfficialRateEntry {
  date: string
  rate24kTolaNpr: number
  tejabiTolaNpr: number
  source: 'Manual entry · FENEGOSIDA transcription'
  enteredAt: string
  updatedAt: string
}

export interface OfficialRateHistoryRecord {
  date: string
  rate24kTolaNpr: number
  rate24k10gNpr: number | null
  source: string
  checkedAt: string | null
  provenance: 'automatic official feed' | 'manual entry'
}

export type VolatilityRegimeName = 'Calm' | 'Normal' | 'Stress'
export interface VolatilityRegimeSummary {
  name: VolatilityRegimeName
  atrPercentile: number | null
  geopoliticalRiskScore: number
  rangeMultiplier: number
  confidenceAdjustmentPct: number
  rationale: string
}

export interface ForecastWhyFactor {
  key: string
  label: string
  impact: number
  unit: 'percent' | 'npr-per-tola'
  source: string
  asOf: string | null
}

export interface MarketHeadline {
  title: string
  source: string
  url: string
  publishedAt: string | null
  sentimentScore: number
  impact: Impact
  reasoning: string
}

export interface GeoLocation {
  id: string
  label: string
  region: string
  x: number
  y: number
  precision: 'country anchor' | 'regional anchor'
}

export interface LiveEvent {
  id: string
  title: string
  source: string
  url: string
  publishedAt: string | null
  category: 'geopolitical' | 'calamity' | 'macro'
  location: GeoLocation | null
  shockScore: number
  globalImpactPct: number
  globalImpactUsd: number | null
  nepalImpactNprPerTola: number | null
  verdict: 'positive' | 'negative' | 'no-impact' | 'unavailable'
  reasoning: string
  isSimulated: boolean
}

export interface TechnicalIndicators {
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  ema200: number | null
  macdHistogram: number | null
  bollingerUpper: number | null
  bollingerMiddle: number | null
  bollingerLower: number | null
  atr14: number | null
  technicalMomentumScore: number
  series: Array<{
    date: string
    ema20: number | null
    ema50: number | null
    ema200: number | null
    bollingerUpper: number | null
    bollingerMiddle: number | null
    bollingerLower: number | null
  }>
}

export interface TejabiRatioObservation {
  date: string
  rate24kTolaNpr: number
  tejabiTolaNpr: number
  source: string
  observedAt: string
}

export interface TejabiRatioState {
  ratio: number
  source: 'learned' | 'manual'
  sampleCount: number
  windowSize: 7
  lastUpdatedAt: string | null
}

export type Stage2FeedStatus = 'fresh' | 'stale' | 'unavailable' | 'manual'

export interface Stage2Feed<T> {
  data: T | null
  status: Stage2FeedStatus
  source: string
  url: string | null
  asOf: string | null
  checkedAt: string
  note: string
}

export interface FedWatchProbability {
  meetingDate: string | null
  reportingDate: string | null
  easePct: number | null
  noChangePct: number | null
  hikePct: number | null
  currentTargetLowerBps: number | null
  currentTargetUpperBps: number | null
  expectedRateBps: number | null
  rateRanges: Array<{ lowerBps: number; upperBps: number; probabilityPct: number }>
}

export interface CotPositioning {
  reportDate: string
  managedMoneyNet: number
  managedMoneyNetChange: number | null
  openInterest: number
  percentile: number | null
}

export interface GoldEtfHolding {
  ticker: 'GLD' | 'IAU'
  holdingsTonnes: number
  dailyChangeTonnes: number | null
  asOf: string
}

export interface MacroCalendarEvent {
  id: string
  kind: 'CPI' | 'NFP' | 'FOMC' | 'Fed speech'
  title: string
  startsAt: string
  timeZone: string | null
  timePrecision?: 'exact' | 'date-only'
  source: string
  sourceUrl: string
  highImpact: boolean
}

export interface SeasonalDemandIndex {
  index: number
  signedScorePct: number
  bsDate: string
  phase: string
  components: string[]
  source: string
}

export interface Stage2Snapshot {
  generatedAt: string
  fedWatch: Stage2Feed<FedWatchProbability>
  cot: Stage2Feed<CotPositioning>
  etfs: { gld: Stage2Feed<GoldEtfHolding>; iau: Stage2Feed<GoldEtfHolding> }
  indiaGold: Stage2Feed<MetricQuote>
  indiaImportDuty: Stage2Feed<{ percentage: number; asOf: string }>
  nprInr: Stage2Feed<MetricQuote>
  silverCorrelation: Stage2Feed<{ correlation: number; observations: number }>
  silverHistory: Stage2Feed<Array<{ date: string; value: number }>>
  seasonality: SeasonalDemandIndex
  eventCalendar: Stage2Feed<MacroCalendarEvent[]>
}

export type ReliabilityFeedState = 'live' | 'stale' | 'unavailable' | 'manual'
export interface ReliabilityFeedCheck {
  name: string
  state: ReliabilityFeedState
  asOf: string | null
  reason: string | null
}
export interface ForecastReliability {
  assessedAt: string
  thresholds: { spotDuringMarketHoursMinutes: number; spotOutsideMarketHoursHours: number; usdNprHours: number; officialRateBusinessDays: number }
  global: { state: 'reliable' | 'low-reliability'; feeds: ReliabilityFeedCheck[]; reasons: string[] }
  nepal: { state: 'reliable' | 'low-reliability'; feeds: ReliabilityFeedCheck[]; reasons: string[] }
}

export interface FixingWindowPoint {
  value: number
  observedAt: string
  source: string
  targetAt: string
  precision: 'exact' | 'approximate-window'
  note: string
}
export interface FixingWindowAudit {
  previousFixingTargetAt: string
  targetObservationTargetAt: string
  startObservation: FixingWindowPoint | null
  targetObservation: FixingWindowPoint | null
  status: 'exact-window' | 'approximate-window' | 'unavailable'
  note: string
}
export interface PredictionSnapshot {
  schemaVersion: 1
  capturedAt: string
  feeds: Record<string, { value: unknown; source: string; asOf: string | null; checkedAt?: string | null; stale: boolean; status?: string; note?: string }>
  technical: unknown
  localModelInputs: { official24kPerTolaNpr: number | null; rateDate: string | null; rateSource: string; rateAsOf: string | null; localSpreadPct: number | null; localSpreadSamples: number; tejabiRatio: number | null }
  model: { mode: string; features: Record<string, number>; weights: Record<string, number>; regime: VolatilityRegimeSummary | null; eventRisk: EventRiskAdjustment | null; rangeMethods?: Record<string, string>; rangeCalibration?: Record<string, { method: string; samples: number; lowerError?: number; upperError?: number; scale: number }>; probabilityCalibration?: Record<string, { method: string; samples: number; blocks: Array<{ minProbability: number; maxProbability: number; calibratedProbability: number; count: number }> }> }
  paritySettings: ParitySettings | null
  fixingWindow: FixingWindowAudit
}

export interface MarketSnapshot {
  generatedAt: string
  status: 'live' | 'partial' | 'unavailable'
  reliability?: ForecastReliability
  spot: number | null
  spotSource: string
  spotAsOf: string | null
  spotStale: boolean
  historySource: string
  historyAsOf: string | null
  candles: OhlcCandle[]
  indicators: TechnicalIndicators | null
  macro: {
    dxy: MetricQuote
    usdNprSpot: MetricQuote
    usdNprTrend: MetricQuote
    usdNprParity: MetricQuote
    nrbUsdNprBuy: MetricQuote
    nrbUsdNprSell: MetricQuote
    usdInr: MetricQuote
    nominal10y: MetricQuote
    real10y: MetricQuote
    fedFundsFutures: MetricQuote
    brent: MetricQuote
  }
  institutionalDemand: InstitutionalDemandSnapshot
  stage2: Stage2Snapshot
  nepal: {
    rate24kTola: number | null
    rate24k10g: number | null
    previous24kTola: number | null
    previous24k10g: number | null
    rateDate: string | null
    rateSource: string
    rateAsOf: string | null
    rateTejabiAsOf?: string | null
    rateStale: boolean
    rate24kManualEntry?: boolean
    rateTejabiManualEntry?: boolean
    rate22kTola: number | null
    rate22k10g: number | null
    rate22kDerived: boolean
    rateTejabiTola: number | null
    rateTejabi10g: number | null
    rateTejabiOfficial: boolean
    tejabiRatioState?: TejabiRatioState
    history: LocalRatePoint[]
  }
  localSpreadPct: number | null
  localSpreadSamples: number
  localSpreadMethod: 'rolling-30d-anchored' | 'rolling-30d-median' | 'latest-rate-calibration' | 'unavailable'
  news: MarketHeadline[]
  notices: string[]
}

export interface QuantForecast {
  currentXauUsd: number
  predictedXauUsd: number
  changeUsd: number
  changePct: number
  rangeLow: number
  rangeHigh: number
  atr14Usd: number
  confidencePct: number
  confidenceLabel: string
  method: string
  macroFactorContributions?: MacroFactorContributions
  technicalFactorContributions?: Array<{ key: string; label: string; impactPct: number }>
}

export interface Driver {
  headline: string
  impact: Impact
  score: number
  reasoning: string
  source?: string
  url?: string
}

export interface AnalysisOutput {
  geopolitical_risk_score: number
  macro_yield_score: number
  technical_momentum_score: number
  market_regime: string
  global_forecast_24h: {
    predicted_xau_usd: number
    change_usd: number
    change_pct: number
    range_low: number
    range_high: number
    confidence_pct: number
  }
  nepal_forecast_11am: {
    predicted_24k_tola_npr: number
    predicted_22k_tola_npr: number
    predicted_24k_10g_npr: number
    expected_change_tola_npr: number
  }
  key_drivers_explanation: Driver[]
}

export interface NepalForecast {
  predicted24kTolaNpr: number
  predicted24k10gNpr: number
  predicted22kTolaNpr: number
  predicted22k10gNpr: number
  predictedTejabiTolaNpr: number
  predictedTejabi10gNpr: number
  expectedChangeTolaNpr: number | null
  exact24kTolaNpr: number
  exact24k10gNpr: number
  exact22kTolaNpr: number
  exact22k10gNpr: number
  baseNprPerGram: number
  fxRate: number
  fxMovePct?: number
  fxMoveSource?: string | null
  customsDutyPct: number
  bankFreightPct: number
  localSpreadPct: number
  spreadSampleCount: number
  vatOtherLevyPct?: number
  dealerMarginPct?: number
  tejabiRatio: number
  tejabiRatioSource: 'learned' | 'manual'
  tejabiRatioSamples: number
  tejabiRatioLastUpdatedAt: string | null
  usedOfficialAnchor?: boolean
  official24kAnchorNpr?: number | null
  officialRateDate?: string | null
  spotMovePct?: number | null
  spotAdjustmentNpr?: number | null
  fxAdjustmentNpr?: number | null
  unanchoredImportParity24kNpr?: number | null
  unanchoredImportParityDeltaNpr?: number | null
}

export interface AlarmSettings {
  thresholdNprPerTola: number
  enabled: boolean
  muted: boolean
  updatedAt: string | null
}

export interface ParitySettings {
  customsDutyPct: number
  vatOtherLevyPct: number
  dealerMarginPct: number
  tejabiManualRatio: number
  tejabiManualUpdatedAt?: string | null
  updatedAt?: string | null
}

export interface NepalFixingTiming {
  mode: 'last-minute' | 'overnight'
  targetDate: string
  targetAt: string
  countdownMs: number
  holidayDates: string[]
  closureNote: string | null
}

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
  confidence: 'Low' | 'Medium' | 'High'
}

export type ProbabilisticForecast = Record<ProbabilisticInstrumentForecast['instrument'], ProbabilisticInstrumentForecast>

export interface BaselineMetricSet {
  observations: number
  mae: number | null
  mapePct: number | null
  directionAccuracyPct: number | null
}
export interface BaselineWindowComparison {
  days: 7 | 30 | 90
  aurum: BaselineMetricSet
  naive: BaselineMetricSet
  beatsBaseline: boolean | null
}
export interface BaselineComparison {
  instrument: 'xau-usd' | 'nepal-24k'
  totalMatched: number
  minimumRequired: number
  status: 'ready' | 'not-enough-data'
  windows: BaselineWindowComparison[]
}
export interface EmpiricalRange {
  method: 'empirical-error'
  samples: number
  lowerError: number
  upperError: number
  lowerQuantile: 10
  upperQuantile: 90
}
export interface CalibrationSummary {
  instrument: ProbabilisticInstrumentForecast['instrument']
  method: 'isotonic' | 'uncalibrated'
  samples: number
  minimumRequired: number
  buckets: Array<{ label: string; observations: number; meanForecastPct: number | null; actualUpRatePct: number | null }>
  isotonicBlocks: Array<{ minProbability: number; maxProbability: number; calibratedProbability: number; count: number }>
}
export interface ForecastRangeCalibration {
  method: 'empirical-error' | 'volatility-based'
  samples: number
  label: string
  lowerError?: number
  upperError?: number
  scale: number
}
export interface AccuracyMetric {
  days: 7 | 30 | 90
  instrument: ProbabilisticInstrumentForecast['instrument']
  observations: number
  rangeHitRatePct: number | null
  mae: number | null
  mapePct: number | null
  directionAccuracyPct: number | null
}

export interface PredictionLogEntry {
  id: string
  createdAt: string
  targetDate: string
  targetAt: string
  snapshot?: PredictionSnapshot
  fixingWindow?: FixingWindowAudit
  inputs: {
    spotXauUsd: number | null
    usdNpr: number | null
    usdNprSource: string
    xauSource: string
    localSpreadPct: number | null
    confidencePct: number
    macroContributions: MacroFactorContributions | null
    modelFeatures?: Record<string, number>
    observedMarketInputs: {
      dxy: number | null
      dxyChangePct: number | null
      us10yNominalPct: number | null
      us10yRealPct: number | null
      ratePathProxy: number | null
      reportedEtfFlowUsdBn: number | null
      reportedCentralBankTonnes: number | null
      official24kPerTolaNpr: number | null
    }
  }
  predictions: Record<ProbabilisticInstrumentForecast['instrument'], {
    low: number; base: number; high: number; direction: 'up' | 'down' | 'flat'; reference: number | null
    upProbabilityPct: number; downProbabilityPct: number; confidencePct: number; confidence: 'Low' | 'Medium' | 'High'
  }>
  actuals: Partial<Record<ProbabilisticInstrumentForecast['instrument'], { value: number; observedAt: string; source: string }>>
}

export interface FixingWindowQuality {
  exact: number
  approximate: number
  unavailable: number
  awaiting: number
  note: string
}
export interface AccuracyReport {
  generatedAt: string
  totalLogged: number
  fixingWindowQuality: FixingWindowQuality
  metrics: AccuracyMetric[]
  baselines: { 'xau-usd': BaselineComparison; 'nepal-24k': BaselineComparison }
  calibrations: Record<ProbabilisticInstrumentForecast['instrument'], CalibrationSummary>
  series: Array<{ date: string; targetDate: string; instrument: ProbabilisticInstrumentForecast['instrument']; predicted: number; actual: number | null; referenceValue?: number | null; referenceSource?: string | null; referenceDate?: string | null; windowStartTargetAt?: string | null; windowStartObservedAt?: string | null; windowTargetAt?: string | null; windowActualObservedAt?: string | null; windowPrecision?: string | null; windowNote?: string | null; rangeMethod?: string | null; source?: string | null }>
  backtest?: AccuracyMetric[]
  backtestNote?: string
}

export interface BacktestMetric {
  label: string
  days: number
  observations: number
  mapePct: number | null
  directionalWinRatePct: number | null
  rmseUsd: number | null
}

export interface ScenarioInput {
  warEscalation: number
  dxyShiftPct: number
  yieldShiftBps: number
  usdNpr: number
  customsDutyPct: number
  bankFreightPct: number
  headline: string
}

export interface ScenarioForecast {
  global: QuantForecast
  nepal: NepalForecast | null
  contributions: {
    headlineAndConflictPct: number
    dxyPct: number
    yieldPct: number
    eventOverlayPct: number
    totalScenarioPct: number
  }
  atrMoveCapPct: number
  severeEventException: boolean
  scenarioGeopoliticalScore: number
  scenarioHeadlineScore: number
}

export interface EnsembleDriverScore {
  key: string
  label: string
  signal: number | null
  contributionPct: number | null
  direction: 'bullish' | 'bearish' | 'neutral' | 'unavailable'
  contributionKind: 'ridge-blend' | 'heuristic-overlay' | 'rules-overlay' | 'legacy-quant' | 'excluded'
  status: Stage2FeedStatus | 'fresh' | 'stale' | 'unavailable' | 'proxy'
  source: string
  asOf: string | null
  note: string
}

export interface EnsembleModelSummary {
  mode: 'ridge-learned' | 'heuristic-fallback'
  fitAt: string | null
  trainingSamples: number
  backtestSamples: number
  ridgeLambda: number | null
  weights: Record<string, number>
  note: string
}

export interface EventRiskAdjustment {
  rangeMultiplier: number
  confidencePenaltyPct: number
  activeEvents: Array<{ title: string; kind: MacroCalendarEvent['kind']; startsAt: string; hoursUntil: number }>
  note: string
}

export interface PredictionResponse {
  market: MarketSnapshot
  events: LiveEvent[]
  quantitativeForecast: QuantForecast | null
  analysis: AnalysisOutput | null
  analysisMode: 'rules-based' | 'openai' | 'gemini' | 'anthropic'
  analysisStatus: 'ready' | 'fallback' | 'unavailable'
  modelNote: string
  backtest: BacktestMetric[]
  defaultNepalForecast: NepalForecast | null
  probabilisticForecast?: ProbabilisticForecast | null
  nepalTiming?: NepalFixingTiming
  paritySettings?: ParitySettings
  ensembleModel?: EnsembleModelSummary
  ensembleDrivers?: EnsembleDriverScore[]
  ensembleFeatures?: Record<string, number>
  eventRisk?: EventRiskAdjustment
  volatilityRegime?: VolatilityRegimeSummary
  whyGlobalFactors?: ForecastWhyFactor[]
  whyNepalFactors?: ForecastWhyFactor[]
  fixingWindow?: FixingWindowAudit
  rangeCalibration?: Record<ProbabilisticInstrumentForecast['instrument'], ForecastRangeCalibration>
  probabilityCalibration?: Record<ProbabilisticInstrumentForecast['instrument'], { method: 'isotonic' | 'uncalibrated'; samples: number; minimumRequired: number }>
  probabilityCalibrationFits?: Record<ProbabilisticInstrumentForecast['instrument'], CalibrationSummary>
}
