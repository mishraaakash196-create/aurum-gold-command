import { clamp } from './goldEngine'
import { scoreHeadline } from './sentiment'
import type { GeoLocation, LiveEvent, MarketHeadline } from './types'

const CONFLICT_TERMS = /war|armed conflict|conflict|hostilities|military strike|airstrike|missile|invasion|troops|attack|bombing|blockade|ceasefire|peace deal|peace talks|escalat|retaliat|front line|shelling|coup|terror attack|cross-border/i
const CALAMITY_TERMS = /earthquake|quake|aftershock|tsunami|volcan|eruption|cyclone|hurricane|typhoon|flood|flash flood|wildfire|forest fire|landslide|avalanche|drought|heatwave|heat wave|storm surge|tropical storm|natural disaster|calamity/i
const MACRO_EVENT_TERMS = /federal reserve|fed (?:chair|rate|decision|meeting)|interest rate|inflation|consumer price|jobs report|dollar index|treasury yield|central bank.{0,20}(?:gold|rate|buy)/i
const MAJOR_EVENT_TERMS = /massive|major|severe|catastroph|devastat|record.break|emergency|widespread|large.scale|deadly|surge|escalat|strike|invasion|blockade|retaliat|magnitude\s*[6-9]/i
const LIQUIDITY_TERMS = /margin call|liquidity crunch|forced selling|liquidat|equity selloff|cash scramble/i

