import { appendStoredText, configuredStorageBackend, initializeStorage, readStoredText, storageDirectory, writeStoredText } from '@/data/storage'
import type { AlarmSettings, EnsembleModelSummary, FixingWindowAudit, ManualOfficialRateEntry, OfficialRateHistoryRecord, ParitySettings, PredictionLogEntry, TejabiRatioObservation } from '@/lib/types'
import { DEFAULT_PARITY_SETTINGS } from '@/engine/parity'
import { validateManualOfficialRate } from '@/engine/manualRates'

const RETAIN_IN_MEMORY = 150_000
interface StoreCache { directory: string; settings: ParitySettings; alarmSettings: AlarmSettings; predictions: PredictionLogEntry[]; tejabiObservations: TejabiRatioObservation[]; manualOfficialRates: ManualOfficialRateEntry[]; officialRateHistory: OfficialRateHistoryRecord[]; ready: Promise<void> }
let cacheDirectory = ''
let cachePromise: Promise<StoreCache> | null = null
let tursoCache: StoreCache | null = null
let tursoCacheDirectory = ''
let tursoCacheAt = 0
let tursoCachePromise: Promise<StoreCache> | null = null
let writeQueue: Promise<unknown> = Promise.resolve()

type PredictionEvent = { type: 'prediction'; entry: PredictionLogEntry } | { type: 'actuals'; id: string; actuals: PredictionLogEntry['actuals']; fixingWindow?: FixingWindowAudit }

function legacyPath(_directory: string) { return 'aurum-store.json' }
function settingsPath(_directory: string) { return 'aurum-settings.json' }
function predictionPath(_directory: string) { return 'aurum-predictions.jsonl' }
function tejabiPath(_directory: string) { return 'aurum-tejabi-observations.jsonl' }
function manualRatesPath(_directory: string) { return 'aurum-manual-official-rates.json' }
function officialHistoryPath(_directory: string) { return 'aurum-official-rate-history.json' }
function ensemblePath(_directory: string) { return 'aurum-ensemble-model.json' }
function alarmPath(_directory: string) { return 'aurum-alarm-settings.json' }

function validSettings(value: unknown): ParitySettings {
  const candidate = value as Partial<ParitySettings> | null
  const bounded = (input: unknown, fallback: number, maximum: number) => {
    const number = Number(input)
    return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : fallback
  }
  return {
    customsDutyPct: bounded(candidate?.customsDutyPct, DEFAULT_PARITY_SETTINGS.customsDutyPct, 60),
    vatOtherLevyPct: bounded(candidate?.vatOtherLevyPct, DEFAULT_PARITY_SETTINGS.vatOtherLevyPct, 40),
    dealerMarginPct: bounded(candidate?.dealerMarginPct, DEFAULT_PARITY_SETTINGS.dealerMarginPct, 35),
    tejabiManualRatio: Math.min(1.05, Math.max(0.9, Number.isFinite(Number(candidate?.tejabiManualRatio)) ? Number(candidate?.tejabiManualRatio) : DEFAULT_PARITY_SETTINGS.tejabiManualRatio)),
    tejabiManualUpdatedAt: typeof candidate?.tejabiManualUpdatedAt === 'string' ? candidate.tejabiManualUpdatedAt : null,
    updatedAt: typeof candidate?.updatedAt === 'string' ? candidate.updatedAt : null,
  }
}

async function readText(file: string) {
  try { return await readStoredText(file) } catch { return null }
}

function validAlarmSettings(value: unknown): AlarmSettings {
  const candidate = value as Partial<AlarmSettings> | null
  const threshold = Number(candidate?.thresholdNprPerTola)
  return {
    thresholdNprPerTola: Number.isFinite(threshold) ? Math.min(100_000, Math.max(500, threshold)) : 2_000,
    enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : true,
    muted: typeof candidate?.muted === 'boolean' ? candidate.muted : false,
    updatedAt: typeof candidate?.updatedAt === 'string' ? candidate.updatedAt : null,
  }
}

