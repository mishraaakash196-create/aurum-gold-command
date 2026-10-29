import type {
  CentralBankDemandReport,
  GoldEtfFlowReport,
  InstitutionalDemandSnapshot,
  OfficialGoldReserve,
  ReportedCentralBankPurchase,
} from './types'

const TROY_OUNCE_GRAMS = 31.1034768
const IMF_TROY_OUNCES_TO_TONNES = TROY_OUNCE_GRAMS / 1_000_000
const MAX_PLAUSIBLE_COUNTRY_RESERVES_TONNES = 10_000
const IMF_RESERVE_MAX_AGE_DAYS = 120
const WGC_CENTRAL_BANK_MAX_AGE_DAYS = 120
const WGC_ETF_MAX_AGE_DAYS = 62
const SOURCE_TIMEOUT_MS = 7_500
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export const IMF_IRFCL_DATASET_URL = 'https://data.imf.org/en/datasets/IMF.STA:IRFCL'
export const IMF_GOLD_SERIES_URL = 'https://api.imf.org/external/sdmx/2.1/data/IRFCL'
export const WGC_CENTRAL_BANK_ARCHIVE_URL = 'https://www.gold.org/goldhub/gold-focus'
export const WGC_ETF_ARCHIVE_URL = 'https://www.gold.org/goldhub/research/gold-etfs-holdings-and-flows'

const COUNTRY_NAMES: Record<string, string> = {
  USA: 'United States',
  CHN: 'China',
  IND: 'India',
  POL: 'Poland',
  KAZ: 'Kazakhstan',
  BRA: 'Brazil',
  DEU: 'Germany',
  FRA: 'France',
  ITA: 'Italy',
  JPN: 'Japan',
  RUS: 'Russia',
  UZB: 'Uzbekistan',
  CZE: 'Czech Republic',
  TUR: 'Türkiye',
}

