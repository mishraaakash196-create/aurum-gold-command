import { createClient, type Client } from '@libsql/client'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const STORAGE_DOCUMENTS = [
  'aurum-store.json',
  'aurum-settings.json',
  'aurum-manual-official-rates.json',
  'aurum-official-rate-history.json',
  'aurum-ensemble-model.json',
  'aurum-alarm-settings.json',
] as const
export const STORAGE_STREAMS = ['aurum-predictions.jsonl', 'aurum-tejabi-observations.jsonl'] as const
export type StorageDocument = typeof STORAGE_DOCUMENTS[number]
export type StorageStream = typeof STORAGE_STREAMS[number]
export type StorageBackend = 'turso' | 'local-json'
export interface StorageHealth {
  backend: StorageBackend | 'unavailable'
  writable: boolean
  ephemeral: boolean
  configured: boolean
  warning: string | null
}
export interface StorageBackup {
  format: 'aurum-storage-backup'
  version: 1
  exportedAt: string
  documents: Partial<Record<StorageDocument, string>>
  streams: Partial<Record<StorageStream, string[]>>
}

const globals = globalThis as typeof globalThis & {
  __aurumTursoClient?: Client
  __aurumStorageSchema?: Promise<void>
}

export function configuredStorageBackend(): StorageBackend {
  return process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim() ? 'turso' : 'local-json'
}

export function hasPartialTursoConfiguration(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL?.trim()) !== Boolean(process.env.TURSO_AUTH_TOKEN?.trim())
}

export function storageDirectory() {
  const configured = process.env.AURUM_DATA_DIR?.trim()
  return configured ? path.resolve(/*turbopackIgnore: true*/ configured) : path.join(process.cwd(), '.data')
}
function localPath(name: string) {
  return path.join(/*turbopackIgnore: true*/ storageDirectory(), name)
}
function safeName(filePath: string): StorageDocument | StorageStream {
  const base = path.basename(filePath)
  if ((STORAGE_DOCUMENTS as readonly string[]).includes(base) || (STORAGE_STREAMS as readonly string[]).includes(base)) return base as StorageDocument | StorageStream
  throw new Error(`Unsupported storage key: ${base}`)
}

function tursoClient() {
  if (configuredStorageBackend() !== 'turso') throw new Error('Turso storage is not configured.')
  if (!globals.__aurumTursoClient) {
    globals.__aurumTursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL!.trim(),
      authToken: process.env.TURSO_AUTH_TOKEN!.trim(),
    })
  }
  return globals.__aurumTursoClient
}

export async function initializeStorage(): Promise<void> {
  if (configuredStorageBackend() === 'local-json') {
    await mkdir(storageDirectory(), { recursive: true })
    return
  }
  globals.__aurumStorageSchema ??= (async () => {
    const client = tursoClient()
    await client.execute('CREATE TABLE IF NOT EXISTS aurum_documents (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)')
    await client.execute('CREATE TABLE IF NOT EXISTS aurum_events (id INTEGER PRIMARY KEY AUTOINCREMENT, stream TEXT NOT NULL, line TEXT NOT NULL, created_at TEXT NOT NULL)')
    await client.execute('CREATE INDEX IF NOT EXISTS aurum_events_stream_id_idx ON aurum_events(stream, id)')
  })()
  try { await globals.__aurumStorageSchema } catch (error) { globals.__aurumStorageSchema = undefined; throw error }
}

function streamFrom(name: string): StorageStream {
  if ((STORAGE_STREAMS as readonly string[]).includes(name)) return name as StorageStream
  throw new Error(`Unsupported event stream: ${name}`)
}

export async function readStoredText(filePath: string): Promise<string | null> {
  const name = safeName(filePath)
  if (configuredStorageBackend() === 'turso') await initializeStorage()
  if ((STORAGE_STREAMS as readonly string[]).includes(name)) {
    if (configuredStorageBackend() === 'turso') {
      const result = await tursoClient().execute({ sql: 'SELECT line FROM aurum_events WHERE stream = ? ORDER BY id', args: [name] })
      if (!result.rows.length) return null
      return `${result.rows.map((row) => String(row.line)).join('\n')}\n`
    }
    try { return await readFile(localPath(name), 'utf8') } catch { return null }
  }
  if (configuredStorageBackend() === 'turso') {
    const result = await tursoClient().execute({ sql: 'SELECT value FROM aurum_documents WHERE name = ?', args: [name] })
    return result.rows.length ? String(result.rows[0].value) : null
  }
  try { return await readFile(localPath(name), 'utf8') } catch { return null }
}

export async function writeStoredText(filePath: string, value: string): Promise<void> {
  const name = safeName(filePath)
  await initializeStorage()
  if ((STORAGE_STREAMS as readonly string[]).includes(name)) {
    const stream = streamFrom(name)
    const lines = value.split('\n').filter((line) => line.length > 0)
    if (configuredStorageBackend() === 'turso') {
      const tx = await tursoClient().transaction('write')
      try {
        const now = new Date().toISOString()
        await tx.batch([
          { sql: 'DELETE FROM aurum_events WHERE stream = ?', args: [stream] },
          ...lines.map((line) => ({ sql: 'INSERT INTO aurum_events(stream, line, created_at) VALUES (?, ?, ?)', args: [stream, line, now] })),
        ])
        await tx.commit()
      } catch (error) { await tx.rollback(); throw error }
      return
    }
    const destination = localPath(name)
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
    return
  }
  if (configuredStorageBackend() === 'turso') {
    await tursoClient().execute({
      sql: 'INSERT INTO aurum_documents(name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      args: [name, value, new Date().toISOString()],
    })
    return
  }
  const destination = localPath(name)
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, destination)
}

