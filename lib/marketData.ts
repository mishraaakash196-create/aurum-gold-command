import { XMLParser } from 'fast-xml-parser'
import { RELIABILITY_THRESHOLDS, isGoldMarketOpen } from '@/engine/reliability'
import { calculateRollingImpliedSpread, calculateTechnicalIndicators } from './goldEngine'
import { scoreHeadline } from './sentiment'
import { getInstitutionalDemand, unavailableInstitutionalDemandSnapshot } from './institutionalData'
import { collectStage2Data, correlateReturns, deriveNprInrCross, unavailableStage2Snapshot } from './stage2Data'
import { getManualOfficialRates, recordOfficialRateHistory } from '@/data/jsonStore'
import type {
  LocalRatePoint,
  MarketHeadline,
  MarketSnapshot,
  MetricQuote,
  OhlcCandle,
} from './types'

const XAU_SPOT_URL = 'https://xaus.com/api/v1/spot?compact=1'
const XAU_CHART_URL = 'https://xaus.com/api/v1/chart?symbol=xau&range=1y&interval=1d'
const FENEGOSIDA_API = 'https://api.fenegosida.org/api/website/v1/Dashboard'
const NRB_API = 'https://www.nrb.org.np/api/forex/v1/rates'
const NRB_MIRROR_URL = 'https://cdn.jsdelivr.net/gh/AllRates-Today/central-bank-exchange-rates@main/data/nrb/latest.json'
const NEWS_QUERIES = [
  'gold (war OR conflict OR geopolitical OR Federal Reserve OR real yields OR central bank) when:2d',
  '(war OR armed conflict OR missile OR blockade OR escalation OR "Middle East" OR Ukraine OR Taiwan OR Iran) when:2d',
  '(earthquake OR cyclone OR hurricane OR typhoon OR flood OR tsunami OR volcano OR wildfire OR landslide OR drought OR "natural disaster") when:2d',
]
const NEWS_URLS = NEWS_QUERIES.map((query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
)

const USER_AGENT = 'AurumNepal/1.0 (market-data dashboard; contact: operator)'
const REQUEST_TIMEOUT_MS = 6500
const CACHE_TTL_MS = 60_000

interface YahooHistory {
  metric: MetricQuote
  history: Array<{ date: string; value: number }>
}

interface NrbResult {
  buy: number | null
  sell: number | null
  date: string | null
  source: string
  stale: boolean
}

interface LocalTodayResult {
  rate24kTola: number | null
  rate24k10g: number | null
  previous24kTola: number | null
  previous24k10g: number | null
  rateTejabiTola: number | null
  rateTejabi10g: number | null
  rateDate: string | null
  asOf: string | null
  history: LocalRatePoint[]
}

interface CacheState {
  expiresAt: number
  value: MarketSnapshot
}

const globalMarketCache = globalThis as typeof globalThis & {
  __aurumMarketCache?: CacheState
  __aurumMarketPromise?: Promise<MarketSnapshot>
}

function nptDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function isoDateFromUnix(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000).toISOString().slice(0, 10)
}

function ageInDays(date: string | null): number | null {
  if (!date) return null
  const then = Date.parse(`${date}T00:00:00Z`)
  const today = Date.parse(`${nptDate()}T00:00:00Z`)
  return Math.max(0, Math.floor((today - then) / 86_400_000))
}

