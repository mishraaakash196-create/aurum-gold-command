import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { exportStorageBackup, getStorageHealth, readStoredText, restoreStorageBackup, writeStoredText, appendStoredText, configuredStorageBackend, hasPartialTursoConfiguration } from '@/data/storage'
import { validateStorageBackup } from '@/data/backup'

const priorEnv = { dataDir: process.env.AURUM_DATA_DIR, persistent: process.env.AURUM_STORAGE_PERSISTENT, tursoUrl: process.env.TURSO_DATABASE_URL, tursoToken: process.env.TURSO_AUTH_TOKEN }
let directory = ''

test('storage adapter uses local JSON documents and append-only event streams and exports/restores a validated backup', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'aurum-storage-'))
  process.env.AURUM_DATA_DIR = directory
  process.env.AURUM_STORAGE_PERSISTENT = 'true'
  delete process.env.TURSO_DATABASE_URL
  delete process.env.TURSO_AUTH_TOKEN

  assert.equal(configuredStorageBackend(), 'local-json')
  await writeStoredText('aurum-settings.json', JSON.stringify({ customsDutyPct: 15 }))
  await appendStoredText('aurum-predictions.jsonl', `${JSON.stringify({ type: 'prediction', entry: { id: 'test-row', createdAt: '2026-01-01T00:00:00Z' } })}\n`)
  assert.equal(await readStoredText(path.join(directory, 'aurum-settings.json')), JSON.stringify({ customsDutyPct: 15 }))
  assert.match(await readStoredText('aurum-predictions.jsonl') ?? '', /test-row/)

  const health = await getStorageHealth()
  assert.equal(health.backend, 'local-json')
  assert.equal(health.writable, true)
  assert.equal(health.ephemeral, false)

  const exported = await exportStorageBackup()
  const validated = validateStorageBackup(exported)
  assert.equal(validated.valid, true)
  if (!validated.valid) return
  await writeStoredText('aurum-settings.json', JSON.stringify({ customsDutyPct: 25 }))
  await restoreStorageBackup(validated.backup)
  assert.deepEqual(JSON.parse((await readStoredText('aurum-settings.json'))!), { customsDutyPct: 15 })
  assert.match(await readStoredText('aurum-predictions.jsonl') ?? '', /test-row/)
})

test('partial Turso configuration is identified but does not silently select the Turso backend', () => {
  process.env.TURSO_DATABASE_URL = 'libsql://example.invalid'
  delete process.env.TURSO_AUTH_TOKEN
  assert.equal(hasPartialTursoConfiguration(), true)
  assert.equal(configuredStorageBackend(), 'local-json')
})

test.after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  if (priorEnv.dataDir === undefined) delete process.env.AURUM_DATA_DIR; else process.env.AURUM_DATA_DIR = priorEnv.dataDir
  if (priorEnv.persistent === undefined) delete process.env.AURUM_STORAGE_PERSISTENT; else process.env.AURUM_STORAGE_PERSISTENT = priorEnv.persistent
  if (priorEnv.tursoUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = priorEnv.tursoUrl
  if (priorEnv.tursoToken === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = priorEnv.tursoToken
})