async function loadCache(directory: string): Promise<StoreCache> {
  const state: StoreCache = { directory, settings: { ...DEFAULT_PARITY_SETTINGS }, alarmSettings: { thresholdNprPerTola: 2_000, enabled: true, muted: false, updatedAt: null }, predictions: [], tejabiObservations: [], manualOfficialRates: [], officialRateHistory: [], ready: Promise.resolve() }
  state.ready = (async () => {
    if (configuredStorageBackend() === 'turso') await initializeStorage()
    const [settingsText, legacyText, eventsText, tejabiText, manualText, historyText, alarmText] = await Promise.all([
      readText(settingsPath(directory)), readText(legacyPath(directory)), readText(predictionPath(directory)), readText(tejabiPath(directory)),
      readText(manualRatesPath(directory)), readText(officialHistoryPath(directory)), readText(alarmPath(directory)),
    ])
    let legacy: { settings?: unknown; predictions?: unknown } = {}
    if (legacyText) { try { legacy = JSON.parse(legacyText) } catch { legacy = {} } }
    const parsedSettings = settingsText ? (() => { try { return JSON.parse(settingsText) } catch { return null } })() : null
    state.settings = validSettings(parsedSettings ?? legacy.settings)
    if (!state.settings.updatedAt) state.settings.updatedAt = new Date().toISOString()
    if (!state.settings.tejabiManualUpdatedAt) state.settings.tejabiManualUpdatedAt = state.settings.updatedAt
    if (alarmText) { try { state.alarmSettings = validAlarmSettings(JSON.parse(alarmText)) } catch { state.alarmSettings = validAlarmSettings(null) } }

    const byId = new Map<string, PredictionLogEntry>()
    const insertLegacy = (value: unknown) => {
      if (value && typeof value === 'object' && typeof (value as PredictionLogEntry).id === 'string') {
        byId.set((value as PredictionLogEntry).id, value as PredictionLogEntry)
      }
    }
    if (Array.isArray(legacy.predictions)) legacy.predictions.forEach(insertLegacy)
    if (eventsText) {
      for (const line of eventsText.split('\n')) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as PredictionEvent | PredictionLogEntry
          if ('type' in event && event.type === 'prediction') insertLegacy(event.entry)
          else if ('type' in event && event.type === 'actuals') {
            const entry = byId.get(event.id)
            if (entry) {
              entry.actuals = { ...entry.actuals, ...event.actuals }
              if (event.fixingWindow) entry.fixingWindow = event.fixingWindow
            }
          } else insertLegacy(event)
        } catch { /* Ignore a partial final JSONL line; subsequent appends remain valid. */ }
      }
    }
    state.predictions = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-RETAIN_IN_MEMORY)
    const observationsByDate = new Map<string, TejabiRatioObservation>()
    if (tejabiText) for (const line of tejabiText.split('\n')) {
      if (!line.trim()) continue
      try { const item = JSON.parse(line) as TejabiRatioObservation; if (item.date && item.rate24kTolaNpr > 0 && item.tejabiTolaNpr > 0) observationsByDate.set(item.date, item) } catch { /* Ignore a partial final line. */ }
    }
    state.tejabiObservations = [...observationsByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400)

    const manualRows = manualText ? (() => { try { const value = JSON.parse(manualText); return Array.isArray(value) ? value : [] } catch { return [] } })() : []
    state.manualOfficialRates = manualRows.filter((row: any) => validateManualOfficialRate(row).valid && typeof row.enteredAt === 'string')
      .map((row: any) => ({ date: row.date, rate24kTolaNpr: Number(row.rate24kTolaNpr), tejabiTolaNpr: Number(row.tejabiTolaNpr), source: 'Manual entry · FENEGOSIDA transcription' as const, enteredAt: row.enteredAt, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.enteredAt }))
      .sort((a: ManualOfficialRateEntry, b: ManualOfficialRateEntry) => a.date.localeCompare(b.date))
    const historyRows = historyText ? (() => { try { const value = JSON.parse(historyText); return Array.isArray(value) ? value : [] } catch { return [] } })() : []
    const historyByDate = new Map<string, OfficialRateHistoryRecord>()
    for (const row of historyRows) {
      if (typeof row?.date === 'string' && Number.isFinite(Number(row.rate24kTolaNpr)) && Number(row.rate24kTolaNpr) > 0) {
        historyByDate.set(row.date, { date: row.date, rate24kTolaNpr: Number(row.rate24kTolaNpr), rate24k10gNpr: row.rate24k10gNpr !== null && row.rate24k10gNpr !== undefined && Number.isFinite(Number(row.rate24k10gNpr)) ? Number(row.rate24k10gNpr) : null, source: typeof row.source === 'string' ? row.source : 'FENEGOSIDA · official daily benchmark', checkedAt: typeof row.checkedAt === 'string' ? row.checkedAt : null, provenance: 'automatic official feed' })
      }
    }
    state.officialRateHistory = [...historyByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-2000)
  })()
  return state
}