async function getJson(url: string, timeout = REQUEST_TIMEOUT_MS): Promise<any | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function getText(url: string, timeout = REQUEST_TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

function metricUnavailable(unit: string, source = 'Unavailable', note?: string): MetricQuote {
  return {
    value: null,
    previous: null,
    change: null,
    changePct: null,
    unit,
    source,
    asOf: null,
    rateDate: null,
    stale: true,
    note,
  }
}

async function fetchYahooHistory(symbol: string, unit: string, range = '1y'): Promise<YahooHistory | null> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=history`
  const json = await getJson(url)
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const timestamps: number[] = result.timestamp ?? []
  const closes: Array<number | null> = result.indicators?.quote?.[0]?.close ?? []
  const history: Array<{ date: string; value: number }> = []
  timestamps.forEach((timestamp, index) => {
    const value = closes[index]
    const date = isoDateFromUnix(timestamp)
    if (date && isValidNumber(value)) history.push({ date, value })
  })
  const last = history.at(-1)
  const previous = history.at(-2)
  const metaValue = result.meta?.regularMarketPrice
  const value = isValidNumber(metaValue) ? metaValue : last?.value ?? null
  const asOfTimestamp = result.meta?.regularMarketTime ?? timestamps.at(-1)
  const asOf = typeof asOfTimestamp === 'number' ? new Date(asOfTimestamp * 1000).toISOString() : null
  if (!value) return null
  const prevValue = previous?.value ?? null
  const computedChange = prevValue === null ? null : value - prevValue
  const computedChangePct = prevValue ? (computedChange! / prevValue) * 100 : null
  const quotedChangePct = Number(result.meta?.regularMarketChangePercent)
  const changePct = Number.isFinite(quotedChangePct) ? quotedChangePct : computedChangePct
  const change = changePct !== null
    ? value - value / (1 + changePct / 100)
    : computedChange
  const comparisonValue = change !== null ? value - change : prevValue
  const staleDays = ageInDays(last?.date ?? null)
  return {
    history,
    metric: {
      value,
      previous: comparisonValue,
      change,
      changePct,
      unit,
      source: `Yahoo Finance · ${symbol}`,
      asOf,
      stale: !asOf || staleDays === null || staleDays > (symbol === 'NPR=X' ? 1 : 3),
    },
  }
}

async function fetchOpenErApi(): Promise<MetricQuote | null> {
  const payload = await getJson('https://open.er-api.com/v6/latest/USD')
  const value = Number(payload?.rates?.NPR)
  if (payload?.result !== 'success' || !isValidNumber(value)) return null
  const timestamp = Number(payload?.time_last_update_unix)
  const asOf = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null
  const ageMs = asOf ? Date.now() - Date.parse(asOf) : Infinity
  return {
    value,
    previous: null,
    change: null,
    changePct: null,
    unit: 'NPR per USD',
    source: 'open.er-api.com · daily indicative rate',
    asOf,
    rateDate: asOf?.slice(0, 10) ?? null,
    stale: !Number.isFinite(ageMs) || ageMs > 36 * 60 * 60 * 1000,
    note: 'Daily indicative exchange rate; not an NRB fixing or bank selling quote.',
  }
}

function parseGoldCandles(payload: any): OhlcCandle[] {
  const points = payload?.points
  if (!Array.isArray(points)) return []
  return points
    .map((point: any): OhlcCandle | null => {
      const timestamp = Number(point?.t)
      const date = isoDateFromUnix(timestamp)
      const open = Number(point?.o)
      const high = Number(point?.h)
      const low = Number(point?.l)
      const close = Number(point?.c)
      if (!date || ![open, high, low, close].every((item) => Number.isFinite(item) && item > 0)) return null
      if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null
      const volume = Number(point?.v)
      return {
        date,
        timestamp,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
      }
    })
    .filter((point: OhlcCandle | null): point is OhlcCandle => point !== null)
    .sort((a: OhlcCandle, b: OhlcCandle) => a.timestamp - b.timestamp)
}

function parseLocalDate(day: any): string | null {
  const dayNumber = Number(day?.date)
  const year = String(day?.year ?? '')
  const monthValue = String(day?.month ?? '')
  const monthIndex = new Date(`${monthValue} 1, 2000 UTC`).getUTCMonth()
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31 || !/^20\d{2}$/.test(year) || Number.isNaN(monthIndex)) {
    return null
  }
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`
}

