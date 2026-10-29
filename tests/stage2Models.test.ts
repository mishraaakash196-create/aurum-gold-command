import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyEnsembleToForecast, fitRidgeEnsemble, getHeuristicModel, predictEnsemblePct, type EnsembleTrainingRow } from '@/engine/ensemble'
import { calculateEventRiskAdjustment, widenForecastForEvents } from '@/engine/eventRisk'
import { seasonalityFromBsDate } from '@/engine/seasonality'
import type { MacroCalendarEvent, QuantForecast } from '@/lib/types'

describe('Stage 2 ensemble, event risk, and calendar proxy', () => {
  it('fits ridge weights from lagged logged outcomes and reports insufficient data honestly', () => {
    const logged: EnsembleTrainingRow[] = Array.from({ length: 40 }, (_, i) => {
      const technical = (i % 9 - 4) / 4
      return { features: { technical }, targetPct: technical * 1.7 + 0.08, source: 'logged-actual' }
    })
    const backtest: EnsembleTrainingRow[] = Array.from({ length: 45 }, (_, i) => {
      const technical = (i % 11 - 5) / 5
      return { features: { technical }, targetPct: technical * 1.4, source: 'technical-backtest' }
    })
    const learned = fitRidgeEnsemble(logged, backtest, '2026-10-28T00:00:00.000Z', 0.1)
    assert.equal(learned.mode, 'ridge-learned')
    assert.ok(learned.weights.technical > 0.5)
    assert.ok(predictEnsemblePct({ technical: 1 }, learned) > 0.5)
    const fallback = fitRidgeEnsemble(logged.slice(0, 10), backtest.slice(0, 12))
    assert.equal(fallback.mode, 'heuristic-fallback')
    assert.match(fallback.note, /minimum 25 logged outcomes/)
  })

  it('widens the forecast range and lowers confidence before a high-impact release', () => {
    const now = new Date('2026-10-28T10:00:00.000Z')
    const event: MacroCalendarEvent = {
      id: 'cpi-test', kind: 'CPI', title: 'CPI release', startsAt: '2026-10-28T11:00:00.000Z',
      timeZone: 'America/New_York', source: 'Test calendar', sourceUrl: 'https://example.test', highImpact: true,
    }
    const base: QuantForecast = {
      currentXauUsd: 4000, predictedXauUsd: 4010, changeUsd: 10, changePct: 0.25,
      rangeLow: 3960, rangeHigh: 4060, atr14Usd: 50, confidencePct: 70,
      confidenceLabel: 'Medium · uncalibrated', method: 'test',
    }
    const adjusted = widenForecastForEvents(base, calculateEventRiskAdjustment([event], now))
    assert.ok(adjusted.rangeLow < base.rangeLow)
    assert.ok(adjusted.rangeHigh > base.rangeHigh)
    assert.ok(adjusted.confidencePct < base.confidencePct)
    assert.equal(adjusted.predictedXauUsd, base.predictedXauUsd)
  })

  it('uses a conservative all-day window for date-only calendar entries without inventing an event time', () => {
    const event: MacroCalendarEvent = {
      id: 'nfp-date-only', kind: 'NFP', title: 'Employment Situation', startsAt: '2026-10-28T00:00:00.000Z',
      timeZone: null, timePrecision: 'date-only', source: 'BLS', sourceUrl: 'https://example.test', highImpact: true,
    }
    const risk = calculateEventRiskAdjustment([event], new Date('2026-10-28T10:00:00.000Z'))
    assert.equal(risk.activeEvents.length, 1)
    assert.match(risk.note, /without an invented release time/)
  })

  it('marks festival/wedding calendar windows as a proxy and produces a signed index', () => {
    const baseline = seasonalityFromBsDate(2083, 2, 15)
    const dashain = seasonalityFromBsDate(2083, 5, 10)
    assert.ok(dashain.index > baseline.index)
    assert.ok(dashain.signedScorePct > baseline.signedScorePct)
    assert.match(dashain.source, /proxy/)
    assert.ok(dashain.components.some((item) => item.includes('Dashain')))
    assert.ok(getHeuristicModel().weights.technical > 0)
  })

  it('overlays Stage 2 factors on legacy quant only in fallback mode', () => {
    const base: QuantForecast = {
      currentXauUsd: 4000, predictedXauUsd: 4004, changeUsd: 4, changePct: 0.1,
      rangeLow: 3954, rangeHigh: 4054, atr14Usd: 50, confidencePct: 60,
      confidenceLabel: 'Medium', method: 'legacy',
    }
    const out = applyEnsembleToForecast(base, { seasonality: 1 }, getHeuristicModel())
    assert.ok(out.changePct > base.changePct)
    assert.match(out.method, /heuristic Stage 2 factor overlay/)
  })
})
