import type { EventRiskAdjustment, MacroCalendarEvent, QuantForecast } from '@/lib/types'
import { clamp } from '@/lib/goldEngine'

function calendarDayNumber(date: string): number | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000)
}

/** Widens ranges and lowers confidence before/briefly after scheduled high-impact releases. */
export function calculateEventRiskAdjustment(events: MacroCalendarEvent[], now = new Date()): EventRiskAdjustment {
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const todayNumber = calendarDayNumber(todayParts) ?? Math.floor(now.getTime() / 86_400_000)
  const activeEvents = events.map((event) => {
    if (event.timePrecision === 'date-only') {
      const eventDay = calendarDayNumber(event.startsAt.slice(0, 10))
      const daysUntil = eventDay === null ? NaN : eventDay - todayNumber
      return { event, hoursUntil: daysUntil * 24, dateOnly: true }
    }
    return { event, hoursUntil: (Date.parse(event.startsAt) - now.getTime()) / 3_600_000, dateOnly: false }
  }).filter(({ event, hoursUntil, dateOnly }) => Number.isFinite(hoursUntil) && (dateOnly ? hoursUntil >= 0 && hoursUntil <= 24 : hoursUntil >= -4 && hoursUntil <= 36) && event.highImpact)
    .sort((a, b) => a.hoursUntil - b.hoursUntil)

  let aggregateRisk = 0
  const relevant = activeEvents.map(({ event, hoursUntil, dateOnly }) => {
    const importance = event.kind === 'FOMC' || event.kind === 'CPI' || event.kind === 'NFP' ? 1 : 0.55
    const urgency = dateOnly ? 0.75 : hoursUntil >= 0 ? clamp(1 - hoursUntil / 36, 0, 1) : clamp(1 + hoursUntil / 4, 0, 1)
    aggregateRisk += importance * urgency
    return { title: event.title, kind: event.kind, startsAt: event.startsAt, hoursUntil: Math.round(hoursUntil * 10) / 10 }
  })
  const rangeMultiplier = Math.round(clamp(1 + aggregateRisk * 0.18, 1, 1.65) * 1000) / 1000
  const confidencePenaltyPct = Math.round(clamp(aggregateRisk * 7, 0, 24) * 10) / 10
  const includesDateOnly = activeEvents.some((item) => item.dateOnly)
  return {
    rangeMultiplier,
    confidencePenaltyPct,
    activeEvents: relevant,
    note: relevant.length
      ? `Scheduled-event risk adjustment from ${relevant.length} high-impact event${relevant.length === 1 ? '' : 's'}; point forecast is unchanged.${includesDateOnly ? ' Date-only calendar records use a conservative all-day window without an invented release time.' : ''}`
      : 'No high-impact calendar event falls in the next 36 hours or prior 4-hour release window.',
  }
}

export function widenForecastForEvents(forecast: QuantForecast, adjustment: EventRiskAdjustment): QuantForecast {
  const halfWidth = Math.max(0, (forecast.rangeHigh - forecast.rangeLow) / 2) * adjustment.rangeMultiplier
  return {
    ...forecast,
    rangeLow: Math.max(0, forecast.predictedXauUsd - halfWidth),
    rangeHigh: forecast.predictedXauUsd + halfWidth,
    confidencePct: Math.round(clamp(forecast.confidencePct - adjustment.confidencePenaltyPct, 20, 90)),
    confidenceLabel: adjustment.activeEvents.length ? 'Event-adjusted signal confidence · uncalibrated' : forecast.confidenceLabel,
  }
}