function parseFenegosidaToday(payload: any): Omit<LocalTodayResult, 'history'> & { history: LocalRatePoint[] } {
  const records: any[] = Array.isArray(payload) ? payload : []
  const find = (pattern: RegExp) => records.find((item) => pattern.test(String(item?.rateType ?? '')))
  const fineTola = find(/छापावाल.*(?:१\s*तोला|तोल)/)
  const fine10g = find(/छापावाल.*(?:१०\s*ग्राम|10\s*gram)/i)
  const tejabiTola = records.find((item) => /(?:तेजाबी|tejabi)/i.test(String(item?.rateType ?? '')) && /(?:१\s*तोला|तोल)/i.test(String(item?.rateType ?? '')))
  const tejabi10g = records.find((item) => /(?:तेजाबी|tejabi)/i.test(String(item?.rateType ?? '')) && /(?:१०\s*ग्राम|10\s*gram)/i.test(String(item?.rateType ?? '')))
  const rateDate = parseDate(fineTola?.todayDate ?? fine10g?.todayDate)
  const tejabiDate = parseDate(tejabiTola?.todayDate ?? tejabi10g?.todayDate)
  const hasSameDayTejabiPair = rateDate !== null && tejabiDate === rateDate
  const asOf = typeof fineTola?.todayDate === 'string' ? fineTola.todayDate : typeof fine10g?.todayDate === 'string' ? fine10g.todayDate : null
  const rate24kTola = isValidNumber(fineTola?.todayBaseRatePerGram) ? fineTola.todayBaseRatePerGram : null
  const rate24k10g = isValidNumber(fine10g?.todayBaseRatePerGram) ? fine10g.todayBaseRatePerGram : null
  const previous24kTola = isValidNumber(fineTola?.yestardayBaseRatePerGram) ? fineTola.yestardayBaseRatePerGram : null
  const previous24k10g = isValidNumber(fine10g?.yestardayBaseRatePerGram) ? fine10g.yestardayBaseRatePerGram : null
  const rateTejabiTola = hasSameDayTejabiPair && isValidNumber(tejabiTola?.todayBaseRatePerGram) ? tejabiTola.todayBaseRatePerGram : null
  const rateTejabi10g = hasSameDayTejabiPair && isValidNumber(tejabi10g?.todayBaseRatePerGram) ? tejabi10g.todayBaseRatePerGram : null
  return {
    rate24kTola,
    rate24k10g,
    previous24kTola,
    previous24k10g,
    rateTejabiTola,
    rateTejabi10g,
    rateDate,
    asOf,
    history: [],
  }
}