const WGC_COUNTRIES: Array<{ countryCode: string; country: string; match: RegExp }> = [
  { countryCode: 'POL', country: 'Poland', match: /\bpoland\b/i },
  { countryCode: 'KAZ', country: 'Kazakhstan', match: /\bkazakhstan\b/i },
  { countryCode: 'BRA', country: 'Brazil', match: /\bbrazil\b/i },
  { countryCode: 'USA', country: 'United States', match: /\b(?:united states|u\.?s\.?|american)\b/i },
  { countryCode: 'CHN', country: 'China', match: /\bchina\b/i },
  { countryCode: 'IND', country: 'India', match: /\bindia\b/i },
  { countryCode: 'RUS', country: 'Russia', match: /\brussia\b/i },
  { countryCode: 'UZB', country: 'Uzbekistan', match: /\buzbekistan\b/i },
  { countryCode: 'CZE', country: 'Czech Republic', match: /\bczech\b/i },
  { countryCode: 'TUR', country: 'Türkiye', match: /\bturkey|\btürkiye\b/i },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_LOOKUP = new Map(MONTHS.map((month, index) => [month.toLowerCase(), index + 1]))

const globalCache = globalThis as typeof globalThis & {
  __aurumInstitutionalDemandCache?: { expiresAt: number; value: InstitutionalDemandSnapshot }
  __aurumInstitutionalDemandPromise?: Promise<InstitutionalDemandSnapshot>
}

function monthEndDate(period: string | null): Date | null {
  const match = period?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return new Date(Date.UTC(year, month, 0, 23, 59, 59))
}

function ageDays(date: Date | null, now: Date): number | null {
  if (!date || !Number.isFinite(date.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000))
}

function parsePeriod(period: string): Date | null {
  const match = period.match(/^(\d{4})-M(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return new Date(Date.UTC(year, month, 0, 23, 59, 59))
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }
  return rows
}

function monthDistance(older: string, newer: string): number | null {
  const first = older.match(/^(\d{4})-M(\d{2})$/)
  const second = newer.match(/^(\d{4})-M(\d{2})$/)
  if (!first || !second) return null
  return (Number(second[1]) - Number(first[1])) * 12 + Number(second[2]) - Number(first[2])
}

/** Parse the official IMF IRFCL fine-troy-ounce monthly series, guarding against scale jumps. */
export function parseImfGoldReserves(csv: string, now = new Date()): OfficialGoldReserve[] {
  const records = parseCsv(csv)
  if (records.length < 2) return []
  const headers = records[0].map((cell) => cell.trim().toUpperCase())
  const countryIndex = headers.indexOf('COUNTRY')
  const periodIndex = headers.indexOf('TIME_PERIOD')
  const valueIndex = headers.indexOf('OBS_VALUE')
  if (countryIndex < 0 || periodIndex < 0 || valueIndex < 0) return []

  const grouped = new Map<string, Array<{ period: string; tonnes: number }>>()
  const anomalousCountries = new Set<string>()
  for (const record of records.slice(1)) {
    const code = String(record[countryIndex] ?? '').trim().toUpperCase()
    if (!COUNTRY_NAMES[code]) continue
    const period = String(record[periodIndex] ?? '').trim()
    if (!parsePeriod(period)) continue
    const rawValue = Number(record[valueIndex])
    if (!Number.isFinite(rawValue) || rawValue <= 0) continue
    const tonnes = rawValue * IMF_TROY_OUNCES_TO_TONNES
    if (!Number.isFinite(tonnes) || tonnes <= 0 || tonnes > MAX_PLAUSIBLE_COUNTRY_RESERVES_TONNES) {
      anomalousCountries.add(code)
      continue
    }
    const observations = grouped.get(code) ?? []
    observations.push({ period, tonnes })
    grouped.set(code, observations)
  }

  return Object.entries(COUNTRY_NAMES).map(([countryCode, country]) => {
    const raw = (grouped.get(countryCode) ?? []).sort((a, b) => a.period.localeCompare(b.period))
    const plausible: typeof raw = []
    for (const observation of raw) {
      const previous = plausible.at(-1)
      // A country reserve total cannot plausibly jump several-fold in one month.
      // Reject the point and retain the previous reported observation, visibly flagged.
      if (previous && monthDistance(previous.period, observation.period) === 1 &&
        Math.abs(observation.tonnes - previous.tonnes) > Math.max(1_000, previous.tonnes * 2.5)) {
        anomalousCountries.add(countryCode)
        continue
      }
      plausible.push(observation)
    }
    const latest = plausible.at(-1)
    const previous = plausible.at(-2)
    const asOfDate = latest ? parsePeriod(latest.period) : null
    const age = ageDays(asOfDate, now)
    const stale = age === null || age > IMF_RESERVE_MAX_AGE_DAYS
    const anomalyDetected = anomalousCountries.has(countryCode)
    const priorPeriodDistance = previous && latest ? monthDistance(previous.period, latest.period) : null
    const changeTonnes = previous && latest && priorPeriodDistance !== null && priorPeriodDistance <= 2
      ? latest.tonnes - previous.tonnes
      : null
    const month = latest?.period.match(/^(\d{4})-M(\d{2})$/)
    const asOf = month ? `${month[1]}-${month[2]}` : null
    const note = anomalyDetected
      ? 'Latest series included a scale/plausibility anomaly; any displayed earlier value is stale and excluded from directional scoring.'
      : stale
        ? 'Latest reported monthly quantity is older than 120 days; displayed for reference only.'
        : 'Reported monthly fine-troy-ounce quantity converted to metric tonnes; countries may report in different months.'
    return {
      countryCode,
      country,
      tonnes: latest?.tonnes ?? null,
      asOf,
      changeTonnes,
      stale,
      anomalyDetected,
      sourceUrl: IMF_IRFCL_DATASET_URL,
      note,
    }
  })
}

function decodeHtml(input: string): string {
  return input.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity, value: string) => {
    const lower = value.toLowerCase()
    if (lower === 'nbsp') return ' '
    if (lower === 'amp') return '&'
    if (lower === 'quot') return '"'
    if (lower === 'apos' || lower === '#39') return "'"
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'ndash') return '–'
    if (lower === 'mdash') return '—'
    if (lower === 'rsquo' || lower === 'lsquo') return '’'
    if (lower === 'rdquo' || lower === 'ldquo') return '“'
    if (lower === 'bull') return '•'
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : lower.startsWith('#')
        ? Number.parseInt(lower.slice(1), 10)
        : NaN
    return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity
  })
}

function htmlToText(html: string): string {
  return decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function getAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(pattern)
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? '') : null
}

function metaValue(html: string, key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const property = getAttribute(tag, 'property')
    const name = getAttribute(tag, 'name')
    if ((property ?? name)?.toLowerCase() === key.toLowerCase()) return getAttribute(tag, 'content')
  }
  return null
}

function monthNumber(name: string): number | null {
  return MONTH_LOOKUP.get(name.toLowerCase()) ?? null
}