async function getCache() {
  const directory = storageDirectory()
  // Turso is shared across serverless instances, so never trust a long-lived per-instance cache.
  if (configuredStorageBackend() === 'turso') {
    if (tursoCache && tursoCacheDirectory === directory && Date.now() - tursoCacheAt < 1_000) return tursoCache
    if (!tursoCachePromise || tursoCacheDirectory !== directory || Date.now() - tursoCacheAt >= 1_000) {
      tursoCacheDirectory = directory
      tursoCachePromise = loadCache(directory)
    }
    const fresh = await tursoCachePromise
    await fresh.ready
    tursoCache = fresh
    tursoCacheAt = Date.now()
    return fresh
  }
  if (!cachePromise || cacheDirectory !== directory) {
    cacheDirectory = directory
    cachePromise = loadCache(directory)
  }
  const loaded = await cachePromise
  await loaded.ready
  return loaded
}

async function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T
  const task = writeQueue.then(async () => { result = await operation() })
  writeQueue = task.catch(() => undefined)
  await task
  return result
}

export async function getParitySettings(): Promise<ParitySettings> {
  return { ...(await getCache()).settings }
}

export async function getAlarmSettings(): Promise<AlarmSettings> {
  return { ...(await getCache()).alarmSettings }
}

export async function saveAlarmSettings(input: unknown): Promise<AlarmSettings> {
  return serializeWrite(async () => {
    const state = await getCache()
    if (!input || typeof input !== 'object') throw new Error('Alarm settings are invalid.')
    const candidate = input as Partial<AlarmSettings>
    if (typeof candidate.thresholdNprPerTola !== 'number' || !Number.isFinite(candidate.thresholdNprPerTola) || candidate.thresholdNprPerTola < 500 || candidate.thresholdNprPerTola > 100_000) throw new Error('Alarm threshold must be between 500 and 100,000 NPR per tola.')
    if (typeof candidate.enabled !== 'boolean' || typeof candidate.muted !== 'boolean') throw new Error('Alarm settings are invalid.')
    const next = validAlarmSettings(input)
    state.alarmSettings = { ...next, updatedAt: new Date().toISOString() }
    await writeStoredText(alarmPath(state.directory), JSON.stringify(state.alarmSettings, null, 2))
    return { ...state.alarmSettings }
  })
}

export async function saveParitySettings(value: unknown): Promise<ParitySettings> {
  return serializeWrite(async () => {
    const state = await getCache()
    const next = validSettings(value)
    const now = new Date().toISOString()
    const manualRatioChanged = next.tejabiManualRatio !== state.settings.tejabiManualRatio
    state.settings = {
      ...next,
      updatedAt: now,
      tejabiManualUpdatedAt: manualRatioChanged || !state.settings.tejabiManualUpdatedAt
        ? now
        : state.settings.tejabiManualUpdatedAt,
    }
    await writeStoredText(settingsPath(state.directory), JSON.stringify(state.settings, null, 2))
    return { ...state.settings }
  })
}

function localDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}
function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function overlayManualActuals(entries: PredictionLogEntry[], manualRates: ManualOfficialRateEntry[], automatic24kDates: Set<string>, automaticTejabiDates: Set<string>) {
  const rates = [...manualRates].sort((a, b) => a.date.localeCompare(b.date))
  for (const entry of entries) {
    const created = Date.parse(entry.createdAt)
    const match = rates.find((rate) => rate.date >= entry.targetDate && rate.date <= addIsoDays(entry.targetDate, 14) && Date.parse(rate.updatedAt) >= created)
    if (!match) continue
    const actuals = entry.actuals ?? {}
    const source = 'Manual entry · FENEGOSIDA transcription'
    if (!automatic24kDates.has(match.date) && !actuals['nepal-24k']) actuals['nepal-24k'] = { value: match.rate24kTolaNpr, observedAt: match.updatedAt, source }
    if (!automatic24kDates.has(match.date) && !actuals['nepal-22k']) actuals['nepal-22k'] = { value: Math.round((match.rate24kTolaNpr * 0.9167) / 100) * 100, observedAt: match.updatedAt, source: `${source} · 22K derived from 24K` }
    if (!automaticTejabiDates.has(match.date) && !actuals['nepal-tejabi']) actuals['nepal-tejabi'] = { value: match.tejabiTolaNpr, observedAt: match.updatedAt, source }
    entry.actuals = actuals
  }
  return entries
}

