import { load } from 'cheerio'
import { calculateSeasonalDemandIndex } from '@/engine/seasonality'
import type { CotPositioning, FedWatchProbability, GoldEtfHolding, MacroCalendarEvent, MetricQuote, Stage2Feed, Stage2Snapshot } from './types'

const COT_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=cftc_contract_market_code%3D%27088691%27&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=157'
const FED_CALENDAR_URL = 'https://www.federalreserve.gov/json/calendar.json'
const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics'
const SPDR_GLD_URL = 'https://www.spdrgoldshares.com/usa/gld/'
const ISHARES_IAU_URL = 'https://www.ishares.com/us/products/239561/ishares-gold-trust-fund'
const MCX_SYMBOL = process.env.AURUM_MCX_SYMBOL?.trim() || 'GOLD.MCX'
const MCX_URL = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(MCX_SYMBOL)}?range=5d&interval=1d`
const MAX_RETRIES = 2
const TIMEOUT_MS = 7000
interface CacheEntry<T> { expiresAt: number; data: T; asOf: string | null; checkedAt: string }
const cacheGlobal = globalThis as typeof globalThis & { __aurumStage2Feeds?: Map<string, CacheEntry<unknown>> }
const cache = cacheGlobal.__aurumStage2Feeds ?? (cacheGlobal.__aurumStage2Feeds = new Map())

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
}
function ageDays(value: string | null, now = new Date()): number | null {
  const date = dateOnly(value)
  return date ? Math.max(0, Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)) : null
}
function ageStatus(asOf: string | null, maxAgeDays: number, now = new Date()): 'fresh' | 'stale' {
  const age = ageDays(asOf, now)
  return age !== null && age <= maxAgeDays ? 'fresh' : 'stale'
}
async function requestText(url: string, accept = '*/*', extraHeaders: Record<string, string> = {}): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'AurumNepal/2.0 (+market research dashboard)', Accept: accept, ...extraHeaders }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (response.ok) return await response.text()
    } catch { /* retry */ }
    if (attempt + 1 < MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
  }
  return null
}
async function requestJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  const text = await requestText(url, 'application/json, text/plain, */*', headers)
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}
function makeFeed<T>(data: T | null, status: Stage2Feed<T>['status'], source: string, url: string | null, asOf: string | null, checkedAt: string, note: string): Stage2Feed<T> {
  return { data, status, source, url, asOf, checkedAt, note }
}
async function cachedFeed<T>(key: string, ttlMs: number, source: string, url: string, maxAgeDays: number, fetcher: () => Promise<{ data: T; asOf: string | null; note?: string } | null>, unavailableNote: string): Promise<Stage2Feed<T>> {
  const now = new Date(); const checkedAt = now.toISOString(); const saved = cache.get(key) as CacheEntry<T> | undefined
  if (saved && saved.expiresAt > now.getTime()) {
    const state = ageStatus(saved.asOf, maxAgeDays, now)
    return makeFeed(saved.data, state, source, url, saved.asOf, saved.checkedAt, state === 'stale' ? 'Cached observation is outside its freshness window.' : 'Cached source observation.')
  }
  try {
    const result = await fetcher()
    if (result && result.data !== null && result.data !== undefined) {
      const entry = { data: result.data, asOf: result.asOf, checkedAt, expiresAt: now.getTime() + ttlMs }
      cache.set(key, entry)
      const state = ageStatus(result.asOf, maxAgeDays, now)
      return makeFeed(result.data, state, source, url, result.asOf, checkedAt, result.note ?? (state === 'stale' ? 'Source observation is outside its freshness window.' : 'Source observation received.'))
    }
  } catch { /* preserve last-good value */ }
  if (saved) {
    const fallback = { ...saved, expiresAt: now.getTime() + Math.min(ttlMs, 60_000) }
    cache.set(key, fallback)
    return makeFeed(saved.data, 'stale', source, url, saved.asOf, saved.checkedAt, 'Source request failed after retry; last-good value shown stale.')
  }
  return makeFeed<T>(null, 'unavailable', source, url, null, checkedAt, unavailableNote)
}
function numeric(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN
  return Number.isFinite(number) ? number : null
}

async function fetchCot(): Promise<{ data: CotPositioning; asOf: string; note: string } | null> {
  const payload = await requestJson(COT_URL); const rows = Array.isArray(payload) ? payload : []; const row = rows[0]
  if (!row) return null
  const reportDate = dateOnly(row.report_date_as_yyyy_mm_dd)
  const longs = numeric(row.m_money_positions_long_all); const shorts = numeric(row.m_money_positions_short_all); const oi = numeric(row.open_interest_all)
  if (!reportDate || longs === null || shorts === null || oi === null || oi <= 0) return null
  const net = longs - shorts; const previous = rows[1]
  const previousLong = numeric(previous?.m_money_positions_long_all); const previousShort = numeric(previous?.m_money_positions_short_all)
  const priorNet = previousLong === null || previousShort === null ? null : previousLong - previousShort
  const history = rows.slice(1).map((item: any) => {
    const l = numeric(item.m_money_positions_long_all); const s = numeric(item.m_money_positions_short_all)
    return l === null || s === null ? null : l - s
  }).filter((value: number | null): value is number => value !== null)
  const percentile = history.length >= 20 ? Math.round(history.filter((value: number) => value < net).length / history.length * 1000) / 10 : null
  return { data: { reportDate, managedMoneyNet: net, managedMoneyNetChange: priorNet === null ? null : net - priorNet, openInterest: oi, percentile }, asOf: reportDate, note: 'CFTC disaggregated futures-only Gold (COMEX 088691); weekly positions are reported with a lag.' }
}
function parseIssuerDate(text: string): string | null {
  const match = text.match(/(?:as of|asof)\s*([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i)
  if (!match) return null
  const parsed = new Date(match[1]); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}
function extractTonnes(html: string, ticker: 'GLD' | 'IAU'): { tonnes: number; asOf: string } | null {
  const $ = load(html); const body = $('body').text().replace(/\s+/g, ' ').trim(); let tonnes: number | null = null; let asOf: string | null = null
  if (ticker === 'IAU') {
    const match = body.match(/Tonnes\s+in\s*Trust\s+([\d,]+(?:\.\d+)?)\s+as\s*of\s+([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i)
    tonnes = match ? numeric(match[1]) : null
    if (match) { const parsed = new Date(match[2]); asOf = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10) }
  } else {
    const label = $('span').filter((_, element) => $(element).text().trim().toLowerCase() === 'tonnes').first()
    const block = label.closest('[class*="MetricValue_metricValue"]')
    const match = block.text().replace(/\s+/g, ' ').match(/Tonnes\s+([\d,]+(?:\.\d+)?)/i)
    tonnes = match ? numeric(match[1]) : null
    asOf = parseIssuerDate(body)
  }
  return tonnes !== null && tonnes > 0 && asOf ? { tonnes, asOf } : null
}
async function fetchEtf(ticker: 'GLD' | 'IAU'): Promise<{ data: Omit<GoldEtfHolding, 'dailyChangeTonnes'>; asOf: string } | null> {
  const url = ticker === 'GLD' ? SPDR_GLD_URL : ISHARES_IAU_URL
  const html = await requestText(url, 'text/html,application/xhtml+xml,*/*')
  if (!html) return null
  const value = extractTonnes(html, ticker)
  return value ? { data: { ticker, holdingsTonnes: value.tonnes, asOf: value.asOf }, asOf: value.asOf } : null
}
async function etfFeed(ticker: 'GLD' | 'IAU'): Promise<Stage2Feed<GoldEtfHolding>> {
  const key = `etf-${ticker}`; const url = ticker === 'GLD' ? SPDR_GLD_URL : ISHARES_IAU_URL
  const source = ticker === 'GLD' ? 'SPDR issuer holdings page' : 'iShares issuer holdings page'
  const now = new Date(); const saved = cache.get(key) as CacheEntry<GoldEtfHolding> | undefined
  if (saved && saved.expiresAt > now.getTime()) return makeFeed(saved.data, ageStatus(saved.asOf, 3, now), source, url, saved.asOf, saved.checkedAt, 'Cached issuer-reported holdings.')
  const fetched = await fetchEtf(ticker)
  if (fetched) {
    const changedDate = saved !== undefined && saved.asOf !== fetched.asOf
    const data: GoldEtfHolding = { ...fetched.data, dailyChangeTonnes: changedDate ? fetched.data.holdingsTonnes - saved.data.holdingsTonnes : null }
    const entry = { data, asOf: fetched.asOf, checkedAt: now.toISOString(), expiresAt: now.getTime() + 6 * 60 * 60 * 1000 }; cache.set(key, entry)
    const state = ageStatus(fetched.asOf, 3, now)
    return makeFeed(data, state, source, url, fetched.asOf, entry.checkedAt, changedDate ? 'Daily holdings change uses two distinct issuer report dates.' : 'No distinct prior report date in process cache; daily flow is not inferred.')
  }
  if (saved) { cache.set(key, { ...saved, expiresAt: now.getTime() + 60_000 }); return makeFeed(saved.data, 'stale', source, url, saved.asOf, saved.checkedAt, 'Issuer request failed after retry; last-good value retained as stale.') }
  return makeFeed<GoldEtfHolding>(null, 'unavailable', source, url, null, now.toISOString(), 'Issuer page unavailable or did not contain a current parseable tonnes figure; no substitute used.')
}
async function fetchIndiaGold(): Promise<{ data: MetricQuote; asOf: string } | null> {
  const payload = await requestJson(MCX_URL); const result = payload?.chart?.result?.[0]
  const timestamps: number[] = result?.timestamp ?? []; const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? []
  const values = timestamps.map((timestamp, i) => ({ timestamp, value: numeric(closes[i]) })).filter((item): item is { timestamp: number; value: number } => item.value !== null && item.value > 0)
  const last = values.at(-1); const previous = values.at(-2); if (!last) return null
  const asOf = new Date(last.timestamp * 1000).toISOString(); const change = previous ? last.value - previous.value : null
  return { data: { value: last.value, previous: previous?.value ?? null, change, changePct: previous ? change! / previous.value * 100 : null, unit: 'provider quote units', source: `Yahoo Finance · ${MCX_SYMBOL} (MCX symbol proxy)`, asOf, stale: (ageDays(asOf) ?? 99) > 3, note: 'MCX symbol proxy; quote basis is provider-reported and is not normalized to 10g without contract metadata.' }, asOf }
}
function indiaDuty(): Stage2Feed<{ percentage: number; asOf: string }> {
  const checkedAt = new Date().toISOString(); const percentage = Number(process.env.AURUM_INDIA_IMPORT_DUTY_PCT); const asOf = process.env.AURUM_INDIA_IMPORT_DUTY_AS_OF?.trim() || ''
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return makeFeed<{ percentage: number; asOf: string }>(null, 'unavailable', 'Unavailable · optional manual CBIC reference', process.env.AURUM_INDIA_IMPORT_DUTY_SOURCE_URL?.trim() || null, null, checkedAt, 'Set AURUM_INDIA_IMPORT_DUTY_PCT and AURUM_INDIA_IMPORT_DUTY_AS_OF after verifying an official CBIC notice; no duty value is assumed.')
  return makeFeed({ percentage, asOf }, 'manual', 'User-configured · CBIC source must be verified', process.env.AURUM_INDIA_IMPORT_DUTY_SOURCE_URL?.trim() || null, asOf, checkedAt, 'Manual reference only; not fetched live and not used as a verified change signal.')
}
function utcFromEastern(year: number, month: number, day: number, hour: number, minute: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day, 12)); const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe)
  const text = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-5'; const match = text.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  const sign = match?.[1] === '-' ? -1 : 1; const offset = match ? sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : -300
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000).toISOString()
}
function parseIcsStart(lines: string[]): { iso: string; dateOnly: boolean } | null {
  const line = lines.find((item) => item.startsWith('DTSTART')); const match = line?.match(/DTSTART(?:;TZID=([^:;]+))?(?:;VALUE=DATE)?:([0-9TZ]+)/)
  if (!match) return null
  const value = match[2]; const y = Number(value.slice(0, 4)); const m = Number(value.slice(4, 6)); const d = Number(value.slice(6, 8))
  if (![y, m, d].every(Number.isFinite)) return null
  if (value.length < 13) return { iso: new Date(Date.UTC(y, m - 1, d)).toISOString(), dateOnly: true }
  const h = Number(value.slice(9, 11)); const min = Number(value.slice(11, 13)); const zone = match[1] ?? 'America/New_York'
  const iso = value.endsWith('Z') ? new Date(Date.UTC(y, m - 1, d, h, min)).toISOString() : zone === 'America/New_York' || zone === 'US/Eastern' ? utcFromEastern(y, m, d, h, min) : new Date(Date.UTC(y, m - 1, d, h, min)).toISOString()
  return { iso, dateOnly: false }
}
function parseBls(ics: string): MacroCalendarEvent[] {
  const blocks = ics.replace(/\r\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1); const events: MacroCalendarEvent[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/); const title = lines.find((line) => line.startsWith('SUMMARY:'))?.slice(8).replace(/\\,/g, ',').trim() ?? ''
    const kind: MacroCalendarEvent['kind'] | null = /consumer price index|\bCPI\b/i.test(title) ? 'CPI' : /employment situation|nonfarm|\bNFP\b/i.test(title) ? 'NFP' : null
    const start = parseIcsStart(lines); if (!kind || !start) continue
    const date = start.iso.slice(0, 10)
    events.push({ id: `bls-${kind}-${date}`, kind, title, startsAt: start.iso, timeZone: start.dateOnly ? null : 'America/New_York', timePrecision: start.dateOnly ? 'date-only' : 'exact', source: 'U.S. Bureau of Labor Statistics', sourceUrl: BLS_ICS_URL, highImpact: true })
  }
  return events
}
function parseFedCalendar(payload: any): MacroCalendarEvent[] {
  const events: MacroCalendarEvent[] = []; const rows = Array.isArray(payload?.events) ? payload.events : []
  for (const row of rows) {
    const month = String(row?.month ?? '').match(/^(\d{4})-(\d{2})$/); const dayText = String(row?.days ?? '').match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/); const title = String(row?.title ?? '').trim(); const type = String(row?.type ?? '')
    if (!month || !dayText || !title) continue
    const kind: MacroCalendarEvent['kind'] | null = /fomc/i.test(type) || /fomc/i.test(title) ? 'FOMC' : /speech|testimony/i.test(type) ? 'Fed speech' : null
    if (!kind) continue
    const y = Number(month[1]); const m = Number(month[2]); const d = Number(kind === 'FOMC' ? dayText[2] ?? dayText[1] : dayText[1])
    const time = String(row?.time ?? '').match(/(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/i)
    const hour = time ? Number(time[1]) % 12 + (/p\.m\./i.test(time[3]) ? 12 : 0) : 0; const minute = time ? Number(time[2]) : 0
    const startsAt = time ? utcFromEastern(y, m, d, hour, minute) : new Date(Date.UTC(y, m - 1, d)).toISOString(); const date = startsAt.slice(0, 10)
    const url = typeof row?.link === 'string' && row.link.startsWith('http') ? row.link : 'https://www.federalreserve.gov/newsevents/calendar.htm'
    events.push({ id: `fed-${kind}-${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, kind, title, startsAt, timeZone: time ? 'America/New_York' : null, timePrecision: time ? 'exact' : 'date-only', source: 'Federal Reserve Board', sourceUrl: url, highImpact: kind === 'FOMC' || (kind === 'Fed speech' && /chair|powell|monetary policy|testimony|press conference/i.test(title)) })
  }
  return events
}
async function fetchEventCalendar(): Promise<{ data: MacroCalendarEvent[]; asOf: string; note: string } | null> {
  const [fed, bls] = await Promise.all([requestJson(FED_CALENDAR_URL, { Referer: 'https://www.federalreserve.gov/newsevents/calendar.htm' }), requestText(BLS_ICS_URL, 'text/calendar,text/plain,*/*')])
  if (!fed && !bls) return null
  const all = [...(fed ? parseFedCalendar(fed) : []), ...(bls ? parseBls(bls) : [])]; const now = Date.now()
  const todayNpt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  const upcoming = all.filter((event) => (event.timePrecision === 'date-only' ? event.startsAt.slice(0, 10) >= todayNpt : Date.parse(event.startsAt) >= now - 60 * 60_000) && Date.parse(event.startsAt) <= now + 45 * 86_400_000)
  const unique = new Map(upcoming.map((event) => [event.id, event]))
  return { data: [...unique.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), asOf: new Date().toISOString(), note: `${fed ? 'Federal Reserve official calendar' : 'Fed calendar unavailable'}${bls ? ' + BLS official release calendar' : ' · BLS calendar unavailable'}.` }
}
async function currentFedTargetBps(): Promise<{ lower: number; upper: number } | null> {
  const [lowerText, upperText] = await Promise.all([
    requestText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL', 'text/csv,*/*'),
    requestText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU', 'text/csv,*/*'),
  ])
  const latest = (text: string | null) => {
    if (!text) return null
    const rows = text.trim().split(/\r?\n/).slice(1).reverse()
    for (const row of rows) { const value = numeric(row.split(',')[1]?.replaceAll('"', '')); if (value !== null) return value * 100 }
    return null
  }
  const lower = latest(lowerText); const upper = latest(upperText)
  return lower !== null && upper !== null ? { lower, upper } : null
}

