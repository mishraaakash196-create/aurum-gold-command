import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFixingWindowAudit, previousFixingTimestamp, resolveTargetSpotObservation, targetSpotTimestamp } from '@/engine/fixingWindow'

test('fixing window uses 11:00 AM NPT reference and 10:45 AM NPT target, skipping Saturday and holidays', () => {
  assert.equal(previousFixingTimestamp('2026-06-08'), '2026-06-07T05:15:00.000Z') // Sunday is an open day in the app calendar.
  assert.equal(previousFixingTimestamp('2026-06-08', ['2026-06-07']), '2026-06-05T05:15:00.000Z')
  assert.equal(targetSpotTimestamp('2026-06-08T05:15:00.000Z'), '2026-06-08T05:00:00.000Z')
})

test('fixing timestamps retain exact source quote times and mark out-of-window references approximate', () => {
  const target = '2026-06-08T05:15:00.000Z'
  const audit = buildFixingWindowAudit({
    targetDate: '2026-06-08', targetAt: target, now: '2026-06-08T04:30:00.000Z',
    currentSpot: { value: 3300, observedAt: '2026-06-08T04:25:00.000Z', source: 'XAUS current quote' },
    historicalSpots: [{ value: 3290, observedAt: '2026-06-07T05:13:00.000Z', source: 'XAUS observed quote' }],
  })
  assert.equal(audit.previousFixingTargetAt, '2026-06-07T05:15:00.000Z')
  assert.equal(audit.targetObservationTargetAt, '2026-06-08T05:00:00.000Z')
  assert.equal(audit.startObservation?.precision, 'exact')
  assert.equal(audit.startObservation?.observedAt, '2026-06-07T05:13:00.000Z')
  const approximate = buildFixingWindowAudit({
    targetDate: '2026-06-08', targetAt: target, now: '2026-06-08T04:30:00.000Z',
    currentSpot: { value: 3300, observedAt: '2026-06-08T04:25:00.000Z', source: 'XAUS current quote' }, historicalSpots: [],
  })
  assert.equal(approximate.status, 'approximate-window')
  assert.match(approximate.note, /approximate-window/)
})

test('target quote selection prefers observed snapshots and labels daily close fallback approximate', () => {
  const target = '2026-06-08T05:00:00.000Z'
  const exact = resolveTargetSpotObservation([{ value: 3299, observedAt: '2026-06-08T04:58:00.000Z', source: 'XAUS spot quote' }], target)
  assert.equal(exact?.precision, 'exact')
  assert.equal(exact?.observedAt, '2026-06-08T04:58:00.000Z')
  const fallback = resolveTargetSpotObservation([], target, { date: '2026-06-08', timestamp: Date.parse('2026-06-08T00:00:00Z') / 1000, open: 3290, high: 3310, low: 3280, close: 3300, volume: null })
  assert.equal(fallback?.precision, 'approximate-window')
  assert.match(fallback?.note ?? '', /not a 10:45 quote/)
})