async function writeJsonAtomically(destination: string, value: unknown) {
  await writeStoredText(destination, JSON.stringify(value, null, 2))
}

export async function getPredictionEntries(): Promise<PredictionLogEntry[]> {
  const state = await getCache()
  const entries = JSON.parse(JSON.stringify(state.predictions)) as PredictionLogEntry[]
  return overlayManualActuals(entries, state.manualOfficialRates, new Set(state.officialRateHistory.map((item) => item.date)), new Set(state.tejabiObservations.map((item) => item.date)))
}

export async function getManualOfficialRates(): Promise<ManualOfficialRateEntry[]> {
  const state = await getCache()
  return state.manualOfficialRates.map((item) => ({ ...item })).sort((a, b) => b.date.localeCompare(a.date))
}

export async function upsertManualOfficialRate(input: unknown): Promise<{ entry: ManualOfficialRateEntry | null; errors: Record<string, string> }> {
  const validation = validateManualOfficialRate(input)
  if (!validation.valid) return { entry: null, errors: validation.errors as Record<string, string> }
  return serializeWrite(async () => {
    const state = await getCache()
    const value = input as { date: string; rate24kTolaNpr: number; tejabiTolaNpr: number }
    const existing = state.manualOfficialRates.find((item) => item.date === value.date)
    const now = new Date().toISOString()
    const entry: ManualOfficialRateEntry = {
      date: value.date,
      rate24kTolaNpr: Number(value.rate24kTolaNpr),
      tejabiTolaNpr: Number(value.tejabiTolaNpr),
      source: 'Manual entry · FENEGOSIDA transcription',
      enteredAt: existing?.enteredAt ?? now,
      updatedAt: now,
    }
    state.manualOfficialRates = [...state.manualOfficialRates.filter((item) => item.date !== value.date), entry].sort((a, b) => a.date.localeCompare(b.date))
    await writeJsonAtomically(manualRatesPath(state.directory), state.manualOfficialRates)
    return { entry: { ...entry }, errors: {} }
  })
}

export async function deleteManualOfficialRate(date: string): Promise<boolean> {
  return serializeWrite(async () => {
    const state = await getCache()
    const next = state.manualOfficialRates.filter((item) => item.date !== date)
    if (next.length === state.manualOfficialRates.length) return false
    state.manualOfficialRates = next
    await writeJsonAtomically(manualRatesPath(state.directory), next)
    return true
  })
}

export async function recordOfficialRateHistory(points: Array<{ date: string; perTola: number; per10g: number }>, source: string, checkedAt = new Date().toISOString()): Promise<void> {
  const valid = points.filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.perTola) && point.perTola > 0)
  if (!valid.length) return
  await serializeWrite(async () => {
    const state = await getCache()
    const byDate = new Map(state.officialRateHistory.map((item) => [item.date, item]))
    for (const point of valid) byDate.set(point.date, {
      date: point.date,
      rate24kTolaNpr: point.perTola,
      rate24k10gNpr: Number.isFinite(point.per10g) && point.per10g > 0 ? point.per10g : null,
      source,
      checkedAt,
      provenance: 'automatic official feed',
    })
    state.officialRateHistory = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-2000)
    await writeJsonAtomically(officialHistoryPath(state.directory), state.officialRateHistory)
  })
}

