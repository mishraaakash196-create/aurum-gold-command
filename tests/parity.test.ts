import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateAnchoredNepalForecast, calculateImportParity, calculateTejabiRatio } from '@/engine/parity'
import { TOLA_GRAMS, TROY_OUNCE_GRAMS } from '@/lib/goldEngine'

test('configurable import parity applies duty, other levy, dealer margin and learned spread then rounds to Rs 100', () => {
  const result = calculateImportParity({
    spotXauUsd: 3000, usdNpr: 150,
    customsDutyPct: 15, vatOtherLevyPct: 2, dealerMarginPct: 3, rollingSpreadPct: 4,
    today24kTola: 250_000,
  })
  assert.ok(result)
  const expected = (3000 / TROY_OUNCE_GRAMS) * 150 * TOLA_GRAMS * 1.15 * 1.02 * 1.03 * 1.04
  assert.ok(Math.abs(result.exact24kTolaNpr - expected) < 1e-8)
  assert.equal(result.predicted24kTolaNpr, Math.round(expected / 100) * 100)
  assert.equal(result.predicted22kTolaNpr, Math.round(expected * 0.9167 / 100) * 100)
  assert.equal(result.dealerMarginPct, 3)
  assert.equal(result.expectedChangeTolaNpr, result.predicted24kTolaNpr - 250_000)
})

test('parity rejects invalid spot and bounds FX pass-through', () => {
  assert.equal(calculateImportParity({ spotXauUsd: 0, usdNpr: 150, customsDutyPct: 15, vatOtherLevyPct: 1, dealerMarginPct: 0, rollingSpreadPct: 0 }), null)
  const result = calculateImportParity({ spotXauUsd: 3000, usdNpr: 150, customsDutyPct: 15, vatOtherLevyPct: 1, dealerMarginPct: 0, rollingSpreadPct: 0, usdNprMovePct: 2 })
  assert.equal(result?.fxMovePct, 0.5)
  assert.ok(Math.abs((result?.fxRate ?? 0) - 150.75) < 1e-10)
})

test('learns Tejabi ratio from the latest seven paired official observations without inventing data', () => {
  const observations = Array.from({ length: 9 }, (_, index) => {
    const date = `2026-10-${String(index + 1).padStart(2, '0')}`
    const rate24kTolaNpr = 280_000 + index * 100
    const ratio = index < 2 ? 0.98 : 280_800 / 283_200
    return { date, rate24kTolaNpr, tejabiTolaNpr: rate24kTolaNpr * ratio, source: 'FENEGOSIDA', observedAt: `${date}T05:00:00.000Z` }
  })
  const learned = calculateTejabiRatio(observations, 0.9, null)
  assert.equal(learned.source, 'learned')
  assert.equal(learned.sampleCount, 7)
  const observed24k = 283_200
  const observedTejabi = 280_800
  const calculatedTejabi = Math.round(observed24k * learned.ratio / 100) * 100
  assert.ok(Math.abs(calculatedTejabi - observedTejabi) <= 100)
  assert.equal(learned.lastUpdatedAt, observations.at(-1)?.observedAt)
})

test('uses editable manual Tejabi ratio when there are no actual source pairs', () => {
  const state = calculateTejabiRatio([], 280_800 / 283_200, '2026-10-28T04:00:00.000Z')
  assert.equal(state.source, 'manual')
  assert.equal(state.sampleCount, 0)
  assert.equal(state.ratio, 280_800 / 283_200)
  assert.equal(state.lastUpdatedAt, '2026-10-28T04:00:00.000Z')
})

test('Nepal forecast anchors to official FENEGOSIDA rate and applies predicted spot and FX moves', () => {
  const official = 283_200
  const result = calculateAnchoredNepalForecast({
    spotXauUsd: 3000,
    usdNpr: 150,
    customsDutyPct: 15,
    vatOtherLevyPct: 1,
    dealerMarginPct: 0,
    rollingSpreadPct: 2,
    spreadSampleCount: 12,
    today24kTola: official,
    official24kTolaNpr: official,
    officialRateDate: '2026-10-28',
    currentXauUsd: 3000,
    predictedXauUsd: 3000 * (1 - 0.0013),
    usdNprMovePct: 0.1,
  })
  assert.ok(result)
  assert.equal(result.usedOfficialAnchor, true)
  assert.equal(result.official24kAnchorNpr, official)
  assert.ok((result.spotMovePct ?? 0) < 0)
  assert.ok((result.fxAdjustmentNpr ?? 0) > 0)
  assert.equal(result.expectedChangeTolaNpr, result.predicted24kTolaNpr - official)
  assert.ok(Math.abs(result.exact24kTolaNpr - official * (1 - 0.0013) * 1.001) < 1e-8)
  assert.notEqual(result.unanchoredImportParity24kNpr, official)
})
