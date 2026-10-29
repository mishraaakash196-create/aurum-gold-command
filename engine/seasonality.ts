import NepaliDate from 'nepali-date-converter'
import { clamp } from '@/lib/goldEngine'
import type { SeasonalDemandIndex } from '@/lib/types'

const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra']

function proximity(day: number, start: number, end: number, peak: number): number {
  if (day < start || day > end) return 0
  const center = (start + end) / 2
  const halfWidth = Math.max(1, (end - start) / 2)
  return peak * (1 - 0.35 * Math.abs(day - center) / halfWidth)
}

/**
 * Calendar-only Nepal demand proxy. Festival windows are deliberately broad
 * (especially Akshaya Tritiya, whose tithi varies); this is not measured demand.
 */
export function seasonalityFromBsDate(year: number, monthIndex: number, day: number): SeasonalDemandIndex {
  const components: string[] = []
  let lift = 0
  const monthName = BS_MONTHS[monthIndex] ?? 'Unknown'

  if (monthIndex === 5) {
    const score = proximity(day, 1, 20, 27)
    if (score > 0) { lift += score; components.push('Dashain window (BS Ashwin 1–20)') }
  }
  if (monthIndex === 6) {
    const score = proximity(day, 1, 15, 25)
    if (score > 0) { lift += score; components.push('Tihar window (BS Kartik 1–15)') }
  }
  if (monthIndex === 0) {
    const score = proximity(day, 10, 16, 18)
    if (score > 0) { lift += score; components.push('Akshaya Tritiya broad window (BS Baisakh 10–16; tithi proxy)') }
  }
  const weddingLift: Record<number, number> = { 0: 8, 7: 16, 9: 14, 10: 10 }
  if (weddingLift[monthIndex]) {
    lift += weddingLift[monthIndex]
    components.push(`Wedding-season proxy (${monthName})`)
  }

  const index = Math.round(clamp(50 + lift, 20, 90))
  const signedScorePct = Math.round(clamp((index - 50) * 0.0015, -0.06, 0.06) * 1000) / 1000
  const phase = components.length ? components.join(' + ') : `${monthName} baseline seasonality`
  return {
    index,
    signedScorePct,
    bsDate: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    phase,
    components,
    source: 'Calendar-derived proxy · Bikram Sambat date, not observed jewellery sales',
  }
}

export function calculateSeasonalDemandIndex(date = new Date()): SeasonalDemandIndex {
  const nepali = new NepaliDate(date)
  return seasonalityFromBsDate(nepali.getYear(), nepali.getMonth(), nepali.getDate())
}
