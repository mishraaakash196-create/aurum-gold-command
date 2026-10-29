import { clamp } from './goldEngine'
import type { Impact, MarketHeadline } from './types'

const SAFE_HAVEN = /war|armed conflict|conflict|military strike|missile|invasion|attack|blockade|hostilities|escalat|troops|airstrike|sanction|geopolitical risk|middle east|red sea|taiwan strait|ukraine|iran|israel|russia/i
const DE_ESCALATION = /ceasefire|peace deal|peace talks|de-escalat|truce|withdrawal|diplomatic breakthrough|conflict ends/i
const LIQUIDITY_STRESS = /margin call|liquidity crunch|forced selling|liquidat|equity selloff|cash scramble|margin requirement/i
const HAWKISH = /hawkish|higher for longer|rate hike|rates stay high|yield(s)? (surge|rise|jump|climb)|real yield(s)? (rise|increase)|strong(er)? dollar|dxy (rises|gains|surges|jumps)|fed (warns|signals higher|holds rates)/i
const DOVISH = /dovish|rate cut|cuts rates|yield(s)? (fall|drop|ease|retreat)|real yield(s)? (fall|drop|ease)|weaker dollar|dxy (falls|drops|slides)|fed (eases|signals cuts|pivots)/i
const CENTRAL_BANK_BUYING = /central bank(s)? (buy|purchas|add)|gold reserve(s)? (rise|buy|purchase)|reserve diversification|official sector buying/i
const NATURAL_CALAMITY = /earthquake|quake|tsunami|volcan|eruption|cyclone|hurricane|typhoon|flood|wildfire|landslide|avalanche|drought|heatwave|heat wave|storm surge|natural disaster|calamity/i
const INFLATION = /inflation (accelerat|hotter|surge|rise|sticky)|cpi (beats|hot)|inflation hedge/i

export interface HeadlineSignal {
  score: number
  impact: Impact
  reasoning: string
}

/**
 * Small, auditable rules-based headline scorer used only as a fallback and for
 * user-entered what-if text. It is not presented as an LLM sentiment result.
 */
export function scoreHeadline(title: string): HeadlineSignal {
  const text = title.trim()
  if (!text) return { score: 0, impact: 'NEUTRAL', reasoning: 'No headline supplied.' }
  let score = 0
  const reasons: string[] = []

  if (SAFE_HAVEN.test(text)) {
    score += 1.5
    reasons.push('Escalation can attract initial safe-haven allocation into bullion.')
  }
  if (DE_ESCALATION.test(text)) {
    score -= 1.2
    reasons.push('De-escalation can unwind some near-term safe-haven premium.')
  }
  if (LIQUIDITY_STRESS.test(text)) {
    score -= 1.8
    reasons.push('Cash demand or margin calls can trigger a temporary cross-asset gold liquidation.')
  }
  if (HAWKISH.test(text)) {
    score -= 1.2
    reasons.push('Higher real-rate / dollar pressure raises the opportunity cost of non-yielding gold.')
  }
  if (DOVISH.test(text)) {
    score += 1.2
    reasons.push('Lower yield / dollar language is directionally supportive for bullion.')
  }
  if (CENTRAL_BANK_BUYING.test(text)) {
    score += 1.1
    reasons.push('Official-sector accumulation can add a structural source of demand.')
  }
  if (NATURAL_CALAMITY.test(text)) {
    score += 0.45
    reasons.push('A major calamity can create short-lived safe-haven demand, but localized events may be absorbed without a persistent bullion repricing.')
  }
  if (INFLATION.test(text)) {
    score += 0.45
    reasons.push('Inflation-hedge demand may help, conditional on the real-yield response.')
  }

  const normalizedScore = Math.round(clamp(score, -3, 3) * 10) / 10
  return {
    score: normalizedScore,
    impact: normalizedScore > 0.25 ? 'BULLISH' : normalizedScore < -0.25 ? 'BEARISH' : 'NEUTRAL',
    reasoning: reasons.length
      ? reasons.join(' ')
      : 'No high-confidence gold macro keywords matched; the rules-based fallback assigns a neutral impact.',
  }
}

export function sentimentForHeadline(title: string): MarketHeadline {
  const signal = scoreHeadline(title)
  return {
    title,
    source: 'Rules-based headline classifier',
    url: '',
    publishedAt: null,
    sentimentScore: signal.score,
    impact: signal.impact,
    reasoning: signal.reasoning,
  }
}

export function aggregateGeopoliticalScore(headlines: MarketHeadline[]): number {
  if (!headlines.length) return 0
  const weighted = headlines.slice(0, 12).map((headline) => headline.sentimentScore)
  const average = weighted.reduce((sum, value) => sum + value, 0) / weighted.length
  return Math.round(clamp(average * 3.2, -10, 10) * 10) / 10
}