const locations: Array<GeoLocation & { pattern: RegExp }> = [
  { id: 'israel-palestine', label: 'Israel / Palestine', region: 'Middle East', x: 543, y: 176, precision: 'country anchor', pattern: /israel|gaza|palestin|west bank/i },
  { id: 'iran', label: 'Iran', region: 'Middle East', x: 578, y: 174, precision: 'country anchor', pattern: /\biran\b|tehran|persian gulf/i },
  { id: 'lebanon', label: 'Lebanon', region: 'Middle East', x: 536, y: 167, precision: 'country anchor', pattern: /lebanon|beirut|hezbollah/i },
  { id: 'syria', label: 'Syria', region: 'Middle East', x: 542, y: 164, precision: 'country anchor', pattern: /syria|damascus/i },
  { id: 'iraq', label: 'Iraq', region: 'Middle East', x: 551, y: 177, precision: 'country anchor', pattern: /iraq|baghdad/i },
  { id: 'yemen-red-sea', label: 'Yemen / Red Sea', region: 'Middle East', x: 545, y: 199, precision: 'regional anchor', pattern: /yemen|red sea|bab el.?mandeb|aden/i },
  { id: 'saudi-arabia', label: 'Saudi Arabia', region: 'Middle East', x: 559, y: 194, precision: 'country anchor', pattern: /saudi arabia|riyadh/i },
  { id: 'turkey', label: 'Türkiye', region: 'Middle East / Europe', x: 524, y: 149, precision: 'country anchor', pattern: /turkey|türkiye|ankara|istanbul/i },
  { id: 'ukraine', label: 'Ukraine', region: 'Eastern Europe', x: 543, y: 125, precision: 'country anchor', pattern: /ukraine|kyiv|kiev|donbas|crimea/i },
  { id: 'russia', label: 'Russia', region: 'Eastern Europe / Eurasia', x: 596, y: 107, precision: 'regional anchor', pattern: /russia|moscow|kremlin/i },
  { id: 'sudan', label: 'Sudan', region: 'East Africa', x: 516, y: 225, precision: 'country anchor', pattern: /sudan|khartoum/i },
  { id: 'somalia', label: 'Somalia', region: 'Horn of Africa', x: 548, y: 246, precision: 'country anchor', pattern: /somalia|mogadishu/i },
  { id: 'ethiopia', label: 'Ethiopia', region: 'Horn of Africa', x: 526, y: 238, precision: 'country anchor', pattern: /ethiopia|addis ababa/i },
  { id: 'myanmar', label: 'Myanmar', region: 'Southeast Asia', x: 645, y: 213, precision: 'country anchor', pattern: /myanmar|burma|yangon/i },
  { id: 'pakistan', label: 'Pakistan', region: 'South Asia', x: 576, y: 188, precision: 'country anchor', pattern: /pakistan|islamabad|karachi/i },
  { id: 'nepal', label: 'Nepal', region: 'South Asia', x: 604, y: 187, precision: 'country anchor', pattern: /nepal|kathmandu/i },
  { id: 'india', label: 'India', region: 'South Asia', x: 594, y: 207, precision: 'country anchor', pattern: /india|new delhi|mumbai|kashmir/i },
  { id: 'china', label: 'China', region: 'East Asia', x: 652, y: 156, precision: 'country anchor', pattern: /china|beijing|xinjiang|tibet/i },
  { id: 'taiwan', label: 'Taiwan Strait', region: 'East Asia', x: 693, y: 177, precision: 'regional anchor', pattern: /taiwan|taiwan strait/i },
  { id: 'north-korea', label: 'Korean Peninsula', region: 'East Asia', x: 717, y: 166, precision: 'regional anchor', pattern: /north korea|south korea|korean peninsula|pyongyang|seoul/i },
  { id: 'japan', label: 'Japan', region: 'East Asia', x: 746, y: 165, precision: 'country anchor', pattern: /japan|tokyo|okinawa/i },
  { id: 'philippines', label: 'Philippines', region: 'Southeast Asia', x: 713, y: 239, precision: 'country anchor', pattern: /philippin|manila/i },
  { id: 'indonesia', label: 'Indonesia', region: 'Southeast Asia', x: 682, y: 269, precision: 'country anchor', pattern: /indonesia|jakarta|bali/i },
  { id: 'australia', label: 'Australia', region: 'Oceania', x: 764, y: 345, precision: 'country anchor', pattern: /australia|sydney|queensland/i },
  { id: 'united-states-west', label: 'United States · West', region: 'North America', x: 163, y: 153, precision: 'regional anchor', pattern: /california|los angeles|san francisco|alaska|hawaii/i },
  { id: 'united-states-east', label: 'United States · East', region: 'North America', x: 231, y: 152, precision: 'regional anchor', pattern: /united states|u\.s\.|\bus\b|washington dc|new york|texas/i },
  { id: 'canada', label: 'Canada', region: 'North America', x: 196, y: 94, precision: 'country anchor', pattern: /canada|ottawa|quebec/i },
  { id: 'mexico', label: 'Mexico', region: 'Central America', x: 237, y: 206, precision: 'country anchor', pattern: /mexico|mexican/i },
  { id: 'caribbean', label: 'Caribbean', region: 'Caribbean', x: 299, y: 207, precision: 'regional anchor', pattern: /caribbean|haiti|cuba|jamaica|dominican republic/i },
  { id: 'brazil', label: 'Brazil', region: 'South America', x: 326, y: 289, precision: 'country anchor', pattern: /brazil|amazon|brasilia/i },
  { id: 'chile', label: 'Chile', region: 'South America', x: 306, y: 345, precision: 'country anchor', pattern: /chile|santiago/i },
  { id: 'uk', label: 'United Kingdom', region: 'Western Europe', x: 463, y: 123, precision: 'country anchor', pattern: /united kingdom|britain|british|london|\buk\b/i },
  { id: 'france', label: 'France', region: 'Western Europe', x: 479, y: 140, precision: 'country anchor', pattern: /france|paris/i },
  { id: 'germany', label: 'Germany', region: 'Central Europe', x: 492, y: 130, precision: 'country anchor', pattern: /germany|berlin/i },
  { id: 'europe', label: 'Europe', region: 'Europe', x: 494, y: 119, precision: 'regional anchor', pattern: /europe|european union|\beu\b/i },
  { id: 'middle-east', label: 'Middle East', region: 'Middle East', x: 553, y: 176, precision: 'regional anchor', pattern: /middle east|west asia|gulf region/i },
  { id: 'eastern-europe', label: 'Eastern Europe', region: 'Eastern Europe', x: 533, y: 123, precision: 'regional anchor', pattern: /eastern europe|black sea/i },
]

export function locateHeadline(title: string): GeoLocation | null {
  const location = locations.find((candidate) => candidate.pattern.test(title))
  if (!location) return null
  const { pattern: _pattern, ...publicLocation } = location
  return publicLocation
}