async function fetchFedWatch(): Promise<{ data: FedWatchProbability; asOf: string; note: string } | null> {
  const token = process.env.CME_FEDWATCH_BEARER_TOKEN?.trim(); if (!token) return null
  const base = (process.env.CME_FEDWATCH_BASE_URL?.trim() || 'https://markets.api.cmegroup.com/fedwatch/v1').replace(/\/$/, '')
  const payload = await requestJson(`${base}/forecasts`, {
    Authorization: `Bearer ${token}`, 'CME-Application-Name': process.env.CME_APPLICATION_NAME?.trim() || 'Aurum Nepal',
    'CME-Application-Vendor': process.env.CME_APPLICATION_VENDOR?.trim() || 'Aurum', 'CME-Application-Version': process.env.npm_package_version || '2.0',
    'CME-Request-ID': `aurum-${Date.now()}`,
  })
  if (!payload) return null
  const row = Array.isArray(payload) ? payload[0] : payload?.forecasts?.[0] ?? payload
  const ranges = Array.isArray(row?.rateRange) ? row.rateRange : Array.isArray(row?.rateRanges) ? row.rateRanges : []
  const rateRanges = ranges.map((item: any) => ({ lowerBps: numeric(item?.lowerRt), upperBps: numeric(item?.upperRt), probabilityPct: numeric(item?.probability) }))
    .filter((item: any) => item.lowerBps !== null && item.upperBps !== null && item.probabilityPct !== null)
  if (!rateRanges.length) return null
  const meetingDate = dateOnly(row?.meetingDt ?? row?.meetingDate); const reportingDate = dateOnly(row?.reportingDt ?? row?.reportingDate)
  const target = await currentFedTargetBps()
  let easePct = numeric(row?.easePct ?? row?.probEase ?? row?.currentProbabilities?.ease)
  let hikePct = numeric(row?.hikePct ?? row?.probHike ?? row?.currentProbabilities?.hike)
  let noChangePct = numeric(row?.noChangePct ?? row?.probNoChange ?? row?.currentProbabilities?.no_change)
  let expectedRateBps: number | null = null
  if (target && rateRanges.length) {
    let ease = 0; let hike = 0; let same = 0; let expected = 0; let probabilitySum = 0
    for (const item of rateRanges) {
      const midpoint = (item.lowerBps + item.upperBps) / 2
      expected += midpoint * item.probabilityPct; probabilitySum += item.probabilityPct
      if (item.upperBps <= target.lower) ease += item.probabilityPct
      else if (item.lowerBps >= target.upper) hike += item.probabilityPct
      else same += item.probabilityPct
    }
    if (probabilitySum > 0) expectedRateBps = expected / probabilitySum
    easePct = ease; hikePct = hike; noChangePct = same
  }
  return { data: { meetingDate, reportingDate, easePct, noChangePct, hikePct, currentTargetLowerBps: target?.lower ?? null, currentTargetUpperBps: target?.upper ?? null, expectedRateBps, rateRanges }, asOf: reportingDate ?? new Date().toISOString(), note: 'CME FedWatch distribution derived from 30-Day Fed Funds futures; ease/no-change/hike grouped against the latest Fed target range where available.' }
}

