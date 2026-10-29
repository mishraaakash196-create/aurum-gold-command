import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseImfGoldReserves,
  parseWgcCentralBankReport,
  parseWgcEtfFlowReport,
} from '../lib/institutionalData'

const NOW = new Date('2026-10-28T00:00:00.000Z')

test('WGC central-bank report parses monthly and YTD buyer totals with lagged reported provenance', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Central Bank Gold Statistics: central banks continue summer spree in August">
    <meta name="description" content="Global central banks reported net buying totalling 39t">
    </head><body>
    <p>6 October 2026. Data to 31 August 2026, where available. Reported net buying totalling 39t.</p>
    <p>On a y-t-d basis, central banks have reported total purchases of 170t.</p>
    <ul>
      <li>National Bank of Poland added 8t purchased in August. Poland y-t-d purchases reached 98t so far this year.</li>
      <li>People's Bank of China bought 20t in August, with 80t year-to-date.</li>
      <li>National Bank of Kazakhstan bought 7t in August and added 36t y-t-d.</li>
      <li>Central Bank of Russia sold 6t in August. Russia has sold 56t y-t-d, with total gold holdings now at 2,271t.</li>
      <li>Central Bank of Türkiye sold 3t in August and reported net sales of 82t year-to-date.</li>
    </ul>
    <div>${'Published report methodology and reported activity. '.repeat(28)}</div>
    </body></html>`
  const report = parseWgcCentralBankReport(html, 'https://www.gold.org/example', NOW)
  assert.ok(report)
  assert.equal(report?.provenance, 'reported')
  assert.equal(report?.period, '2026-08')
  assert.equal(report?.netPurchasesTonnes, 39)
  assert.equal(report?.ytdPurchasesTonnes, 170)
  assert.equal(report?.stale, false)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'POL')?.monthlyTonnes, 8)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'POL')?.ytdTonnes, 98)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'CHN')?.monthlyTonnes, 20)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'KAZ')?.monthlyTonnes, 7)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'KAZ')?.ytdTonnes, 36)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'RUS')?.ytdTonnes, -56)
  assert.equal(report?.purchases.find((item) => item.countryCode === 'TUR')?.ytdTonnes, -82)
  assert.equal(report?.purchases.some((item) => item.countryCode === 'BRA'), false)
})

test('WGC ETF report captures global flow and holdings change without making it real-time', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Gold ETF Flows: September 2026">
    </head><body>
    <p>Published: 7 October, 2026</p>
    <p>Global physically-backed gold ETFs attracted US$10bn in September, capping a record quarter. Global holdings rose 67t to a record.</p>
    <div>${'Monthly fund flows are reported by the World Gold Council with a publication lag. '.repeat(20)}</div>
    </body></html>`
  const report = parseWgcEtfFlowReport(html, 'https://www.gold.org/etf/example', NOW)
  assert.ok(report)
  assert.equal(report?.provenance, 'reported')
  assert.equal(report?.period, '2026-09')
  assert.equal(report?.netFlowUsdBn, 10)
  assert.equal(report?.holdingsChangeTonnes, 67)
  assert.equal(report?.stale, false)
  assert.match(report?.note ?? '', /lag/)
})

test('IMF IRFCL monthly stocks convert fine troy ounces to tonnes and isolate implausible jumps', () => {
  const csv = [
    'COUNTRY,TIME_PERIOD,OBS_VALUE',
    'USA,2026-M06,260000000',
    'USA,2026-M07,261499000',
    'CHN,2026-M07,76730000',
    'CHN,2026-M08,76730000',
    'IND,2026-M07,28300000',
    'IND,2026-M08,28309311',
    'POL,2026-M07,20500000',
    'POL,2026-M08,20833000',
    'KAZ,2026-M07,11900000',
    'KAZ,2026-M08,12124366',
    'BRA,2026-M07,5500000',
    'BRA,2026-M08,5500000000',
  ].join('\n')
  const reserves = parseImfGoldReserves(csv, NOW)
  const byCode = (code: string) => reserves.find((item) => item.countryCode === code)
  assert.ok(Math.abs((byCode('USA')?.tonnes ?? 0) - 8133.5) < 1)
  assert.ok(Math.abs((byCode('CHN')?.tonnes ?? 0) - 2387.4) < 1)
  assert.ok(Math.abs((byCode('IND')?.tonnes ?? 0) - 880.4) < 1)
  assert.ok(Math.abs((byCode('POL')?.tonnes ?? 0) - 648.1) < 1)
  assert.equal(byCode('USA')?.changeTonnes !== null, true)
  assert.equal(byCode('USA')?.asOf, '2026-07')
  assert.equal(byCode('BRA')?.anomalyDetected, true)
  assert.ok((byCode('BRA')?.tonnes ?? 0) < 200)
  assert.equal(byCode('BRA')?.stale, false)
  assert.match(byCode('BRA')?.note ?? '', /anomaly/)
})

test('IMF parser returns no fictional reserves for an empty or malformed feed', () => {
  assert.deepEqual(parseImfGoldReserves('', NOW), [])
  assert.deepEqual(parseImfGoldReserves('COUNTRY,TIME_PERIOD\nUSA,2026-M08', NOW), [])
})