function isoFromMonthName(monthName: string, year: number): string | null {
  const month = monthNumber(monthName)
  return month ? `${year}-${String(month).padStart(2, '0')}` : null
}

function parseMonthEndFromText(text: string): string | null {
  const match = text.match(/\bdata\s+to\s+31\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(20\d{2})/i)
  return match ? isoFromMonthName(match[1], Number(match[2])) : null
}

function parseTitleMonth(text: string, year: number): string | null {
  for (const month of MONTHS) {
    if (new RegExp(`\\b${month}\\b`, 'i').test(text)) return isoFromMonthName(month, year)
  }
  return null
}

function parsePublicationDate(text: string, html: string, now: Date): string | null {
  const published = htmlToText(text)
  const patterns = [
    /\bpublished\s*:?\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(20\d{2})/i,
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(20\d{2})/i,
  ]
  for (const pattern of patterns) {
    const match = published.match(pattern)
    if (!match) continue
    const month = monthNumber(match[2])
    if (!month) continue
    return new Date(Date.UTC(Number(match[3]), month - 1, Number(match[1]), 12)).toISOString()
  }
  const metaDate = metaValue(html, 'article:published_time') ?? metaValue(html, 'date')
  if (metaDate && Number.isFinite(Date.parse(metaDate))) return new Date(metaDate).toISOString()
  return now.toISOString()
}

function positiveNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function extractListItems(html: string): string[] {
  const matches = html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)
  return Array.from(matches, (match) => htmlToText(match[1]))
    .filter((text) => text.length > 15)
}

function parseMonthlyCountryPurchase(text: string, month: string): number | null {
  const monthMentioned = new RegExp(`\\b(?:in|during|throughout)\\s+${month}\\b|\\bthis\\s+month\\b|\\bthe\\s+month\\b`, 'i').test(text)
  if (!monthMentioned) return null
  const sold = text.match(/\b(?:sold|offloaded|offloading|net sales(?: of)?|sales of)\s+(?:another\s+)?([\d,.]+)\s*t\b/i)
  if (sold) return -Math.abs(positiveNumber(sold[1]) ?? 0)
  const reverseBuy = text.match(/([\d,.]+)\s*t\s+(?:of\s+gold\s+)?(?:was\s+)?(?:purchased|bought|added)\b/i)
  if (reverseBuy) return positiveNumber(reverseBuy[1])
  const buy = text.match(/\b(?:bought|purchased|added|adding|accumulated)\s+(?:a\s+further\s+|another\s+|net\s+)?([\d,.]+)\s*t\b/i)
  return buy ? positiveNumber(buy[1]) : null
}

function parseYtdCountryPurchase(text: string): number | null {
  const ytd = '(?:y\\s*[-–]?\\s*t\\s*[-–]?\\s*d|year[- ]to[- ]date|so far this year)'
  const activity = '(?:net sales|net purchases|net buying|offloaded|offloading|buying|bought|purchased|purchases|purchase|added|adding|accumulated|accumulating|sold|sales)'
  const signedTonnes = (verb: string, amount: string | undefined) => {
    const value = positiveNumber(amount)
    if (value === null) return null
    return /sold|sales|offload/i.test(verb) ? -Math.abs(value) : Math.abs(value)
  }
  const ytdMatches = Array.from(text.matchAll(new RegExp(`\\b${ytd}\\b`, 'gi')))
  for (const ytdMatch of ytdMatches) {
    const index = ytdMatch.index ?? 0
    const before = text.slice(Math.max(0, index - 120), index)
    const after = text.slice(index + ytdMatch[0].length, Math.min(text.length, index + ytdMatch[0].length + 120)).split(/[.;]/, 1)[0]
    const afterActivity = after.match(new RegExp(`\\b(${activity})\\b[^\\d]{0,45}?([\\d,.]+)\\s*t\\b`, 'i'))
    if (afterActivity) return signedTonnes(afterActivity[1], afterActivity[2])
    const beforeActivity = Array.from(before.matchAll(new RegExp(`\\b(${activity})\\b[^\\d]{0,45}?([\\d,.]+)\\s*t\\b`, 'gi'))).at(-1)
    if (beforeActivity) return signedTonnes(beforeActivity[1], beforeActivity[2])
  }
  return null
}