export function eventLocations(): GeoLocation[] {
  return locations.map(({ pattern: _pattern, ...location }) => location)
}

export function classifyLiveEvent(title: string): LiveEvent['category'] | null {
  if (CALAMITY_TERMS.test(title)) return 'calamity'
  if (CONFLICT_TERMS.test(title)) return 'geopolitical'
  if (MACRO_EVENT_TERMS.test(title)) return 'macro'
  return null
}

export function isGeopoliticalOrCalamity(title: string): boolean {
  const category = classifyLiveEvent(title)
  return category === 'geopolitical' || category === 'calamity'
}

function severityAdjustedScore(title: string, category: LiveEvent['category'], severity?: number): number {
  if (severity !== undefined) {
    const normalized = clamp(severity, 1, 10)
    const magnitude = (category === 'geopolitical' ? 0.9 + normalized * 0.24 : 0.35 + normalized * 0.26)
    const deEscalation = category === 'geopolitical' && /ceasefire|peace deal|peace talks|de.escalat|truce|withdrawal/i.test(title)
    const liquidityOverride = category === 'geopolitical' && LIQUIDITY_TERMS.test(title)
    const direction = deEscalation || liquidityOverride ? -1 : 1
    return Math.round(clamp(magnitude * direction, -3, 3) * 10) / 10
  }
  const base = scoreHeadline(title).score
  if (category === 'calamity') {
    const major = MAJOR_EVENT_TERMS.test(title)
    const catastrophic = /catastroph|mass.casualt|magnitude\s*[7-9]|state of emergency/i.test(title)
    return Math.round(clamp((base || 0.55) + (major ? 1.5 : 0) + (catastrophic ? 0.35 : 0), -3, 3) * 10) / 10
  }
  if (category === 'geopolitical') {
    const liquidityOverride = LIQUIDITY_TERMS.test(title)
    const deEscalation = /ceasefire|peace deal|peace talks|de.escalat|truce|withdrawal/i.test(title)
    const escalationBoost = !deEscalation && /escalat|airstrike|missile|invasion|blockade|retaliat|cross.border/i.test(title) ? 0.85 : 0
    return Math.round(clamp(base + (liquidityOverride ? 0 : escalationBoost), -3, 3) * 10) / 10
  }
  return base
}

function eventReasoning(title: string, category: LiveEvent['category'], score: number, location: GeoLocation | null): string {
  const locationNote = location
    ? `Headline location mapped to the ${location.label} ${location.precision}; this is a country/region anchor, not an incident coordinate.`
    : 'No country or region could be reliably extracted from the headline, so no map pin is plotted.'
  const condition = category === 'calamity'
    ? 'Calamities can support safe-haven demand, but a localized disaster may be absorbed unless it changes wider risk, supply or inflation expectations.'
    : category === 'geopolitical'
      ? LIQUIDITY_TERMS.test(title)
        ? 'Liquidity stress and forced selling can temporarily outweigh the initial safe-haven bid; dollar/yield moves can reverse the sign.'
        : 'Conflict escalation can add safe-haven demand; the USD, real-yield response and market liquidity can offset that channel.'
      : 'The event is not a direct crisis/calamity classification.'
  const impactStatement = score > 0.15
    ? 'The rules engine maps the headline to an upside risk shock.'
    : score < -0.15
      ? 'The rules engine maps the headline to a downside risk shock.'
      : 'The rules engine finds no directional gold shock from the available words.'
  return `${condition} ${impactStatement} ${locationNote} This is an isolated headline-sensitivity estimate, not a causal or calibrated price forecast.`
}

export function verdictForImpact(impactNprPerTola: number | null, threshold = 2_000): LiveEvent['verdict'] {
  if (impactNprPerTola === null || !Number.isFinite(impactNprPerTola)) return 'unavailable'
  if (Math.abs(impactNprPerTola) < Math.max(1, threshold)) return 'no-impact'
  return impactNprPerTola > 0 ? 'positive' : 'negative'
}

