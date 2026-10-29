import type { FixingWindowAudit, FixingWindowPoint, OhlcCandle } from '@/lib/types'

export interface SpotObservation {
  value: number
  observedAt: string
  source: string
}

const NPT_OFFSET_MINUTES = 5 * 60 + 45
const EXACT_TOLERANCE_MS = 5 * 60_000
const APPROXIMATE_TOLERANCE_MS = 60 * 60_000

function dateAtNpt(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - NPT_OFFSET_MINUTES * 60_000).toISOString()
}

function shiftDate(date: string, days: number): string {
  const cursor = new Date(`${date}T12:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() + days)
  return cursor.toISOString().slice(0, 10)
}

function isFixingBusinessDay(date: string, holidays: Set<string>): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return weekday !== 6 && !holidays.has(date) // Saturday closure; Sunday is open unless explicitly listed.
}

export function previousFixingTimestamp(targetDate: string, holidayDates: string[] = []): string {
  const holidays = new Set(holidayDates)
  let date = shiftDate(targetDate, -1)
  for (let i = 0; i < 370; i += 1) {
    if (isFixingBusinessDay(date, holidays)) return dateAtNpt(date, 11, 0)
    date = shiftDate(date, -1)
  }
  return dateAtNpt(shiftDate(targetDate, -1), 11, 0)
}

export function targetSpotTimestamp(targetAt: string): string {
  return new Date(Date.parse(targetAt) - 15 * 60_000).toISOString()
}

export function buildFixingWindowAudit(input: {
  targetDate: string
  targetAt: string
  holidayDates?: string[]
  now: string
  currentSpot: SpotObservation | null
  historicalSpots?: SpotObservation[]
}): FixingWindowAudit {
  const previousFixingTargetAt = previousFixingTimestamp(input.targetDate, input.holidayDates)
  const targetObservationTargetAt = targetSpotTimestamp(input.targetAt)
  const nowMs = Date.parse(input.now)
  const targetMs = Date.parse(previousFixingTargetAt)
  const points = [...(input.historicalSpots ?? []), ...(input.currentSpot ? [input.currentSpot] : [])]
    .filter((point) => Number.isFinite(point.value) && point.value > 0 && Number.isFinite(Date.parse(point.observedAt)) && Date.parse(point.observedAt) <= nowMs)
  const before = points.filter((point) => Date.parse(point.observedAt) <= targetMs)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]
  const after = points.filter((point) => Date.parse(point.observedAt) > targetMs)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0]
  let startObservation: FixingWindowPoint | null = null
  const near = before && targetMs - Date.parse(before.observedAt) <= APPROXIMATE_TOLERANCE_MS ? before
    : after && Date.parse(after.observedAt) - targetMs <= EXACT_TOLERANCE_MS ? after : null
  if (near) {
    const distance = Math.abs(Date.parse(near.observedAt) - targetMs)
    startObservation = {
      ...near,
      targetAt: previousFixingTargetAt,
      precision: distance <= EXACT_TOLERANCE_MS ? 'exact' : 'approximate-window',
      note: distance <= EXACT_TOLERANCE_MS
        ? 'Observed spot within five minutes of the previous 11:00 NPT fixing window.'
        : 'Nearest recorded spot is within one hour of the previous fixing; approximate window.',
    }
  } else if (input.currentSpot && Date.parse(input.currentSpot.observedAt) <= Date.parse(input.targetAt)) {
    // This is an honest, pre-forecast fallback, not a claim that the quote was observed at the fixing.
    startObservation = {
      ...input.currentSpot,
      targetAt: previousFixingTargetAt,
      precision: 'approximate-window',
      note: 'No quote was recorded near the previous fixing; latest pre-target spot is used as an approximate-window reference.',
    }
  }
  const status = !startObservation ? 'unavailable' : startObservation.precision === 'exact' ? 'exact-window' : 'approximate-window'
  return {
    previousFixingTargetAt,
    targetObservationTargetAt,
    startObservation,
    targetObservation: null,
    status,
    note: startObservation?.note ?? 'No observed spot reference is available for the previous fixing window.',
  }
}

export function resolveTargetSpotObservation(
  points: SpotObservation[],
  targetAt: string,
  fallbackCandle?: OhlcCandle | null,
): FixingWindowPoint | null {
  const targetMs = Date.parse(targetAt)
  const valid = points.filter((point) => Number.isFinite(point.value) && point.value > 0 && Number.isFinite(Date.parse(point.observedAt)))
  const prior = valid.filter((point) => Date.parse(point.observedAt) <= targetMs)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]
  if (prior && targetMs - Date.parse(prior.observedAt) <= APPROXIMATE_TOLERANCE_MS) {
    const distance = targetMs - Date.parse(prior.observedAt)
    return {
      ...prior,
      targetAt,
      precision: distance <= EXACT_TOLERANCE_MS ? 'exact' : 'approximate-window',
      note: distance <= EXACT_TOLERANCE_MS
        ? 'Observed spot within five minutes before the target 10:45 NPT window.'
        : 'Closest recorded spot before 10:45 NPT is within one hour; approximate window.',
    }
  }
  if (fallbackCandle && Number.isFinite(fallbackCandle.close) && fallbackCandle.close > 0) {
    return {
      value: fallbackCandle.close,
      observedAt: new Date(fallbackCandle.timestamp * 1000).toISOString(),
      source: 'XAUS daily OHLC close · approximate window',
      targetAt,
      precision: 'approximate-window',
      note: 'No quote snapshot was recorded near 10:45 NPT; the observed daily close is an approximate-window fallback, not a 10:45 quote.',
    }
  }
  return null
}
