import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStorageBackup } from '@/data/backup'

const validBackup = () => ({
  format: 'aurum-storage-backup',
  version: 1,
  exportedAt: '2026-10-29T00:00:00.000Z',
  documents: {
    'aurum-alarm-settings.json': JSON.stringify({ thresholdNprPerTola: 2_000, enabled: true, muted: false, updatedAt: null }),
    'aurum-settings.json': JSON.stringify({ customsDutyPct: 15, vatOtherLevyPct: 1, dealerMarginPct: 0, tejabiManualRatio: 0.9915 }),
  },
  streams: {
    'aurum-predictions.jsonl': [JSON.stringify({ type: 'prediction', entry: { id: 'p1', createdAt: '2026-10-28T10:00:00.000Z' } })],
    'aurum-tejabi-observations.jsonl': [JSON.stringify({ date: '2026-10-28', rate24kTolaNpr: 300_000, tejabiTolaNpr: 297_450, source: 'FENEGOSIDA', observedAt: '2026-10-28T05:15:00.000Z' })],
  },
})

test('backup restore validator accepts an allowed versioned data export', () => {
  const result = validateStorageBackup(validBackup())
  assert.equal(result.valid, true)
  if (result.valid) assert.equal(result.backup.version, 1)
})

test('backup restore validator rejects unknown paths, malformed event lines, and out-of-range settings', () => {
  const input = validBackup() as any
  input.documents['../../secrets.json'] = '{"key":"value"}'
  input.documents['aurum-alarm-settings.json'] = JSON.stringify({ thresholdNprPerTola: 9, enabled: true, muted: false })
  input.streams['aurum-predictions.jsonl'] = ['not json']
  const result = validateStorageBackup(input)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.ok(result.errors.some((item) => item.includes('Unknown storage document')))
    assert.ok(result.errors.some((item) => item.includes('Invalid or malformed document')))
    assert.ok(result.errors.some((item) => item.includes('Malformed event record')))
  }
})

test('backup restore validator rejects unsupported versions without producing a partial restore payload', () => {
  const input = validBackup() as any
  input.version = 2
  const result = validateStorageBackup(input)
  assert.equal(result.valid, false)
})