function stableId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function buildEventImpact(input: {
  headline: Pick<MarketHeadline, 'title' | 'source' | 'url' | 'publishedAt'>
  baseXauUsd: number | null
  baseNepalTolaNpr: number | null
  thresholdNpr?: number
  isSimulated?: boolean
  forcedCategory?: LiveEvent['category']
  severity?: number
  locationOverride?: GeoLocation | null
}): LiveEvent | null {
  const category = input.forcedCategory ?? classifyLiveEvent(input.headline.title)
  if (!category || category === 'macro') return null
  const location = input.locationOverride === undefined ? locateHeadline(input.headline.title) : input.locationOverride
  const shockScore = severityAdjustedScore(input.headline.title, category, input.severity)
  // Sensitivity in percent per score point; intentionally bounded and clearly
  // labelled as a scenario overlay rather than a fitted causal relationship.
  const globalImpactPct = Math.round(clamp(shockScore * 0.35, -1.2, 1.2) * 1000) / 1000
  const globalImpactUsd = input.baseXauUsd !== null
    ? Math.round(input.baseXauUsd * globalImpactPct / 100 * 100) / 100
    : null
  const nepalImpactNprPerTola = input.baseNepalTolaNpr !== null
    ? Math.round(input.baseNepalTolaNpr * globalImpactPct / 100)
    : null
  const id = `evt-${stableId(`${input.headline.url}|${input.headline.title}|${input.headline.publishedAt ?? ''}`)}`
  return {
    id,
    title: input.headline.title,
    source: input.headline.source,
    url: input.headline.url,
    publishedAt: input.headline.publishedAt,
    category,
    location,
    shockScore,
    globalImpactPct,
    globalImpactUsd,
    nepalImpactNprPerTola,
    verdict: verdictForImpact(nepalImpactNprPerTola, input.thresholdNpr),
    reasoning: eventReasoning(input.headline.title, category, shockScore, location),
    isSimulated: Boolean(input.isSimulated),
  }
}

export function buildSimulatedEvent(input: {
  title: string
  category: 'geopolitical' | 'calamity'
  location: GeoLocation
  severity: number
  baseXauUsd: number | null
  baseNepalTolaNpr: number | null
  thresholdNpr?: number
}): LiveEvent {
  const headline = {
    title: `SIMULATED · ${input.title.trim()}`,
    source: 'User-run stress scenario',
    url: '',
    publishedAt: new Date().toISOString(),
  }
  return buildEventImpact({
    headline,
    baseXauUsd: input.baseXauUsd,
    baseNepalTolaNpr: input.baseNepalTolaNpr,
    thresholdNpr: input.thresholdNpr,
    isSimulated: true,
    forcedCategory: input.category,
    severity: input.severity,
    locationOverride: input.location,
  })!
}

export function resolveEventOverlay(
  events: LiveEvent[],
  selectedId: string | null,
  simulatedEvent: LiveEvent | null = null,
): { globalImpactPct: number; severeEventException: boolean } {
  const selectedLiveEvent = selectedId
    ? events.find((event) => event.id === selectedId && !event.isSimulated) ?? null
    : null
  const appliedEvents = [simulatedEvent, selectedLiveEvent].filter((event): event is LiveEvent => Boolean(event))
  return {
    globalImpactPct: appliedEvents.reduce((sum, event) => sum + event.globalImpactPct, 0),
    // Only an explicitly selected/simulated severe event can lift the usual ATR cap.
    severeEventException: appliedEvents.some((event) => Math.abs(event.shockScore) >= 2.5 && event.globalImpactPct !== 0),
  }
}

export function formatEventVerdict(event: LiveEvent, thresholdNpr: number): string {
  if (event.nepalImpactNprPerTola === null) return 'IMPACT UNAVAILABLE · FX/local basis missing'
  if (Math.abs(event.nepalImpactNprPerTola) < thresholdNpr) {
    return `NO IMPACT · Absorbed by market · ${event.nepalImpactNprPerTola > 0 ? '+' : event.nepalImpactNprPerTola < 0 ? '−' : ''}Rs ${Math.abs(event.nepalImpactNprPerTola).toLocaleString('en-IN')}/tola < Rs ${thresholdNpr.toLocaleString('en-IN')}`
  }
  const sign = event.nepalImpactNprPerTola > 0 ? '+' : '−'
  return `YES: ${sign}NPR ${Math.abs(event.nepalImpactNprPerTola).toLocaleString('en-IN')}/Tola`
}
