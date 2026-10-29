import type { ForecastReliability, MarketSnapshot, ReliabilityFeedCheck, ReliabilityFeedState } from '@/lib/types'

export const RELIABILITY_THRESHOLDS = {
  spotDuringMarketHoursMs: 10 * 60_000,
  spotOutsideMarketHoursMs: 50 * 60 * 60_000,
  usdNprMs: 36 * 60 * 60_000,
  officialRateMaxBusinessDays: 1,
} as const

export function isGoldMarketOpen(date: Date): boolean {
  const day = date.getUTCDay()
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  // Indicative 24/5 XAU session: Sunday 22:00 UTC through Friday 22:00 UTC.
  if (day === 0) return hour >= 22
  if (day >= 1 && day <= 4) return true
  if (day === 5) return hour < 22
  return false
}

function ageMs(asOf: string | null, nowMs: number): number | null {
  if (!asOf) return null
  const parsed = Date.parse(asOf)
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null
}

function isSaturday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 6
}
function nptToday(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
function businessAgeDays(rateDate: string, today: string, holidays: Set<string>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || rateDate > today) return null
  let age = 0
  const cursor = new Date(`${rateDate}T12:00:00Z`)
  const end = new Date(`${today}T12:00:00Z`)
  while (cursor < end && age < 1000) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const date = cursor.toISOString().slice(0, 10)
    if (!isSaturday(date) && !holidays.has(date)) age += 1
  }
  return age
}

function makeFeed(name: string, state: ReliabilityFeedState, asOf: string | null, reason: string | null): ReliabilityFeedCheck {
  return { name, state, asOf, reason }
}

export function assessForecastReliability(market: MarketSnapshot, now = new Date(), holidayDates: string[] = []): ForecastReliability {
  const nowMs = now.getTime()
  const spotAge = ageMs(market.spotAsOf, nowMs)
  const spotLimit = isGoldMarketOpen(now) ? RELIABILITY_THRESHOLDS.spotDuringMarketHoursMs : RELIABILITY_THRESHOLDS.spotOutsideMarketHoursMs
  const spotState: ReliabilityFeedState = market.spot === null ? 'unavailable'
    : market.spotStale || spotAge === null || spotAge > spotLimit ? 'stale' : 'live'
  const spotReason = spotState === 'unavailable' ? 'XAU/USD spot is unavailable.'
    : spotState === 'stale' ? `XAU/USD spot is stale (age ${spotAge === null ? 'unknown' : `${Math.round(spotAge / 60_000)} min`}; limit ${Math.round(spotLimit / 60_000)} min for the current session).`
      : null
  const spot = makeFeed('XAU/USD spot', spotState, market.spotAsOf, spotReason)

  const fx = market.macro.usdNprParity
  const fxAge = ageMs(fx.asOf, nowMs)
  const fxState: ReliabilityFeedState = fx.value === null ? 'unavailable'
    : fx.stale || fxAge === null || fxAge > RELIABILITY_THRESHOLDS.usdNprMs ? 'stale' : 'live'
  const fxReason = fxState === 'unavailable' ? 'USD/NPR conversion is unavailable.'
    : fxState === 'stale' ? `USD/NPR conversion is stale (source ${fx.source}; age ${fxAge === null ? 'unknown' : `${Math.round(fxAge / 3_600_000)} h`}).`
      : null
  const usdNpr = makeFeed('USD/NPR conversion', fxState, fx.asOf, fxReason)

  const officialDate = market.nepal.rateDate
  const daysOld = officialDate ? businessAgeDays(officialDate, nptToday(now), new Set(holidayDates)) : null
  let officialState: ReliabilityFeedState
  let officialReason: string | null
  if (market.nepal.rate24kTola === null || !officialDate) {
    officialState = 'unavailable'
    officialReason = 'FENEGOSIDA official 24K benchmark is unavailable or has no valid fixing date.'
  } else if (market.nepal.rate24kManualEntry) {
    officialState = 'manual'
    officialReason = 'FENEGOSIDA automatic official feed is unavailable; a manual transcription is being used and remains lower reliability.'
  } else if (daysOld === null || daysOld > RELIABILITY_THRESHOLDS.officialRateMaxBusinessDays) {
    officialState = 'stale'
    officialReason = `FENEGOSIDA official rate is stale (${daysOld === null ? 'fixing age unknown' : `${daysOld} business day(s)`}; limit ${RELIABILITY_THRESHOLDS.officialRateMaxBusinessDays}).`
  } else {
    officialState = 'live'
    officialReason = null
  }
  const official = makeFeed('FENEGOSIDA official 24K', officialState, market.nepal.rateAsOf ?? officialDate, officialReason)

  const globalFeeds = [spot]
  const nepalFeeds = [spot, usdNpr, official]
  const globalReasons = globalFeeds.flatMap((feed) => feed.reason ? [feed.reason] : [])
  const nepalReasons = nepalFeeds.flatMap((feed) => feed.reason ? [feed.reason] : [])
  return {
    assessedAt: now.toISOString(),
    thresholds: {
      spotDuringMarketHoursMinutes: RELIABILITY_THRESHOLDS.spotDuringMarketHoursMs / 60_000,
      spotOutsideMarketHoursHours: RELIABILITY_THRESHOLDS.spotOutsideMarketHoursMs / 3_600_000,
      usdNprHours: RELIABILITY_THRESHOLDS.usdNprMs / 3_600_000,
      officialRateBusinessDays: RELIABILITY_THRESHOLDS.officialRateMaxBusinessDays,
    },
    global: { state: globalReasons.length ? 'low-reliability' : 'reliable', feeds: globalFeeds, reasons: globalReasons },
    nepal: { state: nepalReasons.length ? 'low-reliability' : 'reliable', feeds: nepalFeeds, reasons: nepalReasons },
  }
}