function parseFenegosidaHistory(payload: any): LocalRatePoint[] {
  const points = payload?.goldData
  if (!Array.isArray(points)) return []
  return points
    .map((item: any) => ({
      date: parseLocalDate(item),
      perTola: Number(item?.tola),
      per10g: Number(item?.gm),
    }))
    .filter((item): item is LocalRatePoint =>
      typeof item.date === 'string' && Number.isFinite(item.perTola) && item.perTola > 0 && Number.isFinite(item.per10g) && item.per10g > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

function extractNrbPayload(value: any): any[] {
  const candidates = [value?.data?.payload, value?.payload, value?.data, value?.rates, value]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function nrbCurrencyCode(rate: any): string {
  const currency = rate?.currency
  if (typeof currency === 'string') return currency.toUpperCase()
  return String(currency?.iso3 ?? currency?.iso2 ?? currency?.code ?? currency?.currency_code ?? '').toUpperCase()
}

async function fetchNrbDirect(): Promise<NrbResult | null> {
  const today = nptDate()
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 5)
  const from = start.toISOString().slice(0, 10)
  const params = new URLSearchParams({ from, to: today, per_page: '100', page: '1' })
  const payload = await getJson(`${NRB_API}?${params}`, 4500)
  if (!payload) return null
  const days = extractNrbPayload(payload)
    .filter((day: any) => Array.isArray(day?.rates))
    .sort((a: any, b: any) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))
  for (const day of days) {
    const usd = day.rates.find((rate: any) => nrbCurrencyCode(rate) === 'USD')
    if (!usd) continue
    const unit = Number(usd?.currency?.unit ?? usd?.unit ?? 1) || 1
    const buy = Number(usd?.buy) / unit
    const sell = Number(usd?.sell) / unit
    if (isValidNumber(buy) && isValidNumber(sell)) {
      const date = parseDate(day?.date ?? day?.published_on)
      return {
        buy,
        sell,
        date,
        source: 'Nepal Rastra Bank · official rates API',
        stale: date === null || (ageInDays(date) ?? Infinity) > 1,
      }
    }
  }
  return null
}

async function fetchNrbMirror(): Promise<NrbResult | null> {
  const payload = await getJson(NRB_MIRROR_URL)
  const records = Array.isArray(payload?.rates) ? payload.rates : []
  const date = parseDate(payload?.date)
  const buy = records.find((item: any) => item?.base === 'USD' && item?.quote === 'NPR' && item?.type === 'buy')?.value
  const sell = records.find((item: any) => item?.base === 'USD' && item?.quote === 'NPR' && item?.type === 'sell')?.value
  if (!isValidNumber(buy) || !isValidNumber(sell)) return null
  const days = ageInDays(date)
  return {
    buy,
    sell,
    date,
    source: 'NRB published table · data mirror',
    stale: days === null || days > 1,
  }
}

async function fetchRealYield(): Promise<YahooHistory | null> {
  const key = process.env.FRED_API_KEY
  if (key) {
    const params = new URLSearchParams({
      series_id: 'DFII10',
      api_key: key,
      file_type: 'json',
      sort_order: 'desc',
      limit: '5',
    })
    const payload = await getJson(`https://api.stlouisfed.org/fred/series/observations?${params}`, 6500)
    const observations = payload?.observations
    if (Array.isArray(observations)) {
      const valid = observations
        .filter((item: any) => item?.value !== '.' && Number.isFinite(Number(item?.value)))
        .map((item: any) => ({ date: String(item.date), value: Number(item.value) }))
        .reverse()
      const last = valid.at(-1)
      const previous = valid.at(-2)
      if (last) {
        return {
          history: valid,
          metric: {
            value: last.value,
            previous: previous?.value ?? null,
            change: previous ? last.value - previous.value : null,
            changePct: previous && previous.value !== 0 ? ((last.value - previous.value) / previous.value) * 100 : null,
            unit: '%',
            source: 'FRED · 10Y TIPS real yield (DFII10)',
            asOf: `${last.date}T00:00:00Z`,
            stale: (ageInDays(last.date) ?? 0) > 7,
          },
        }
      }
    }
  }
  return null
}

async function fetchNews(): Promise<MarketHeadline[]> {
  const feeds = await Promise.all(NEWS_URLS.map((url) => getText(url, 5500)))
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, processEntities: true })
  const seen = new Set<string>()
  const result: MarketHeadline[] = []
  for (const xml of feeds) {
    if (!xml) continue
    try {
      const feed = parser.parse(xml)?.rss?.channel?.item
      const items: any[] = Array.isArray(feed) ? feed : feed ? [feed] : []
      for (const item of items) {
        const title = String(item?.title ?? '').replace(/\s+/g, ' ').trim()
        const url = String(item?.link ?? '').trim()
        if (!title || !url) continue
        const key = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 100)
        if (seen.has(key)) continue
        seen.add(key)
        const date = typeof item?.pubDate === 'string' ? new Date(item.pubDate) : null
        const publishedAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : null
        if (publishedAt && Date.now() - Date.parse(publishedAt) > 72 * 60 * 60 * 1000) continue
        const sourceValue = item?.source
        const source = typeof sourceValue === 'string'
          ? sourceValue
          : String(sourceValue?.['#text'] ?? 'Google News syndication')
        const signal = scoreHeadline(title)
        result.push({ title, source, url, publishedAt, sentimentScore: signal.score, impact: signal.impact, reasoning: signal.reasoning })
      }
    } catch {
      // One malformed RSS feed must not discard the other upstream feeds.
    }
  }
  return result
    .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''))
    .slice(0, 16)
}

function metricFromNrb(value: number | null, source: string, date: string | null, stale: boolean, unit: string): MetricQuote {
  return {
    value,
    previous: null,
    change: null,
    changePct: null,
    unit,
    source,
    asOf: date ? `${date}T00:00:00.000Z` : null,
    rateDate: date,
    stale,
    note: date ? `Published ${date}` : undefined,
  }
}