function parseWgcCountryPurchases(html: string, period: string, url: string): ReportedCentralBankPurchase[] {
  const month = MONTHS[Number(period.slice(5, 7)) - 1]
  if (!month) return []
  const items = extractListItems(html)
  const result: ReportedCentralBankPurchase[] = []
  for (const country of WGC_COUNTRIES) {
    const candidates = items
      .filter((item) => country.match.test(item) && /\b(?:bought|purchased|buying|added|sold|offload|sales)\b/i.test(item))
      // Prefer the first mention, normally the report's own country bullet;
      // a later cross-reference to another buyer is context, not that country's flow.
      .sort((a, b) => a.search(country.match) - b.search(country.match) || a.length - b.length)
    const item = candidates[0]
    if (!item) continue
    const monthlyTonnes = parseMonthlyCountryPurchase(item, month)
    const ytdTonnes = parseYtdCountryPurchase(item)
    if (monthlyTonnes === null && ytdTonnes === null) continue
    result.push({
      countryCode: country.countryCode,
      country: country.country,
      monthlyTonnes,
      ytdTonnes,
      period,
      sourceUrl: url,
    })
  }
  return result
}

function staleForPeriod(period: string | null, now: Date, maxAgeDays: number): boolean {
  const age = ageDays(monthEndDate(period), now)
  return age === null || age > maxAgeDays
}

export function parseWgcCentralBankReport(
  html: string,
  url: string,
  now = new Date(),
): CentralBankDemandReport | null {
  if (!html || html.length < 1_000) return null
  const text = htmlToText(html)
  const title = metaValue(html, 'og:title') ?? metaValue(html, 'twitter:title') ?? ''
  if (!/central bank gold statistics|central banks? .*gold|gold .*central banks?/i.test(`${title} ${text.slice(0, 2_500)}`)) return null
  const publishedAt = parsePublicationDate(text, html, now)
  const publishedYear = publishedAt ? new Date(publishedAt).getUTCFullYear() : now.getUTCFullYear()
  const period = parseMonthEndFromText(text) ?? parseTitleMonth(title, publishedYear) ?? parseTitleMonth(text.slice(0, 1_000), publishedYear)
  const totalMatch = text.match(/\breported\s+net\s+buying\b[^.;]{0,100}?(?:totalling|totaling|of|at)?\s*([\d,.]+)\s*t\b/i)
    ?? text.match(/\bnet\s+buying\s+(?:totalling|totaling|of)\s*([\d,.]+)\s*t\b/i)
    ?? text.match(/\bnet\s+purchases?\s+(?:of|totalling|totaling)\s*([\d,.]+)\s*t\b/i)
  const ytdMatch = text.match(/\by\s*[-–]?\s*t\s*[-–]?\s*d\s+basis\b[^.;]{0,150}?([\d,.]+)\s*t\b/i)
    ?? text.match(/\btotal\s+purchases?\s+(?:of\s+)?([\d,.]+)\s*t\b[^.;]{0,60}\by\s*[-–]?\s*t\s*[-–]?\s*d/i)
  const purchases = period ? parseWgcCountryPurchases(html, period, url) : []
  const stale = staleForPeriod(period, now, WGC_CENTRAL_BANK_MAX_AGE_DAYS)
  return {
    provenance: 'reported',
    source: 'World Gold Council · Central Bank Gold Statistics',
    url,
    publishedAt,
    period,
    netPurchasesTonnes: positiveNumber(totalMatch?.[1]),
    ytdPurchasesTonnes: positiveNumber(ytdMatch?.[1]),
    purchases,
    stale,
    note: stale
      ? 'Reported central-bank disclosure is older than 120 days; excluded from the short-horizon demand overlay.'
      : 'Reported monthly purchase data are lagged and may be revised; this is not real-time dealing flow.',
  }
}