export function unavailableStage2Snapshot(note = 'Stage 2 feed collector failed; upstream values are unavailable.'): Stage2Snapshot {
  const now = new Date().toISOString(); const unavailable = <T,>(source: string): Stage2Feed<T> => makeFeed<T>(null, 'unavailable', source, null, null, now, note)
  return { generatedAt: now, fedWatch: unavailable('CME FedWatch'), cot: unavailable('CFTC COT'), etfs: { gld: unavailable('SPDR GLD'), iau: unavailable('iShares IAU') }, indiaGold: unavailable('MCX proxy'), indiaImportDuty: unavailable('Manual CBIC reference'), nprInr: unavailable('USD/NPR ÷ USD/INR'), silverCorrelation: unavailable('Silver correlation'), silverHistory: unavailable('Optional silver history'), seasonality: calculateSeasonalDemandIndex(), eventCalendar: unavailable('Federal Reserve + BLS calendar') }
}

export async function collectStage2Data(): Promise<Stage2Snapshot> {
  const checkedAt = new Date().toISOString(); const enabled = process.env.AURUM_ENABLE_SILVER_CORRELATION?.trim().toLowerCase() === 'true'
  const [fedWatch, cot, gld, iau, indiaGold, eventCalendar, silverHistory] = await Promise.all([
    cachedFeed('fedwatch', 15 * 60_000, 'CME FedWatch API', `${process.env.CME_FEDWATCH_BASE_URL?.trim() || 'https://markets.api.cmegroup.com/fedwatch/v1'}/forecasts`, 2, fetchFedWatch, process.env.CME_FEDWATCH_BEARER_TOKEN ? 'CME API returned no parseable probability distribution.' : 'Configure an entitled CME bearer token; the ZQ futures proxy is not presented as meeting probabilities.'),
    cachedFeed('cot-gold', 6 * 60 * 60_000, 'CFTC COT · Disaggregated futures-only', COT_URL, 14, fetchCot, 'CFTC gold positioning unavailable after retry; no value inferred.'),
    etfFeed('GLD'), etfFeed('IAU'),
    cachedFeed('india-mcx', 15 * 60_000, `Yahoo Finance · ${MCX_SYMBOL} (MCX symbol proxy)`, MCX_URL, 3, fetchIndiaGold, 'MCX gold quote unavailable; no contract unit inferred.'),
    cachedFeed('macro-calendar', 15 * 60_000, 'Federal Reserve + BLS official calendars', `${FED_CALENDAR_URL} · ${BLS_ICS_URL}`, 2, fetchEventCalendar, 'Official event calendars unavailable; no dates invented.'),
    enabled ? cachedFeed('silver-history', 6 * 60 * 60_000, 'Yahoo Finance · SI=F', 'https://query1.finance.yahoo.com/v8/finance/chart/SI=F?range=3mo&interval=1d', 3, async () => {
      const payload = await requestJson('https://query1.finance.yahoo.com/v8/finance/chart/SI=F?range=3mo&interval=1d'); const result = payload?.chart?.result?.[0]; const times: number[] = result?.timestamp ?? []; const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? []
      const data = times.map((time, i) => ({ date: new Date(time * 1000).toISOString().slice(0, 10), value: numeric(closes[i]) ?? 0 })).filter((item) => item.value > 0)
      return data.length ? { data, asOf: data.at(-1)!.date, note: 'Yahoo SI=F futures; optional silver-correlation proxy.' } : null
    }, 'Optional silver history unavailable after retry.') : Promise.resolve(makeFeed<Array<{ date: string; value: number }>>(null, 'unavailable', 'Disabled · optional Yahoo Finance SI=F', null, null, checkedAt, 'Set AURUM_ENABLE_SILVER_CORRELATION=true to enable.')),
  ])
  const dutyRaw = Number(process.env.AURUM_INDIA_IMPORT_DUTY_PCT); const dutyDate = process.env.AURUM_INDIA_IMPORT_DUTY_AS_OF?.trim() || ''
  const indiaImportDuty = Number.isFinite(dutyRaw) && dutyRaw >= 0 && dutyRaw <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(dutyDate)
    ? makeFeed({ percentage: dutyRaw, asOf: dutyDate }, 'manual', 'User-configured · CBIC reference', process.env.AURUM_INDIA_IMPORT_DUTY_SOURCE_URL?.trim() || null, dutyDate, checkedAt, 'Manual reference, not live; verify CBIC source and do not treat as a verified change signal.')
    : makeFeed<{ percentage: number; asOf: string }>(null, 'unavailable', 'Unavailable · optional manual CBIC reference', process.env.AURUM_INDIA_IMPORT_DUTY_SOURCE_URL?.trim() || null, null, checkedAt, 'Set AURUM_INDIA_IMPORT_DUTY_PCT and AURUM_INDIA_IMPORT_DUTY_AS_OF after verifying the official CBIC notice; no rate is assumed.')
  return { generatedAt: checkedAt, fedWatch, cot, etfs: { gld, iau }, indiaGold, indiaImportDuty, nprInr: makeFeed<MetricQuote>(null, 'unavailable', 'Derived from fresh USD/NPR and USD/INR', null, null, checkedAt, 'Awaiting aligned observations.'), silverCorrelation: makeFeed<{ correlation: number; observations: number }>(null, silverHistory.status === 'stale' ? 'stale' : 'unavailable', 'Yahoo Finance · SI=F correlation proxy', silverHistory.url, silverHistory.asOf, silverHistory.checkedAt, silverHistory.note), silverHistory, seasonality: calculateSeasonalDemandIndex(new Date(checkedAt)), eventCalendar }
}

