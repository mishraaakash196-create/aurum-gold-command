import { STORAGE_DOCUMENTS, STORAGE_STREAMS, type StorageBackup, type StorageDocument, type StorageStream } from '@/data/storage'
import { validateManualOfficialRate } from '@/engine/manualRates'

const MAX_BACKUP_BYTES = 25 * 1024 * 1024
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

function validPredictionEvent(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as unknown
    if (!isRecord(parsed)) return false
    if (parsed.type === 'prediction') return isRecord(parsed.entry) && typeof parsed.entry.id === 'string' && typeof parsed.entry.createdAt === 'string'
    if (parsed.type === 'actuals') return typeof parsed.id === 'string' && isRecord(parsed.actuals)
    return typeof parsed.id === 'string' && typeof parsed.createdAt === 'string'
  } catch { return false }
}

function validTejabiEvent(line: string): boolean {
  try {
    const row = JSON.parse(line) as Record<string, unknown>
    return /^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? ''))
      && Number.isFinite(Number(row.rate24kTolaNpr)) && Number(row.rate24kTolaNpr) > 0
      && Number.isFinite(Number(row.tejabiTolaNpr)) && Number(row.tejabiTolaNpr) > 0
      && typeof row.observedAt === 'string' && typeof row.source === 'string'
  } catch { return false }
}

function validDocument(name: StorageDocument, raw: string): boolean {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return false }
  if (name === 'aurum-settings.json') {
    if (!isRecord(value)) return false
    const checks: Array<[string, number, number]> = [['customsDutyPct', 0, 60], ['vatOtherLevyPct', 0, 40], ['dealerMarginPct', 0, 35], ['tejabiManualRatio', 0.9, 1.05]]
    return checks.every(([key, min, max]) => value[key] === undefined || (Number.isFinite(Number(value[key])) && Number(value[key]) >= min && Number(value[key]) <= max))
  }
  if (name === 'aurum-alarm-settings.json') {
    return isRecord(value) && Number.isFinite(Number(value.thresholdNprPerTola)) && Number(value.thresholdNprPerTola) >= 500 && Number(value.thresholdNprPerTola) <= 100_000 && typeof value.enabled === 'boolean' && typeof value.muted === 'boolean'
  }
  if (name === 'aurum-manual-official-rates.json') {
    return Array.isArray(value) && value.every((row) => validateManualOfficialRate(row).valid && isRecord(row) && typeof row.enteredAt === 'string')
  }
  if (name === 'aurum-official-rate-history.json') {
    return Array.isArray(value) && value.every((row) => isRecord(row) && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? '')) && Number.isFinite(Number(row.rate24kTolaNpr)) && Number(row.rate24kTolaNpr) > 0)
  }
  if (name === 'aurum-ensemble-model.json') {
    return isRecord(value) && ['ridge-learned', 'heuristic-fallback'].includes(String(value.mode)) && isRecord(value.weights) && Object.values(value.weights).every((weight) => typeof weight === 'number' && Number.isFinite(weight))
  }
  if (name === 'aurum-store.json') {
    return isRecord(value) && (value.settings === undefined || isRecord(value.settings)) && (value.predictions === undefined || (Array.isArray(value.predictions) && value.predictions.every((row) => isRecord(row) && typeof row.id === 'string')))
  }
  return false
}

export function validateStorageBackup(input: unknown): { valid: true; backup: StorageBackup } | { valid: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(input) || input.format !== 'aurum-storage-backup' || input.version !== 1 || typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt))) {
    return { valid: false, errors: ['Unsupported or malformed backup envelope. Expected format aurum-storage-backup version 1.'] }
  }
  if (!isRecord(input.documents) || !isRecord(input.streams)) return { valid: false, errors: ['Backup documents and streams must be objects.'] }
  const documents: StorageBackup['documents'] = {}
  const streams: StorageBackup['streams'] = {}
  let totalBytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
  if (totalBytes > MAX_BACKUP_BYTES) return { valid: false, errors: ['Backup exceeds the 25 MiB restore limit.'] }
  for (const [key, raw] of Object.entries(input.documents)) {
    if (!(STORAGE_DOCUMENTS as readonly string[]).includes(key)) { errors.push(`Unknown storage document: ${key}`); continue }
    if (typeof raw !== 'string' || !validDocument(key as StorageDocument, raw)) { errors.push(`Invalid or malformed document: ${key}`); continue }
    documents[key as StorageDocument] = raw
  }
  for (const [key, value] of Object.entries(input.streams)) {
    if (!(STORAGE_STREAMS as readonly string[]).includes(key)) { errors.push(`Unknown storage stream: ${key}`); continue }
    if (!Array.isArray(value) || !value.every((line) => typeof line === 'string')) { errors.push(`Invalid event stream: ${key}`); continue }
    const lines = value as string[]
    const lineValidator = key === 'aurum-predictions.jsonl' ? validPredictionEvent : validTejabiEvent
    if (lines.length > 150_000 || !lines.every((line) => line.trim().length > 0 && lineValidator(line))) { errors.push(`Malformed event record in ${key}.`); continue }
    totalBytes += lines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8') + 1, 0)
    streams[key as StorageStream] = lines
  }
  if (totalBytes > MAX_BACKUP_BYTES) errors.push('Backup exceeds the 25 MiB restore limit.')
  if (errors.length) return { valid: false, errors }
  return { valid: true, backup: { format: 'aurum-storage-backup', version: 1, exportedAt: input.exportedAt, documents, streams } }
}
