'use client'

import { useMemo } from 'react'
import { AlertCircle, Clock3, RefreshCw, X } from 'lucide-react'
import type { MarketSnapshot } from '@/lib/types'

type Language = 'en' | 'ne'
type State = 'live' | 'stale' | 'unavailable' | 'manual' | 'proxy'
interface FeedRow { name: string; source: string; state: State; updated: string | null; detail?: string }
const tr = (language: Language, en: string, ne: string) => language === 'ne' ? ne : en
function localizedDate(value: string | null | undefined, language: Language) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString(language === 'ne' ? 'ne-NP' : 'en-GB', { timeZone: 'Asia/Kathmandu', dateStyle: 'medium', timeStyle: 'short' })
}
function quoteState(value: number | null, stale: boolean, source: string): State {
  if (value === null) return 'unavailable'
  if (stale) return 'stale'
  return /proxy|mirror|yahoo|fallback/i.test(source) ? 'proxy' : 'live'
}
function observationState(updatedAt: string | null, available: boolean, maximumAgeHours: number): State {
  if (!available) return 'unavailable'
  if (!updatedAt) return 'stale'
  const age = Date.now() - Date.parse(updatedAt)
  return !Number.isFinite(age) || age > maximumAgeHours * 3_600_000 ? 'stale' : 'live'
}
function stageState(status: string, valueAvailable: boolean): State {
  if (status === 'manual') return 'manual'
  if (status === 'stale') return 'stale'
  if (status === 'unavailable') return 'unavailable'
  return valueAvailable ? (status === 'proxy' ? 'proxy' : 'live') : 'unavailable'
}
function freshnessRows(market: MarketSnapshot | null): FeedRow[] {
  if (!market) return []
  const reliabilitySpot = market.reliability?.global.feeds.find((feed) => feed.name === 'XAU/USD spot')
  const reliabilityFx = market.reliability?.nepal.feeds.find((feed) => feed.name === 'USD/NPR conversion')
  const reliabilityOfficial = market.reliability?.nepal.feeds.find((feed) => feed.name === 'FENEGOSIDA official 24K')
  const rows: FeedRow[] = [
    { name: 'XAU/USD spot', source: market.spotSource, state: reliabilitySpot?.state ?? quoteState(market.spot, market.spotStale, market.spotSource), updated: market.spotAsOf, detail: market.spot == null ? 'No price is displayed.' : `USD/oz · ${market.spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}${reliabilitySpot?.reason ? ` · FORECAST GATE: ${reliabilitySpot.reason}` : ''}` },
    { name: 'XAU/USD daily OHLC', source: market.historySource, state: observationState(market.historyAsOf, market.candles.length > 0, 72), updated: market.historyAsOf, detail: `${market.candles.length} observed candles; no OHLC fallback values.` },
    { name: 'FENEGOSIDA 24K Hallmark', source: market.nepal.rateSource, state: reliabilityOfficial?.state ?? (market.nepal.rate24kTola == null ? 'unavailable' : market.nepal.rate24kManualEntry ? 'manual' : market.nepal.rateStale ? 'stale' : 'live'), updated: market.nepal.rateAsOf ?? market.nepal.rateDate, detail: `${market.nepal.rate24kTola == null ? 'Official benchmark unavailable.' : `${market.nepal.rateDate ?? 'date missing'} · NPR/tola`}${reliabilityOfficial?.reason ? ` · FORECAST GATE: ${reliabilityOfficial.reason}` : ''}` },
    { name: 'FENEGOSIDA Tejabi', source: market.nepal.rateTejabiManualEntry ? 'Manual entry · FENEGOSIDA transcription' : market.nepal.rateTejabiOfficial ? 'FENEGOSIDA · separate quote' : `Learned/manual ratio · ${market.nepal.tejabiRatioState?.sampleCount ?? 0} paired observations`, state: market.nepal.rateTejabiTola == null ? 'unavailable' : market.nepal.rateTejabiManualEntry ? 'manual' : market.nepal.rateTejabiOfficial ? (market.nepal.rateStale ? 'stale' : 'live') : 'proxy', updated: market.nepal.rateTejabiAsOf ?? market.nepal.tejabiRatioState?.lastUpdatedAt ?? null, detail: market.nepal.rateTejabiOfficial ? 'Separately reported fixing.' : 'Estimated from the learned/manual ratio; excluded as an official observation.' },
    { name: 'USD/NPR conversion', source: market.macro.usdNprParity.source, state: reliabilityFx?.state ?? quoteState(market.macro.usdNprParity.value, market.macro.usdNprParity.stale, market.macro.usdNprParity.source), updated: market.macro.usdNprParity.asOf, detail: `${market.macro.usdNprParity.note ?? ''}${reliabilityFx?.reason ? ` · FORECAST GATE: ${reliabilityFx.reason}` : ''}` },
    { name: 'Nepal local spread calibration', source: market.localSpreadMethod, state: market.localSpreadPct == null ? 'unavailable' : 'proxy', updated: market.nepal.rateAsOf ?? market.generatedAt, detail: `${market.localSpreadSamples} matched official observations · ${market.localSpreadPct == null ? 'withheld' : `${market.localSpreadPct.toFixed(2)}% calibrated basis`}` },
    { name: 'NRB USD/NPR buy', source: market.macro.nrbUsdNprBuy.source, state: quoteState(market.macro.nrbUsdNprBuy.value, market.macro.nrbUsdNprBuy.stale, market.macro.nrbUsdNprBuy.source), updated: market.macro.nrbUsdNprBuy.asOf },
    { name: 'NRB USD/NPR sell', source: market.macro.nrbUsdNprSell.source, state: quoteState(market.macro.nrbUsdNprSell.value, market.macro.nrbUsdNprSell.stale, market.macro.nrbUsdNprSell.source), updated: market.macro.nrbUsdNprSell.asOf },
    { name: 'DXY', source: market.macro.dxy.source, state: quoteState(market.macro.dxy.value, market.macro.dxy.stale, market.macro.dxy.source), updated: market.macro.dxy.asOf },
    { name: '10Y TIPS real yield', source: market.macro.real10y.source, state: quoteState(market.macro.real10y.value, market.macro.real10y.stale, market.macro.real10y.source), updated: market.macro.real10y.asOf, detail: market.macro.real10y.note },
    { name: '10Y nominal yield', source: market.macro.nominal10y.source, state: quoteState(market.macro.nominal10y.value, market.macro.nominal10y.stale, market.macro.nominal10y.source), updated: market.macro.nominal10y.asOf, detail: 'Context only; not a real-yield substitute.' },
    { name: 'Fed-funds futures', source: market.macro.fedFundsFutures.source, state: market.macro.fedFundsFutures.value == null ? 'unavailable' : market.macro.fedFundsFutures.stale ? 'stale' : 'proxy', updated: market.macro.fedFundsFutures.asOf, detail: 'Front-month repricing proxy, not CME FedWatch meeting odds.' },
    { name: 'Brent crude', source: market.macro.brent.source, state: quoteState(market.macro.brent.value, market.macro.brent.stale, market.macro.brent.source), updated: market.macro.brent.asOf },
    { name: 'WGC central-bank demand', source: market.institutionalDemand.centralBank.source, state: market.institutionalDemand.centralBank.provenance === 'unavailable' ? 'unavailable' : market.institutionalDemand.centralBank.stale ? 'stale' : 'live', updated: market.institutionalDemand.centralBank.publishedAt, detail: market.institutionalDemand.centralBank.note },
    { name: 'WGC gold ETF flows', source: market.institutionalDemand.goldEtf.source, state: market.institutionalDemand.goldEtf.provenance === 'unavailable' ? 'unavailable' : market.institutionalDemand.goldEtf.stale ? 'stale' : 'live', updated: market.institutionalDemand.goldEtf.publishedAt, detail: market.institutionalDemand.goldEtf.note },
    { name: 'IMF IRFCL gold reserves', source: market.institutionalDemand.goldReserves[0]?.sourceUrl ?? 'IMF IRFCL', state: market.institutionalDemand.goldReserves.length ? market.institutionalDemand.goldReserves[0].stale ? 'stale' : 'live' : 'unavailable', updated: market.institutionalDemand.goldReserves[0]?.asOf ?? null, detail: 'Monthly reported stocks, not real-time flows.' },
    { name: 'CFTC COT positioning', source: market.stage2.cot.source, state: stageState(market.stage2.cot.status, Boolean(market.stage2.cot.data)), updated: market.stage2.cot.asOf, detail: market.stage2.cot.note },
    { name: 'CME FedWatch', source: market.stage2.fedWatch.source, state: stageState(market.stage2.fedWatch.status, Boolean(market.stage2.fedWatch.data)), updated: market.stage2.fedWatch.asOf, detail: market.stage2.fedWatch.note },
    { name: 'ETF holdings proxies', source: `${market.stage2.etfs.gld.source} · ${market.stage2.etfs.iau.source}`, state: market.stage2.etfs.gld.status === 'unavailable' && market.stage2.etfs.iau.status === 'unavailable' ? 'unavailable' : 'proxy', updated: market.stage2.etfs.gld.asOf ?? market.stage2.etfs.iau.asOf, detail: 'Holdings observations are distinct from ETF flow reports.' },
    { name: 'India premium proxy', source: market.stage2.indiaGold.source, state: stageState(market.stage2.indiaGold.status, Boolean(market.stage2.indiaGold.data)), updated: market.stage2.indiaGold.asOf, detail: market.stage2.indiaGold.note },
    { name: 'India import-duty change', source: market.stage2.indiaImportDuty.source, state: stageState(market.stage2.indiaImportDuty.status, Boolean(market.stage2.indiaImportDuty.data)), updated: market.stage2.indiaImportDuty.asOf, detail: market.stage2.indiaImportDuty.note },
    { name: 'Nepal/India FX cross', source: market.stage2.nprInr.source, state: stageState(market.stage2.nprInr.status, Boolean(market.stage2.nprInr.data?.value)), updated: market.stage2.nprInr.asOf, detail: market.stage2.nprInr.note },
    { name: 'Calendar events', source: market.stage2.eventCalendar.source, state: stageState(market.stage2.eventCalendar.status, Boolean(market.stage2.eventCalendar.data?.length)), updated: market.stage2.eventCalendar.checkedAt, detail: market.stage2.eventCalendar.note },
    { name: 'News headlines', source: market.news[0]?.source ?? 'Google News syndication', state: observationState(market.news[0]?.publishedAt ?? null, market.news.length > 0, 24), updated: market.news[0]?.publishedAt ?? null, detail: `${market.news.length} recent headlines · sentiment is a proxy.` },
    { name: 'Festival/wedding seasonality', source: market.stage2.seasonality.source, state: 'proxy', updated: market.generatedAt, detail: market.stage2.seasonality.phase },
  ]
  return rows
}