function inferFlowPeriod(monthName: string, publishedAt: string | null, now: Date): string | null {
  const month = monthNumber(monthName)
  if (!month) return null
  const published = publishedAt ? new Date(publishedAt) : now
  let year = published.getUTCFullYear()
  if (month > published.getUTCMonth() + 1) year -= 1
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parseWgcEtfFlowReport(html: string, url: string, now = new Date()): GoldEtfFlowReport | null {
  if (!html || html.length < 1_000) return null
  const text = htmlToText(html)
  const title = metaValue(html, 'og:title') ?? metaValue(html, 'twitter:title') ?? ''
  if (!/gold etf|etf.*gold|gold.*etf/i.test(`${title} ${text.slice(0, 1_500)}`)) return null
  const publishedAt = parsePublicationDate(text, html, now)
  const positiveFlow = text.match(/global\s+[^.]{0,220}?gold\s+etfs?[^.]{0,220}?\b(?:attracted|recorded|saw)\s+(?:net\s+)?(?:US\$|\$)?\s*([\d,.]+)\s*(bn|billion|mn|million|m)\s+(?:during\s+|in\s+)(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)
  const negativeFlow = text.match(/global\s+[^.]{0,220}?gold\s+etfs?[^.]{0,220}?\b(?:net\s+)?outflows?\s+(?:of\s+)?(?:US\$|\$)?\s*([\d,.]+)\s*(bn|billion|mn|million|m)\s+(?:during\s+|in\s+)(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)
  const flowMatch = positiveFlow ?? negativeFlow
  const period = flowMatch ? inferFlowPeriod(flowMatch[3], publishedAt, now) : null
  const rawFlow = positiveNumber(flowMatch?.[1])
  const unit = flowMatch?.[2]?.toLowerCase()
  const amountBn = rawFlow === null ? null : unit === 'bn' || unit === 'billion' ? rawFlow : rawFlow / 1_000
  const netFlowUsdBn = amountBn === null ? null : negativeFlow ? -amountBn : amountBn
  const holdingsMatch = text.match(/\b(?:global\s+)?(?:gold\s+)?holdings\s+(rose|increased|grew|fell|declined|decreased)\s+([\d,.]+)\s*t\b/i)
  const holdingsValue = positiveNumber(holdingsMatch?.[2])
  const holdingsChangeTonnes = holdingsValue === null
    ? null
    : /^(?:fell|declined|decreased)$/i.test(holdingsMatch?.[1] ?? '') ? -holdingsValue : holdingsValue
  if (!period || netFlowUsdBn === null) return null
  const stale = staleForPeriod(period, now, WGC_ETF_MAX_AGE_DAYS)
  return {
    provenance: 'reported',
    source: 'World Gold Council · Gold ETF Flows',
    url,
    publishedAt,
    period,
    netFlowUsdBn,
    holdingsChangeTonnes,
    stale,
    note: stale
      ? 'Latest parsed monthly ETF-flow report is older than 62 days; excluded from the short-horizon demand overlay.'
      : 'Monthly global physically-backed ETF flow; reported with a lag and not a daily order-flow measure.',
  }
}

function monthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function recentMonths(now: Date, count: number): Array<{ year: number; month: number; period: string }> {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(current)
    date.setUTCMonth(date.getUTCMonth() - index)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    return { year, month, period: monthString(year, month) }
  })
}

async function fetchSource(url: string, accept: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'AurumNepal/1.0 (public central-bank and ETF data tracker)',
        Accept: accept,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

function imfCsvUrl(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  start.setUTCMonth(start.getUTCMonth() - 11)
  const codes = Object.keys(COUNTRY_NAMES).join('+')
  const series = `${codes}.IRFCLDT1_IRFCL56V_FTO..M`
  const params = new URLSearchParams({
    startPeriod: monthString(start.getUTCFullYear(), start.getUTCMonth() + 1),
    endPeriod: monthString(now.getUTCFullYear(), now.getUTCMonth() + 1),
    format: 'csv',
  })
  return `${IMF_GOLD_SERIES_URL}/${series}?${params}`
}

function archiveArticleUrl(html: string, archiveBase: string, mode: 'central' | 'etf'): string | null {
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)
  for (const match of anchors) {
    const href = getAttribute(match[1], 'href')
    const label = htmlToText(match[2])
    const matchingLabel = mode === 'central'
      ? /central bank gold statistics/i.test(label)
      : /gold etf flows|gold etfs? holdings and flows/i.test(label)
    if (!href || !matchingLabel || href.startsWith('#') || href.startsWith('mailto:')) continue
    try {
      return new URL(href, archiveBase).toString()
    } catch {
      continue
    }
  }
  return null
}

async function fetchLatestCentralBankReport(now: Date): Promise<CentralBankDemandReport> {
  const fallback: CentralBankDemandReport = {
    provenance: 'unavailable',
    source: 'World Gold Council · Central Bank Gold Statistics',
    url: null,
    publishedAt: null,
    period: null,
    netPurchasesTonnes: null,
    ytdPurchasesTonnes: null,
    purchases: [],
    stale: true,
    note: 'No parsable public WGC monthly central-bank report was received; no simulated value is substituted.',
  }
  const archives = recentMonths(now, 3).map(({ year, month }) => `${WGC_CENTRAL_BANK_ARCHIVE_URL}/${year}/${month}`)
  const pages = await Promise.all(archives.map((url) => fetchSource(url, 'text/html,application/xhtml+xml')))
  const candidates = pages.flatMap((html, index) => html
    ? [archiveArticleUrl(html, archives[index], 'central')]
    : []).filter((url): url is string => url !== null)
  for (const url of candidates) {
    const html = await fetchSource(url, 'text/html,application/xhtml+xml')
    if (!html) continue
    const parsed = parseWgcCentralBankReport(html, url, now)
    if (parsed) return parsed
  }
  return fallback
}

async function fetchLatestEtfReport(now: Date): Promise<GoldEtfFlowReport> {
  const fallback: GoldEtfFlowReport = {
    provenance: 'unavailable',
    source: 'World Gold Council · Gold ETF Flows',
    url: null,
    publishedAt: null,
    period: null,
    netFlowUsdBn: null,
    holdingsChangeTonnes: null,
    stale: true,
    note: 'No parsable public WGC monthly ETF-flow report was received; no simulated value is substituted.',
  }
  const urls = recentMonths(now, 3).map(({ year, month }) => `${WGC_ETF_ARCHIVE_URL}/${year}/${month}`)
  const pages = await Promise.all(urls.map(async (url) => ({ url, html: await fetchSource(url, 'text/html,application/xhtml+xml') })))
  const parsed = pages
    .map(({ url, html }) => html ? parseWgcEtfFlowReport(html, url, now) : null)
    .filter((report): report is GoldEtfFlowReport => report !== null)
    .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''))
  return parsed[0] ?? fallback
}

