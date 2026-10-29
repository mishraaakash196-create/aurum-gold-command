export type PriceMoveSource = 'daily' | 'forecast' | 'scenario' | 'event' | 'simulated'
export type PriceMoveDirection = 'surge' | 'drop'

export interface PriceMoveCandidate {
  source: PriceMoveSource
  changeNprPerTola: number | null
}

export interface PriceMoveAlarm {
  source: PriceMoveSource
  direction: PriceMoveDirection
  changeNprPerTola: number
  thresholdNprPerTola: number
}

export interface LiveChartPoint {
  date: string
  close: number
  actual: number
  kind: 'live'
}

/** Build the exact current quote point shared by the chart and sync audit. */
export function buildLiveChartPoint(value: number | null, label = 'LIVE NOW'): LiveChartPoint | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  return { date: label, close: value, actual: value, kind: 'live' }
}

export function isLiveChartPointSynced(point: LiveChartPoint | null, quote: number | null): boolean {
  return point !== null && quote !== null && Number.isFinite(quote) && point.close === quote
}

/**
 * Selects a triggered move from observed fixing, provider forecast and local
 * scenarios. Priority prevents a hypothetical overlay from hiding today's
 * published move, except when a simulated event is explicitly active.
 */
export function selectPriceMoveAlarm(
  candidates: PriceMoveCandidate[],
  thresholdNprPerTola = 2_000,
): PriceMoveAlarm | null {
  const threshold = Number.isFinite(thresholdNprPerTola) ? Math.max(1, Math.abs(thresholdNprPerTola)) : 2_000
  const priority: PriceMoveSource[] = ['simulated', 'event', 'daily', 'scenario', 'forecast']
  for (const source of priority) {
    const candidate = candidates.find((item) => item.source === source && item.changeNprPerTola !== null && Number.isFinite(item.changeNprPerTola) && Math.abs(item.changeNprPerTola) >= threshold)
    if (candidate?.changeNprPerTola === null || candidate?.changeNprPerTola === undefined) continue
    return {
      source,
      direction: candidate.changeNprPerTola >= 0 ? 'surge' : 'drop',
      changeNprPerTola: candidate.changeNprPerTola,
      thresholdNprPerTola: threshold,
    }
  }
  return null
}