async function collectMarketData(): Promise<MarketSnapshot> {
  const manualRates = await getManualOfficialRates().catch(() => [])
  const [spotResult, chartResult, fenTodayResult, localHistoryResult, nrbDirectResult, nrbMirrorResult, openErResult,
    dxyResult, nprResult, inrResult, nominalYieldResult, brentResult, realYieldResult, fedFundsFuturesResult, newsResult, institutionalDemandResult, stage2Result] = await Promise.allSettled([
    getJson(XAU_SPOT_URL),
    getJson(XAU_CHART_URL, 8500),
    getJson(`${FENEGOSIDA_API}/today`),
    getJson(`${FENEGOSIDA_API}/WeeklyChartRate?weekmonthyear=30`),
    fetchNrbDirect(),
    fetchNrbMirror(),
    fetchOpenErApi(),
    fetchYahooHistory('DX-Y.NYB', 'index points'),
    fetchYahooHistory('NPR=X', 'NPR per USD'),
    fetchYahooHistory('INR=X', 'INR per USD'),
    fetchYahooHistory('^TNX', '% nominal yield'),
    fetchYahooHistory('BZ=F', 'USD per barrel'),
    fetchRealYield(),
    fetchYahooHistory('ZQ=F', '30-day federal-funds futures price points'),
    fetchNews(),
    getInstitutionalDemand(),
    collectStage2Data(),
  ])
  const settledValue = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
    result.status === 'fulfilled' ? result.value : fallback

  const spotPayload = settledValue(spotResult, null as any)
  const rawCandles = parseGoldCandles(settledValue(chartResult, null as any))
  const localToday = parseFenegosidaToday(settledValue(fenTodayResult, null as any))
  const localHistory = parseFenegosidaHistory(settledValue(localHistoryResult, null as any))
  const currentNptDate = nptDate()
  const manualToday = manualRates.find((entry) => entry.date === currentNptDate)
  const manualRateApplied = Boolean(manualToday && (localToday.rateDate !== currentNptDate || localToday.rate24kTola === null))
  const manualTejabiApplied = Boolean(manualToday && !manualRateApplied && localToday.rateDate === currentNptDate && localToday.rate24kTola !== null && localToday.rateTejabiTola === null)
  if (manualRateApplied && manualToday) {
    localToday.rate24kTola = manualToday.rate24kTolaNpr
    localToday.rate24k10g = Math.round(manualToday.rate24kTolaNpr * 10 / 11.6638)
    localToday.rateTejabiTola = manualToday.tejabiTolaNpr
    localToday.rateTejabi10g = Math.round(manualToday.tejabiTolaNpr * 10 / 11.6638)
    localToday.previous24kTola = null
    localToday.previous24k10g = null
    localToday.rateDate = manualToday.date
    localToday.asOf = manualToday.updatedAt
  } else if (manualTejabiApplied && manualToday) {
    localToday.rateTejabiTola = manualToday.tejabiTolaNpr
    localToday.rateTejabi10g = Math.round(manualToday.tejabiTolaNpr * 10 / 11.6638)
  }
  const nrbDirect = settledValue(nrbDirectResult, null)
  const nrbMirror = settledValue(nrbMirrorResult, null)
  const nrb = nrbDirect ?? nrbMirror
  const openErFx = settledValue(openErResult, null)
  const dxy = settledValue(dxyResult, null)
  const yahooNpr = settledValue(nprResult, null)
  const usdNprSpot = openErFx && !openErFx.stale ? { metric: openErFx, history: [] } : yahooNpr && !yahooNpr.metric.stale ? yahooNpr : openErFx ? { metric: openErFx, history: [] } : yahooNpr
  const nrbParity = nrbDirect && !nrbDirect.stale
    ? metricFromNrb(nrbDirect.sell, nrbDirect.source, nrbDirect.date, false, 'NPR per USD')
    : openErFx && !openErFx.stale
      ? openErFx
      : yahooNpr && !yahooNpr.metric.stale
        ? yahooNpr.metric
        : metricUnavailable('NPR per USD', 'Unavailable', 'No fresh official NRB or indicative FX quote is available.')
  const usdInr = settledValue(inrResult, null)
  const nominal10y = settledValue(nominalYieldResult, null)
  const brent = settledValue(brentResult, null)
  const realYield = settledValue(realYieldResult, null)
  const fedFundsFutures = settledValue(fedFundsFuturesResult, null)
  const news = settledValue(newsResult, [])
  const institutionalDemand = settledValue(institutionalDemandResult, unavailableInstitutionalDemandSnapshot())
  const stage2 = settledValue(stage2Result, unavailableStage2Snapshot())

  const xauValue = isValidNumber(spotPayload?.spot_usd_oz)
    ? spotPayload.spot_usd_oz
    : isValidNumber(spotPayload?.xau?.price)
      ? spotPayload.xau.price
      : null
  const spotAsOf = typeof spotPayload?.price_as_of === 'string'
    ? spotPayload.price_as_of
    : typeof spotPayload?.updated_at === 'string'
      ? spotPayload.updated_at
      : null
  const spotAge = spotAsOf ? Math.max(0, (Date.now() - Date.parse(spotAsOf)) / 1000) : Infinity
  const spotThresholdMs = isGoldMarketOpen(new Date()) ? RELIABILITY_THRESHOLDS.spotDuringMarketHoursMs : RELIABILITY_THRESHOLDS.spotOutsideMarketHoursMs
  const spotStale = Boolean(spotPayload?.stale) || !Number.isFinite(spotAge) || spotAge * 1000 > spotThresholdMs
  const lastCandle = rawCandles.at(-1)
  const spot = xauValue ?? lastCandle?.close ?? null
  const hasLiveSpot = xauValue !== null
  const effectiveSpotAsOf = spotAsOf ?? (lastCandle ? new Date(lastCandle.timestamp * 1000).toISOString() : null)
  const spotSource = hasLiveSpot
    ? `${String(spotPayload?.price_source ?? spotPayload?.source ?? 'XAUS spot feed')} · indicative mid`
    : lastCandle
      ? 'Last observed XAU/USD daily close · not a live quote'
      : 'Unavailable'

  const candles = rawCandles.map((candle) => ({ ...candle }))
  const today = nptDate()
  const last = candles.at(-1)
  if (last && spot !== null && last.date === today && !spotStale) {
    last.high = Math.max(last.high, spot)
    last.low = Math.min(last.low, spot)
    last.close = spot
  }
  const indicators = candles.length >= 26 ? calculateTechnicalIndicators(candles) : null

  const nrbDate = nrb?.date ?? null
  const nrbBuy = metricFromNrb(nrb?.buy ?? null, nrb?.source ?? 'Unavailable', nrbDate, nrb?.stale ?? true, 'NPR per USD')
  const nrbSell = metricFromNrb(nrb?.sell ?? null, nrb?.source ?? 'Unavailable', nrbDate, nrb?.stale ?? true, 'NPR per USD')
  const nprMetric: MetricQuote = usdNprSpot?.metric ?? metricUnavailable('NPR per USD', 'open.er-api / Yahoo Finance · NPR=X')
  const effectiveFx = nrbParity.value
  const effectiveFxHistory = (yahooNpr?.history ?? []).map((item) => ({ date: item.date, value: item.value }))
  const nrbSpread = calculateRollingImpliedSpread(
    localHistory.length ? localHistory : localToday.rate24kTola && localToday.rateDate
      ? [{ date: localToday.rateDate, perTola: localToday.rate24kTola, per10g: localToday.rate24k10g ?? 0 }]
      : [],
    rawCandles,
    effectiveFxHistory,
    {
      latestLocalTola: localToday.rate24kTola,
      latestXauUsd: spot,
      latestFx: effectiveFx,
      date: localToday.rateDate ?? today,
    },
  )

  const newsWithSentiment = news as MarketHeadline[]
  const officialDateAge = ageInDays(localToday.rateDate)
  const isOfficialRateStale = officialDateAge === null || officialDateAge > 1
  const notices: string[] = []
  if (!hasLiveSpot) notices.push('Live spot quote is unavailable; the latest observed daily close is used when present.')
  else if (spotStale) notices.push('Spot provider reports a stale quote; the latest observed price is shown with a stale badge.')
  if (candles.length < 201) notices.push(`Only ${candles.length} daily OHLC observations are available; EMA(200) and full walk-forward validation may be unavailable.`)
  if (localToday.rate24kTola === null) notices.push('Official FENEGOSIDA rate feed did not return a current 24K tola benchmark.')
  if (manualRateApplied && manualToday) notices.push(`Current FENEGOSIDA benchmark is supplied by a manual entry for ${manualToday.date}; it is a user transcription, not an automatic feed observation.`)
  else if (manualTejabiApplied && manualToday) notices.push(`The same-date Tejabi rate is supplied by a manual entry for ${manualToday.date}; the 24K benchmark remains automatic.`)
  else if (isOfficialRateStale) notices.push(localToday.rateDate
    ? `The latest FENEGOSIDA fixing is dated ${localToday.rateDate}; the last published local benchmark is carried forward and marked stale until a newer fixing arrives.`
    : 'FENEGOSIDA returned a benchmark without a valid fixing date; the value is marked stale and must not be treated as a current official quote.')
  if (localToday.rate24kTola !== null && localToday.rateTejabiTola === null) notices.push(`A same-date Tejabi quote was not present in the FENEGOSIDA response; the displayed Tejabi estimate uses the active learned/manual ratio and is not an official fixing.`)
  if (!nrbDirect || nrbDirect.stale) {
    notices.push(nrbParity.value
      ? `No fresh direct NRB API fixing was available; parity uses ${nrbParity.source} (${nrbParity.asOf ?? 'timestamp unavailable'}), an indicative fallback rather than an NRB fixing.`
      : 'No fresh direct NRB API fixing or indicative open.er-api / Yahoo USD/NPR quote is available; local parity is withheld.')
  }
  if (nrbMirror?.stale) notices.push(`The NRB data mirror is dated ${nrbMirror.date ?? 'unknown'} and is retained only as a stale reference, not used as the current parity conversion.`)
  if (!realYield?.metric.value) notices.push('U.S. 10Y TIPS real-yield data is unavailable. The nominal 10Y Treasury yield is shown separately and is not a real-yield substitute.')
  if (!fedFundsFutures?.metric.value) notices.push('The Yahoo ZQ=F front-month 30-day federal-funds futures quote is unavailable; no rate-cut probability is inferred.')
  if (institutionalDemand.status === 'unavailable') notices.push('WGC central-bank/ETF reports and IMF IRFCL gold-reserve data are unavailable; institutional-demand factors are withheld, not simulated.')
  else {
    if (institutionalDemand.centralBank.provenance === 'unavailable') notices.push('No current WGC central-bank monthly report was parsed; this component contributes no directional signal.')
    if (institutionalDemand.goldEtf.provenance === 'unavailable') notices.push('No current WGC gold ETF monthly flow report was parsed; this component contributes no directional signal.')
    const anomalousReserve = institutionalDemand.goldReserves.find((reserve) => reserve.anomalyDetected)
    if (anomalousReserve) notices.push(`${anomalousReserve.country} IMF IRFCL reserve series contains a scale/plausibility anomaly; any retained earlier quantity is labeled by observation month and excluded from the short-horizon forecast overlay.`)
  }
  if (!newsWithSentiment.length) notices.push('The live headline feed is unavailable or returned no recent items; no headlines are fabricated.')
  if (nrbSpread.method === 'latest-rate-calibration') notices.push('Local spread is calibrated from the latest official FENEGOSIDA benchmark because fewer than three matched daily observations were available.')
  if (nrbSpread.method === 'unavailable') notices.push('No matched local-spread history is available; Nepal parity estimates are withheld rather than assuming a fabricated spread.')

  const automaticRatePoints = [...localHistory]
  if (!manualRateApplied && localToday.rateDate && localToday.rate24kTola) {
    automaticRatePoints.push({ date: localToday.rateDate, perTola: localToday.rate24kTola, per10g: localToday.rate24k10g ?? Math.round(localToday.rate24kTola * 10 / 11.6638) })
  }
  await recordOfficialRateHistory(automaticRatePoints, 'FENEGOSIDA · official daily benchmark').catch(() => undefined)

  const localHistoryWithToday = [...localHistory]
  if (localToday.rateDate && localToday.rate24kTola && localToday.rate24k10g) {
    const existing = localHistoryWithToday.findIndex((point) => point.date === localToday.rateDate)
    const currentPoint = { date: localToday.rateDate, perTola: localToday.rate24kTola, per10g: localToday.rate24k10g }
    if (existing >= 0) localHistoryWithToday[existing] = currentPoint
    else localHistoryWithToday.push(currentPoint)
  }

  const macro: MarketSnapshot['macro'] = {
    dxy: dxy?.metric ?? metricUnavailable('index points', 'Yahoo Finance · DX-Y.NYB'),
    usdNprSpot: nprMetric,
    usdNprTrend: yahooNpr?.metric ?? metricUnavailable('NPR per USD', 'Yahoo Finance · NPR=X', 'Daily FX trend observation unavailable; the conversion level is kept separate.'),
    usdNprParity: nrbParity,
    nrbUsdNprBuy: nrbBuy,
    nrbUsdNprSell: nrbSell,
    usdInr: usdInr?.metric ?? metricUnavailable('INR per USD', 'Yahoo Finance · INR=X'),
    nominal10y: nominal10y?.metric ?? metricUnavailable('%', 'Yahoo Finance · ^TNX'),
    real10y: realYield?.metric ?? metricUnavailable('%', 'FRED · DFII10', 'Optional FRED_API_KEY required for the real-yield series.'),
    fedFundsFutures: fedFundsFutures?.metric ?? metricUnavailable(
      'futures index points',
      'Yahoo Finance · ZQ=F',
      'Front-month 30-day federal-funds futures price change is only a directional repricing proxy, not CME FedWatch meeting-cut odds.',
    ),
    brent: brent?.metric ?? metricUnavailable('USD per barrel', 'Yahoo Finance · BZ=F'),
  }
  stage2.nprInr = deriveNprInrCross(nrbParity, usdInr?.metric ?? metricUnavailable('INR per USD', 'Unavailable'), stage2.generatedAt)
  const silverCorrelation = stage2.silverHistory.status === 'fresh' && stage2.silverHistory.data
    ? correlateReturns(rawCandles.map((item) => ({ date: item.date, value: item.close })), stage2.silverHistory.data)
    : null
  stage2.silverCorrelation = {
    data: silverCorrelation,
    status: silverCorrelation ? stage2.silverHistory.status : stage2.silverHistory.status === 'stale' ? 'stale' : 'unavailable',
    source: 'Yahoo Finance · SI=F returns vs XAU/USD daily returns',
    url: stage2.silverHistory.url,
    asOf: stage2.silverHistory.asOf,
    checkedAt: stage2.silverHistory.checkedAt,
    note: silverCorrelation ? `Pearson correlation on ${silverCorrelation.observations} matched daily return pairs; proxy only.` : stage2.silverHistory.note,
  }

  const market: MarketSnapshot = {
    generatedAt: new Date().toISOString(),
    status: hasLiveSpot && !spotStale && candles.length >= 201 && localToday.rate24kTola !== null && !isOfficialRateStale && effectiveFx !== null && nrbSpread.spreadPct !== null
      ? 'live'
      : spot || candles.length ? 'partial' : 'unavailable',
    spot,
    spotSource,
    spotAsOf: effectiveSpotAsOf,
    spotStale: !hasLiveSpot || spotStale,
    historySource: rawCandles.length ? 'XAUS daily XAU/USD OHLC history' : 'Unavailable',
    historyAsOf: rawCandles.at(-1) ? new Date(rawCandles.at(-1)!.timestamp * 1000).toISOString() : null,
    candles,
    indicators,
    macro,
    institutionalDemand,
    stage2,
    nepal: {
      rate24kTola: localToday.rate24kTola,
      rate24k10g: localToday.rate24k10g,
      previous24kTola: localToday.previous24kTola,
      previous24k10g: localToday.previous24k10g,
      rateDate: localToday.rateDate,
      rateSource: manualRateApplied ? 'Manual entry · FENEGOSIDA transcription' : localToday.rate24kTola ? 'FENEGOSIDA · official daily benchmark' : 'Unavailable',
      rateAsOf: localToday.asOf,
      rateTejabiAsOf: manualRateApplied || manualTejabiApplied ? manualToday?.updatedAt ?? null : localToday.asOf,
      rateStale: isOfficialRateStale,
      rate24kManualEntry: manualRateApplied,
      rateTejabiManualEntry: manualRateApplied || manualTejabiApplied,
      rate22kTola: localToday.rate24kTola ? Math.round((localToday.rate24kTola * 0.9167) / 100) * 100 : null,
      rate22k10g: localToday.rate24k10g ? Math.round((localToday.rate24k10g * 0.9167) / 100) * 100 : null,
      rate22kDerived: true,
      rateTejabiTola: localToday.rateTejabiTola,
      rateTejabi10g: localToday.rateTejabi10g,
      rateTejabiOfficial: localToday.rateTejabiTola !== null || localToday.rateTejabi10g !== null,
      history: localHistoryWithToday.sort((a, b) => a.date.localeCompare(b.date)),
    },
    localSpreadPct: nrbSpread.spreadPct,
    localSpreadSamples: nrbSpread.sampleCount,
    localSpreadMethod: nrbSpread.method,
    news: newsWithSentiment,
    notices,
  }
  return market
}

export async function getMarketData(forceRefresh = false): Promise<MarketSnapshot> {
  const now = Date.now()
  if (!forceRefresh && globalMarketCache.__aurumMarketCache && globalMarketCache.__aurumMarketCache.expiresAt > now) {
    return globalMarketCache.__aurumMarketCache.value
  }
  if (!forceRefresh && globalMarketCache.__aurumMarketPromise) return globalMarketCache.__aurumMarketPromise
  const work = collectMarketData()
  globalMarketCache.__aurumMarketPromise = work
  try {
    const value = await work
    globalMarketCache.__aurumMarketCache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
    return value
  } finally {
    globalMarketCache.__aurumMarketPromise = undefined
  }
}