export function unavailableInstitutionalDemandSnapshot(now = new Date()): InstitutionalDemandSnapshot {
  return {
    generatedAt: now.toISOString(),
    status: 'unavailable',
    centralBank: {
      provenance: 'unavailable', source: 'World Gold Council · Central Bank Gold Statistics', url: null,
      publishedAt: null, period: null, netPurchasesTonnes: null, ytdPurchasesTonnes: null,
      purchases: [], stale: true, note: 'No parsable public WGC monthly central-bank report was received; no simulated value is substituted.',
    },
    goldEtf: {
      provenance: 'unavailable', source: 'World Gold Council · Gold ETF Flows', url: null,
      publishedAt: null, period: null, netFlowUsdBn: null, holdingsChangeTonnes: null,
      stale: true, note: 'No parsable public WGC monthly ETF-flow report was received; no simulated value is substituted.',
    },
    goldReserves: [],
    note: 'Reported sources are unavailable. Values are withheld rather than simulated.',
  }
}

async function collectInstitutionalDemand(now: Date): Promise<InstitutionalDemandSnapshot> {
  const [csv, centralBank, goldEtf] = await Promise.all([
    fetchSource(imfCsvUrl(now), 'text/csv,application/csv,text/plain,*/*'),
    fetchLatestCentralBankReport(now),
    fetchLatestEtfReport(now),
  ])
  const goldReserves = csv ? parseImfGoldReserves(csv, now) : []
  const availableSources = Number(centralBank.provenance === 'reported') +
    Number(goldEtf.provenance === 'reported') + Number(goldReserves.some((reserve) => reserve.tonnes !== null))
  const status: InstitutionalDemandSnapshot['status'] = availableSources === 0
    ? 'unavailable'
    : availableSources === 3 ? 'reported' : 'partial'
  return {
    generatedAt: now.toISOString(),
    status,
    centralBank,
    goldEtf,
    goldReserves,
    note: 'All figures are reported observations, not real-time trades. IMF reserve series are monthly, may be revised, and are screened for implausible scale jumps; no simulated metrics are used.',
  }
}

export async function getInstitutionalDemand(): Promise<InstitutionalDemandSnapshot> {
  const now = Date.now()
  if (globalCache.__aurumInstitutionalDemandCache && globalCache.__aurumInstitutionalDemandCache.expiresAt > now) {
    return globalCache.__aurumInstitutionalDemandCache.value
  }
  if (globalCache.__aurumInstitutionalDemandPromise) return globalCache.__aurumInstitutionalDemandPromise
  const work = collectInstitutionalDemand(new Date())
  globalCache.__aurumInstitutionalDemandPromise = work
  try {
    const value = await work
    globalCache.__aurumInstitutionalDemandCache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
    return value
  } catch {
    const value = unavailableInstitutionalDemandSnapshot()
    globalCache.__aurumInstitutionalDemandCache = { value, expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 60_000) }
    return value
  } finally {
    globalCache.__aurumInstitutionalDemandPromise = undefined
  }
}
