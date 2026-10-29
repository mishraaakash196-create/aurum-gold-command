import test from 'node:test'
import assert from 'node:assert/strict'
import { macroInputsFromMarket } from '../lib/forecast'
import type { InstitutionalDemandSnapshot, MarketSnapshot, MetricQuote } from '../lib/types'

function quote(value: number | null, change: number | null, changePct: number | null, stale = false): MetricQuote {
  return { value, previous: null, change, changePct, unit: 'test', source: 'fixture', asOf: '2026-10-28T00:00:00.000Z', stale }
}

function institutional(centralStale = false, etfStale = false): InstitutionalDemandSnapshot {
  return {
    generatedAt: '2026-10-28T00:00:00.000Z',
    status: 'reported',
    centralBank: {
      provenance: 'reported', source: 'WGC test', url: 'https://example.test/cb', publishedAt: '2026-10-01T00:00:00.000Z',
      period: '2026-09', netPurchasesTonnes: 20, ytdPurchasesTonnes: 70, purchases: [], stale: centralStale, note: 'monthly',
    },
    goldEtf: {
      provenance: 'reported', source: 'WGC ETF test', url: 'https://example.test/etf', publishedAt: '2026-10-01T00:00:00.000Z',
      period: '2026-09', netFlowUsdBn: 5, holdingsChangeTonnes: 12, stale: etfStale, note: 'monthly',
    },
    goldReserves: [],
    note: 'reported fixture',
  }
}

function marketFixture(stale = false, demandStale = false): Pick<MarketSnapshot, 'macro' | 'institutionalDemand'> {
  return {
    macro: {
      dxy: quote(100, 0.2, 0.2, stale),
      usdNprSpot: quote(150, 0.1, 0.1, stale),
      usdNprTrend: quote(150, 0.1, 0.1, stale),
      usdNprParity: quote(150, 0.1, 0.1, stale),
      nrbUsdNprBuy: quote(149, null, null, true),
      nrbUsdNprSell: quote(151, null, null, true),
      usdInr: quote(84, 0.2, 0.2, stale),
      nominal10y: quote(4, 0.02, null, stale),
      real10y: quote(2, -0.01, null, stale),
      fedFundsFutures: quote(96, 0.05, null, stale),
      brent: quote(75, 0.5, 0.7, stale),
    },
    institutionalDemand: institutional(demandStale, demandStale),
  }
}

test('only fresh macro observations enter the bounded XAU overlay; real yield takes precedence', () => {
  const fresh = macroInputsFromMarket(marketFixture())
  assert.equal(fresh.dxyChangePct, 0.2)
  assert.equal(fresh.real10yChangePp, -0.01)
  assert.equal(fresh.nominal10yChangePp, null)
  assert.equal(fresh.fedFundsFuturesChange, 0.05)
  assert.equal(fresh.etfFlowUsdBn, 5)
  assert.equal(fresh.centralBankNetPurchasesTonnes, 20)

  const stale = macroInputsFromMarket(marketFixture(true, true))
  assert.equal(stale.dxyChangePct, null)
  assert.equal(stale.real10yChangePp, null)
  assert.equal(stale.nominal10yChangePp, null)
  assert.equal(stale.fedFundsFuturesChange, null)
  assert.equal(stale.etfFlowUsdBn, null)
  assert.equal(stale.centralBankNetPurchasesTonnes, null)
})
