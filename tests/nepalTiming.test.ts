import test from 'node:test'
import assert from 'node:assert/strict'
import { getNepalFixingTiming } from '@/engine/nepalTiming'

test('fixing timing stays in last-minute mode before 11:00 NPT then switches to overnight', () => {
  const before = getNepalFixingTiming(new Date('2026-10-28T04:00:00.000Z'))
  assert.equal(before.mode, 'last-minute')
  assert.equal(before.targetDate, '2026-10-28')
  assert.equal(before.targetAt, '2026-10-28T05:15:00.000Z')
  const after = getNepalFixingTiming(new Date('2026-10-28T06:00:00.000Z'))
  assert.equal(after.mode, 'overnight')
  assert.equal(after.targetDate, '2026-10-29')
})

test('Saturday closures and configured public holidays roll to the next open fixing day', () => {
  const timing = getNepalFixingTiming(new Date('2026-10-31T01:00:00.000Z'), ['2026-11-01'])
  assert.equal(timing.mode, 'overnight')
  assert.equal(timing.targetDate, '2026-11-02')
  assert.match(timing.closureNote ?? '', /Saturday closure/)
})