export async function getOfficialRateHistory(): Promise<OfficialRateHistoryRecord[]> {
  const state = await getCache()
  const combined = new Map(state.officialRateHistory.map((item) => [item.date, { ...item }]))
  for (const item of state.manualOfficialRates) {
    if (combined.has(item.date)) continue
    combined.set(item.date, { date: item.date, rate24kTolaNpr: item.rate24kTolaNpr, rate24k10gNpr: null, source: item.source, checkedAt: item.updatedAt, provenance: 'manual entry' })
  }
  return [...combined.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export async function appendPredictionEntry(entry: PredictionLogEntry): Promise<void> {
  await serializeWrite(async () => {
    const state = await getCache()
    const cloned = JSON.parse(JSON.stringify(entry)) as PredictionLogEntry
    state.predictions.push(cloned)
    if (state.predictions.length > RETAIN_IN_MEMORY) state.predictions.splice(0, state.predictions.length - RETAIN_IN_MEMORY)
    const event: PredictionEvent = { type: 'prediction', entry: cloned }
    await appendStoredText(predictionPath(state.directory), `${JSON.stringify(event)}\n`)
  })
}

export async function appendActualUpdates(updates: Array<{ id: string; actuals: PredictionLogEntry['actuals']; fixingWindow?: FixingWindowAudit }>): Promise<void> {
  if (!updates.length) return
  await serializeWrite(async () => {
    const state = await getCache()
    const byId = new Map(state.predictions.map((entry) => [entry.id, entry]))
    const lines: string[] = []
    for (const update of updates) {
      const entry = byId.get(update.id)
      if (!entry) continue
      entry.actuals = { ...entry.actuals, ...update.actuals }
      if (update.fixingWindow) entry.fixingWindow = update.fixingWindow
      lines.push(JSON.stringify({ type: 'actuals', id: update.id, actuals: update.actuals, fixingWindow: update.fixingWindow } satisfies PredictionEvent))
    }
    if (lines.length) await appendStoredText(predictionPath(state.directory), `${lines.join('\n')}\n`)
  })
}


export async function getEnsembleModel(): Promise<EnsembleModelSummary | null> {
  const state = await getCache()
  const text = await readText(ensemblePath(state.directory))
  if (!text) return null
  try {
    const value = JSON.parse(text) as EnsembleModelSummary
    if (!value || !['ridge-learned', 'heuristic-fallback'].includes(value.mode) || !value.weights || typeof value.weights !== 'object') return null
    return value
  } catch { return null }
}

export async function saveEnsembleModel(value: EnsembleModelSummary): Promise<void> {
  await serializeWrite(async () => {
    const state = await getCache()
    await writeStoredText(ensemblePath(state.directory), JSON.stringify(value, null, 2))
  })
}

export async function getTejabiObservations(): Promise<TejabiRatioObservation[]> {
  const state = await getCache()
  const byDate = new Map(state.tejabiObservations.map((item) => [item.date, { ...item }]))
  for (const item of state.manualOfficialRates) {
    if (byDate.has(item.date)) continue // A later automatic source report takes precedence over a manual transcription.
    byDate.set(item.date, { date: item.date, rate24kTolaNpr: item.rate24kTolaNpr, tejabiTolaNpr: item.tejabiTolaNpr, source: item.source, observedAt: item.updatedAt })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400)
}

/** Stores at most one source-reported Tejabi/24K pair per FENEGOSIDA fixing date. */
export async function recordTejabiObservation(observation: TejabiRatioObservation): Promise<void> {
  if (!observation.date || observation.rate24kTolaNpr <= 0 || observation.tejabiTolaNpr <= 0) return
  await serializeWrite(async () => {
    const state = await getCache()
    const ratio = observation.tejabiTolaNpr / observation.rate24kTolaNpr
    if (!Number.isFinite(ratio) || ratio < 0.9 || ratio > 1.05) return
    if (state.tejabiObservations.some((item) => item.date === observation.date)) return
    const saved = { ...observation }
    state.tejabiObservations.push(saved)
    state.tejabiObservations.sort((a, b) => a.date.localeCompare(b.date))
    if (state.tejabiObservations.length > 400) state.tejabiObservations.splice(0, state.tejabiObservations.length - 400)
    await appendStoredText(tejabiPath(state.directory), `${JSON.stringify(saved)}\n`)
  })
}

export function invalidateJsonStoreCache(): void {
  cacheDirectory = ''
  cachePromise = null
  tursoCache = null
  tursoCacheDirectory = ''
  tursoCacheAt = 0
  tursoCachePromise = null
}