const stateLabel: Record<State, { en: string; ne: string }> = {
  live: { en: 'LIVE', ne: 'लाइभ' }, stale: { en: 'STALE', ne: 'बासी' }, unavailable: { en: 'UNAVAILABLE', ne: 'अनुपलब्ध' }, manual: { en: 'MANUAL', ne: 'म्यानुअल' }, proxy: { en: 'PROXY', ne: 'प्रोक्सी' },
}

export default function DataFreshnessDrawer({ open, onClose, market, onRetry, language = 'en', canRetry }: { open: boolean; onClose: () => void; market: MarketSnapshot | null; onRetry: () => void; language?: Language; canRetry: boolean }) {
  const rows = useMemo(() => freshnessRows(market), [market])
  const counts = useMemo(() => rows.reduce((result, item) => { result[item.state] += 1; return result }, { live: 0, stale: 0, unavailable: 0, manual: 0, proxy: 0 }), [rows])
  if (!open) return null
  return <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="accuracy-drawer stage3-drawer" role="dialog" aria-modal="true" aria-labelledby="freshness-title">
    <div className="drawer-heading"><div><span className="drawer-kicker"><Clock3 size={13} /> {tr(language, 'SOURCE MONITOR', 'स्रोत अनुगमन')}</span><h2 id="freshness-title">{tr(language, 'Feed freshness & provenance', 'फिड ताजापन र स्रोत')}</h2><p>{tr(language, 'Per-feed timestamps and statuses. Proxy, stale, unavailable, and manual observations are kept distinct and excluded when unusable.', 'प्रत्येक फिडको समय र अवस्था। प्रोक्सी, बासी, अनुपलब्ध र म्यानुअल अवलोकन छुट्टाछुट्टै राखिन्छन्; प्रयोगयोग्य नभए मोडेलबाट बाहिर हुन्छन्।')}</p></div><button type="button" className="drawer-close" onClick={onClose} aria-label="Close feed monitor"><X size={18} /></button></div>
    <div className="drawer-content"><div className="feed-summary-strip">{(['live', 'stale', 'unavailable', 'manual', 'proxy'] as const).map((state) => <span className={`feed-count ${state}`} key={state}><i />{tr(language, stateLabel[state].en, stateLabel[state].ne)} <b>{counts[state]}</b></span>)}</div>
      {market?.reliability && <div className="reliability-monitor-banner"><b>ACTIVE FORECAST RELIABILITY</b><div><span className={market.reliability.global.state === 'reliable' ? 'reliability-ok' : 'reliability-low'}>GLOBAL: {market.reliability.global.state === 'reliable' ? 'RELIABLE' : 'LOW RELIABILITY'}</span><span className={market.reliability.nepal.state === 'reliable' ? 'reliability-ok' : 'reliability-low'}>NEPAL: {market.reliability.nepal.state === 'reliable' ? 'RELIABLE' : 'LOW RELIABILITY'}</span></div>{market.reliability.nepal.reasons.length > 0 && <small>{market.reliability.nepal.reasons.join(' · ')}</small>}<small>Thresholds: spot {market.reliability.thresholds.spotDuringMarketHoursMinutes} min in session / {market.reliability.thresholds.spotOutsideMarketHoursHours} h outside · FX {market.reliability.thresholds.usdNprHours} h · official rate {market.reliability.thresholds.officialRateBusinessDays} business day(s).</small></div>}
      {!market ? <div className="drawer-empty"><AlertCircle size={18} />{tr(language, 'No market snapshot is available yet.', 'बजार स्न्यापसट उपलब्ध छैन।')}</div> : <>
        <div className="feed-snapshot-time">{tr(language, 'Snapshot generated', 'स्न्यापसट बनाइएको')}: <b>{localizedDate(market.generatedAt, language)}</b><button type="button" className="button button-subtle" onClick={onRetry} disabled={!canRetry} title={canRetry ? 'Retry all feeds now' : 'Admin sign-in required to force-refresh feeds'}><RefreshCw size={13} />{tr(language, 'Retry all feeds', 'सबै फिड पुनः प्रयास')}{!canRetry && ' · ADMIN'}</button></div>
        <div className="feed-list">{rows.map((row) => <article className="feed-row" key={row.name}><div className="feed-row-main"><div><b>{row.name}</b><small>{row.source}</small>{row.detail && <p>{row.detail}</p>}</div><span className={`feed-status ${row.state}`}><i />{tr(language, stateLabel[row.state].en, stateLabel[row.state].ne)}</span></div><div className="feed-row-time"><span>{tr(language, 'Last updated', 'अन्तिम अद्यावधिक')}</span><b>{localizedDate(row.updated, language)}</b></div></article>)}</div>
        <p className="calculator-caveat">{tr(language, 'A retry refreshes the dashboard snapshot using provider timeouts, caching, and available fallbacks. Feed failures are not replaced with synthetic prices. Some sources (WGC, IMF, COT) publish on a lagged schedule.', 'पुनः प्रयास गर्दा समयसीमा, क्यास र उपलब्ध वैकल्पिक स्रोतसहित स्न्यापसट अद्यावधिक हुन्छ। फिड असफल हुँदा कृत्रिम मूल्य राखिँदैन। केही स्रोत (WGC, IMF, COT) ढिलो प्रकाशन हुन्छन्।')}</p>
      </>}
    </div>
  </aside></div>
}