export async function appendStoredText(filePath: string, value: string): Promise<void> {
  const name = safeName(filePath)
  if (!(STORAGE_STREAMS as readonly string[]).includes(name)) throw new Error('Append is only supported for event streams.')
  const stream = streamFrom(name)
  await initializeStorage()
  const lines = value.split('\n').filter((line) => line.length > 0)
  if (!lines.length) return
  if (configuredStorageBackend() === 'turso') {
    const client = tursoClient()
    const tx = await client.transaction('write')
    try {
      const now = new Date().toISOString()
      await tx.batch(lines.map((line) => ({ sql: 'INSERT INTO aurum_events(stream, line, created_at) VALUES (?, ?, ?)', args: [stream, line, now] })))
      await tx.commit()
    } catch (error) { await tx.rollback(); throw error }
    return
  }
  await writeFile(localPath(stream), value, { encoding: 'utf8', flag: 'a', mode: 0o600 })
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const backend = configuredStorageBackend()
  const ephemeral = backend === 'local-json' && process.env.AURUM_STORAGE_PERSISTENT?.trim().toLowerCase() !== 'true'
  try {
    await initializeStorage()
    if (backend === 'turso') {
      const client = tursoClient()
      const key = `health-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`
      await client.execute({ sql: 'INSERT INTO aurum_documents(name, value, updated_at) VALUES (?, ?, ?)', args: [key, 'ok', new Date().toISOString()] })
      await client.execute({ sql: 'DELETE FROM aurum_documents WHERE name = ?', args: [key] })
    } else {
      const probe = path.join(/*turbopackIgnore: true*/ storageDirectory(), `.aurum-write-probe-${process.pid}-${Date.now()}`)
      await writeFile(probe, 'ok', { encoding: 'utf8', mode: 0o600 })
      await rm(probe, { force: true })
    }
    const partial = hasPartialTursoConfiguration()
    const warning = partial ? 'Turso configuration is incomplete; using local JSON storage.' : ephemeral ? 'Local JSON storage may be ephemeral on this host.' : null
    return { backend, writable: true, ephemeral, configured: true, warning }
  } catch {
    const partial = hasPartialTursoConfiguration()
    return {
      backend,
      writable: false,
      ephemeral,
      configured: true,
      warning: partial ? 'Incomplete Turso credentials and local storage is unavailable.' : 'Storage is unavailable or read-only; persistent writes may fail.',
    }
  }
}

export async function exportStorageBackup(): Promise<StorageBackup> {
  await initializeStorage()
  const documents: StorageBackup['documents'] = {}
  const streams: StorageBackup['streams'] = {}
  if (configuredStorageBackend() === 'turso') {
    const client = tursoClient()
    const rows = await client.execute('SELECT name, value FROM aurum_documents')
    for (const row of rows.rows) {
      const name = String(row.name)
      if ((STORAGE_DOCUMENTS as readonly string[]).includes(name)) documents[name as StorageDocument] = String(row.value)
    }
    const eventRows = await client.execute('SELECT stream, line FROM aurum_events ORDER BY id')
    for (const row of eventRows.rows) {
      const stream = String(row.stream)
      if (!(STORAGE_STREAMS as readonly string[]).includes(stream)) continue
      const key = stream as StorageStream
      ;(streams[key] ??= []).push(String(row.line))
    }
  } else {
    for (const name of STORAGE_DOCUMENTS) {
      const text = await readStoredText(name)
      if (text !== null) documents[name] = text
    }
    for (const name of STORAGE_STREAMS) {
      const text = await readStoredText(name)
      if (text !== null) streams[name] = text.split('\n').filter(Boolean)
    }
  }
  return { format: 'aurum-storage-backup', version: 1, exportedAt: new Date().toISOString(), documents, streams }
}

export async function restoreStorageBackup(backup: StorageBackup): Promise<void> {
  await initializeStorage()
  if (configuredStorageBackend() === 'turso') {
    const tx = await tursoClient().transaction('write')
    try {
      const now = new Date().toISOString()
      const statements = [
        ...STORAGE_DOCUMENTS.map((name) => ({ sql: 'DELETE FROM aurum_documents WHERE name = ?', args: [name] })),
        ...STORAGE_STREAMS.map((name) => ({ sql: 'DELETE FROM aurum_events WHERE stream = ?', args: [name] })),
        ...Object.entries(backup.documents).flatMap(([name, value]) => value === undefined ? [] : [{ sql: 'INSERT INTO aurum_documents(name, value, updated_at) VALUES (?, ?, ?)', args: [name, value, now] }]),
        ...Object.entries(backup.streams).flatMap(([stream, lines]) => (lines ?? []).map((line) => ({ sql: 'INSERT INTO aurum_events(stream, line, created_at) VALUES (?, ?, ?)', args: [stream, line, now] }))),
      ]
      await tx.batch(statements)
      await tx.commit()
      return
    } catch (error) { await tx.rollback(); throw error }
  }
  const directory = storageDirectory()
  await mkdir(directory, { recursive: true })
  for (const name of STORAGE_DOCUMENTS) {
    const value = backup.documents[name]
    if (value === undefined) await rm(localPath(name), { force: true })
    else await writeStoredText(name, value)
  }
  for (const name of STORAGE_STREAMS) {
    const lines = backup.streams[name]
    if (lines === undefined) await rm(localPath(name), { force: true })
    else await writeStoredText(name, lines.length ? `${lines.join('\n')}\n` : '')
  }
}
