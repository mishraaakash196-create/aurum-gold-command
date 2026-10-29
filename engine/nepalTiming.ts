export interface NepalFixingTiming {
  mode: 'last-minute' | 'overnight'
  targetDate: string
  targetAt: string
  countdownMs: number
  holidayDates: string[]
  closureNote: string | null
}

function nptDateParts(date: Date) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(values.find((item) => item.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateAtElevenNpt(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  // NPT is UTC+05:45, so 11:00 NPT is 05:15 UTC.
  return new Date(Date.UTC(year, month - 1, day, 5, 15, 0))
}

function isSaturday(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6
}

/** Saturday is treated as a FENEGOSIDA closure; public holidays come from explicit ISO dates in env. */
export function getNepalFixingTiming(now = new Date(), holidayDates: string[] = []): NepalFixingTiming {
  const holidays = [...new Set(holidayDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
  const parts = nptDateParts(now)
  let date = isoDate(parts.year, parts.month, parts.day)
  const todayFix = dateAtElevenNpt(date)
  const holidaySet = new Set(holidays)
  const businessToday = !isSaturday(date) && !holidaySet.has(date)
  const isBeforeFix = now.getTime() < todayFix.getTime()
  const mode: NepalFixingTiming['mode'] = businessToday && isBeforeFix ? 'last-minute' : 'overnight'
  if (mode === 'overnight') {
    const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12))
    for (let attempts = 0; attempts < 370; attempts += 1) {
      const candidate = isoDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())
      if (!isSaturday(candidate) && !holidaySet.has(candidate)) {
        date = candidate
        break
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  const targetAt = dateAtElevenNpt(date)
  const closureNote = !businessToday ? (holidaySet.has(isoDate(parts.year, parts.month, parts.day)) ? 'Today is a configured Nepal public holiday.' : 'Saturday closure; next open fixing day selected.') : null
  return {
    mode,
    targetDate: date,
    targetAt: targetAt.toISOString(),
    countdownMs: Math.max(0, targetAt.getTime() - now.getTime()),
    holidayDates: holidays,
    closureNote,
  }
}
