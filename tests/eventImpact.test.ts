import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEventImpact,
  buildSimulatedEvent,
  classifyLiveEvent,
  formatEventVerdict,
  resolveEventOverlay,
  verdictForImpact,
} from '../lib/eventImpact'
import {
  calculateScenarioForecast,
  defaultScenarioInput,
} from '../lib/goldEngine'
import type { MetricQuote, QuantForecast } from '../lib/types'

const baseHeadline = {
  source: 'Test News',
  url: 'https://example.test/story',
  publishedAt: '2026-10-25T10:00:00.000Z',
}

test('live crisis and calamity headlines are classified while unrelated headlines are excluded', () => {
  assert.equal(classifyLiveEvent('Armed conflict escalates in Ukraine'), 'geopolitical')
  assert.equal(classifyLiveEvent('Major earthquake damages homes in Nepal'), 'calamity')
  assert.equal(classifyLiveEvent('Federal Reserve signals a rate decision'), 'macro')
  assert.equal(classifyLiveEvent('Gold prices edge higher in quiet trade'), null)
})

test('each live crisis event has a named anchor, directional verdict and reasoning', () => {
  const event = buildEventImpact({
    headline: { ...baseHeadline, title: 'Armed conflict escalates in Ukraine after missile attack' },
    baseXauUsd: 4_000,
    baseNepalTolaNpr: 280_000,
  })
  assert.ok(event)
  assert.equal(event.location?.label, 'Ukraine')
  assert.equal(event.verdict, 'positive')
  assert.ok(event.globalImpactUsd !== null && event.globalImpactUsd > 0)
  assert.ok(event.nepalImpactNprPerTola !== null && event.nepalImpactNprPerTola >= 2_000)
  assert.match(event.reasoning, /safe-haven/i)
  assert.match(event.reasoning, /not an incident coordinate/i)
  assert.match(formatEventVerdict(event, 2_000), /^YES: \+NPR/)
})

test('threshold verdicts distinguish an absorbed move from up/down impact and missing basis', () => {
  assert.equal(verdictForImpact(1_999, 2_000), 'no-impact')
  assert.equal(verdictForImpact(2_000, 2_000), 'positive')
  assert.equal(verdictForImpact(-2_500, 2_000), 'negative')
  assert.equal(verdictForImpact(null, 2_000), 'unavailable')
})

test('simulated crisis is explicitly labelled, uses the selected anchor and crosses the alarm when severe', () => {
  const event = buildSimulatedEvent({
    title: 'Cross-border military escalation',
    category: 'geopolitical',
    location: { id: 'ukraine', label: 'Ukraine', region: 'Eastern Europe', x: 543, y: 125, precision: 'country anchor' },
    severity: 10,
    baseXauUsd: 4_000,
    baseNepalTolaNpr: 280_000,
    thresholdNpr: 2_000,
  })
  assert.equal(event.isSimulated, true)
  assert.match(event.title, /^SIMULATED ·/)
  assert.equal(event.location?.label, 'Ukraine')
  assert.equal(event.verdict, 'positive')
  assert.ok((event.nepalImpactNprPerTola ?? 0) >= 2_000)
  assert.match(event.source, /stress scenario/i)
})

test('simulated event percentage is included in the transparent forecast overlay', () => {
  const quote = (value: number): MetricQuote => ({
    value, previous: value, change: 0, changePct: 0, unit: 'NPR/USD', source: 'Test',
    asOf: null, rateDate: null, stale: false,
  })
  const forecast: QuantForecast = {
    currentXauUsd: 4_000, predictedXauUsd: 4_020, changeUsd: 20, changePct: 0.5,
    rangeLow: 3_980, rangeHigh: 4_060, atr14Usd: 40, confidencePct: 60,
    confidenceLabel: 'Uncalibrated', method: 'Test fixture',
  }
  const base = {
    market: {
      spot: 4_000,
      indicators: null,
      localSpreadPct: 5,
      localSpreadSamples: 5,
      nepal: { rate24kTola: 280_000 },
      macro: { nrbUsdNprSell: quote(150), usdNprSpot: quote(150), usdNprParity: quote(150) },
    },
    forecast,
    analysisScores: { geopolitical: 0, macroYield: 0, technical: 0 },
    headlineScore: 0,
  }
  const result = calculateScenarioForecast(base, defaultScenarioInput(150), 0, 0.75)
  assert.ok(result)
  assert.equal(result.contributions.eventOverlayPct, 0.75)
  assert.equal(result.contributions.totalScenarioPct, 0.75)
  assert.equal(result.global.changePct, 1.25)
  assert.equal(result.global.predictedXauUsd, 4_050)
  assert.ok(result.nepal)
})

test('a selected map event is applied to the forecast overlay and can explicitly bypass the normal ATR cap when severe', () => {
  const event = buildEventImpact({
    headline: { ...baseHeadline, title: 'Severe missile escalation in Ukraine' },
    baseXauUsd: 4_000,
    baseNepalTolaNpr: 280_000,
    severity: 10,
  })
  assert.ok(event)
  const overlay = resolveEventOverlay([event], event.id, null)
  assert.equal(overlay.globalImpactPct, event.globalImpactPct)
  assert.equal(overlay.severeEventException, true)
  assert.equal(resolveEventOverlay([event], null, null).globalImpactPct, 0)

  const quote = (value: number): MetricQuote => ({
    value, previous: value, change: 0, changePct: 0, unit: 'NPR/USD', source: 'Test',
    asOf: null, rateDate: null, stale: false,
  })
  const forecast: QuantForecast = {
    currentXauUsd: 4_000, predictedXauUsd: 4_020, changeUsd: 20, changePct: 0.5,
    rangeLow: 3_980, rangeHigh: 4_060, atr14Usd: 40, confidencePct: 60,
    confidenceLabel: 'Uncalibrated', method: 'Test fixture',
  }
  const base = {
    market: {
      spot: 4_000,
      indicators: null,
      localSpreadPct: 5,
      localSpreadSamples: 5,
      nepal: { rate24kTola: 280_000 },
      macro: { nrbUsdNprSell: quote(150), usdNprSpot: quote(150), usdNprParity: quote(150) },
    },
    forecast,
    analysisScores: { geopolitical: 0, macroYield: 0, technical: 0 },
    headlineScore: 0,
  }
  const forecastWithMapEvent = calculateScenarioForecast(base, defaultScenarioInput(150), 0, overlay.globalImpactPct, overlay.severeEventException)
  assert.ok(forecastWithMapEvent)
  assert.equal(forecastWithMapEvent.contributions.eventOverlayPct, overlay.globalImpactPct)
  assert.equal(forecastWithMapEvent.severeEventException, true)
})