export function deriveNprInrCross(usdNpr: MetricQuote, usdInr: MetricQuote, checkedAt = new Date().toISOString()): Stage2Feed<MetricQuote> {
  if (usdNpr.value === null || usdInr.value === null || usdNpr.stale || usdInr.stale || usdInr.value <= 0) return makeFeed<MetricQuote>(null, 'unavailable', 'Cross-rate proxy · USD/NPR ÷ USD/INR', null, null, checkedAt, 'Requires fresh USD/NPR and USD/INR; fixed peg is not assumed.')
  const value = usdNpr.value / usdInr.value; const changes = [usdNpr.changePct, usdInr.changePct]
  const changePct = changes.every((x) => x !== null && Number.isFinite(x)) ? (changes[0] as number) - (changes[1] as number) : null
  const asOf = usdNpr.asOf && usdInr.asOf ? (Date.parse(usdNpr.asOf) < Date.parse(usdInr.asOf) ? usdNpr.asOf : usdInr.asOf) : usdNpr.asOf ?? usdInr.asOf
  const metric: MetricQuote = { value, previous: null, change: changePct === null ? null : value * changePct / 100, changePct, unit: 'NPR per INR', source: 'Derived cross-rate · USD/NPR ÷ USD/INR', asOf, stale: false, note: 'Observed cross-rate, not an assumption that the historical peg is unchanged.' }
  return makeFeed(metric, 'fresh', metric.source, null, asOf, checkedAt, metric.note!)
}
export function correlateReturns(a: Array<{ date: string; value: number }>, b: Array<{ date: string; value: number }>): { correlation: number; observations: number } | null {
  const aa = new Map(a.map((item) => [item.date, item.value])); const bb = new Map(b.map((item) => [item.date, item.value])); const dates = [...aa.keys()].filter((date) => bb.has(date)).sort(); const values: Array<[number, number]> = []
  for (let i = 1; i < dates.length; i += 1) { const a0 = aa.get(dates[i - 1])!; const b0 = bb.get(dates[i - 1])!; const a1 = aa.get(dates[i])!; const b1 = bb.get(dates[i])!; if (a0 > 0 && b0 > 0 && a1 > 0 && b1 > 0) values.push([a1 / a0 - 1, b1 / b0 - 1]) }
  if (values.length < 20) return null
  const ma = values.reduce((sum, x) => sum + x[0], 0) / values.length; const mb = values.reduce((sum, x) => sum + x[1], 0) / values.length
  const cov = values.reduce((sum, x) => sum + (x[0] - ma) * (x[1] - mb), 0); const va = values.reduce((sum, x) => sum + (x[0] - ma) ** 2, 0); const vb = values.reduce((sum, x) => sum + (x[1] - mb) ** 2, 0)
  return va > 0 && vb > 0 ? { correlation: cov / Math.sqrt(va * vb), observations: values.length } : null
}
