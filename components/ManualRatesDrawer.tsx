'use client'

import NepaliDate from 'nepali-date-converter'
import { useEffect, useState } from 'react'
import { AlertCircle, Check, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react'
import type { ManualOfficialRateEntry } from '@/lib/types'
import { validateManualOfficialRate } from '@/engine/manualRates'

type Language = 'en' | 'ne'
const text = (language: Language, en: string, ne: string) => language === 'ne' ? ne : en
function nptToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}
function bsDate(date: string, language: Language) {
  try { return new NepaliDate(new Date(`${date}T12:00:00+05:45`)).format('DD MMMM YYYY', language === 'ne' ? 'np' : 'en') } catch { return date }
}
function digits(value: string, language: Language) {
  if (language !== 'ne') return value
  return value.replace(/[0-9]/g, (digit) => '०१२३४५६७८९'[Number(digit)])
}

export default function ManualRatesDrawer({ open, onClose, onSaved, language = 'en', adminAuthenticated }: { open: boolean; onClose: () => void; onSaved: () => void; language?: Language; adminAuthenticated: boolean }) {
  const [entries, setEntries] = useState<ManualOfficialRateEntry[]>([])
  const [date, setDate] = useState(nptToday())
  const [rate24, setRate24] = useState('')
  const [tejabi, setTejabi] = useState('')
  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [undoEntry, setUndoEntry] = useState<ManualOfficialRateEntry | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/manual-official-rates', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load manual rates.')
      setEntries(Array.isArray(payload.entries) ? payload.entries : [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load manual rates.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open) { void load(); setDate(nptToday()) } }, [open])

  const reset = () => { setEditingDate(null); setDate(nptToday()); setRate24(''); setTejabi(''); setError(null); setSuccess(null) }
  const edit = (entry: ManualOfficialRateEntry) => { setEditingDate(entry.date); setDate(entry.date); setRate24(String(entry.rate24kTolaNpr)); setTejabi(String(entry.tejabiTolaNpr)); setError(null); setSuccess(null) }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null); setSuccess(null)
    const input = { date, rate24kTolaNpr: Number(rate24), tejabiTolaNpr: Number(tejabi) }
    const checked = validateManualOfficialRate(input)
    if (!checked.valid) { setError(Object.values(checked.errors).filter(Boolean).join(' ')); return }
    setBusy(true)
    try {
      const response = await fetch('/api/manual-official-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ? `${payload.error} ${Object.values(payload.fields ?? {}).join(' ')}` : 'Manual rate was not saved.')
      await load()
      setSuccess(text(language, `${editingDate ? 'Updated' : 'Saved'} ${date}; provenance remains “manual entry”.`, `${date} का लागि ${editingDate ? 'सच्याइयो' : 'सुरक्षित गरियो'}; स्रोत “म्यानुअल प्रविष्टि” नै रहनेछ।`))
      setEditingDate(null); setDate(nptToday()); setRate24(''); setTejabi('')
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Manual rate was not saved.') }
    finally { setBusy(false) }
  }
  const remove = async (entry: ManualOfficialRateEntry) => {
    if (!window.confirm(text(language, `Remove the manual official-rate record for ${entry.date}? Accuracy matching and ratio learning will recalculate.`, `${entry.date} को म्यानुअल दर हटाउने? शुद्धता ट्र्याकिङ र अनुपात सिकाइ पुनःगणना हुनेछ।`))) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/manual-official-rates?date=${encodeURIComponent(entry.date)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || !payload.deleted) throw new Error(payload?.error ?? 'Record could not be removed.')
      setUndoEntry(entry); await load(); onSaved()
      setSuccess(text(language, `Removed ${entry.date}. You can undo this change.`, `${entry.date} हटाइयो। यो परिवर्तन फिर्ता गर्न सकिन्छ।`))
      if (editingDate === entry.date) reset()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Record could not be removed.') }
    finally { setBusy(false) }
  }
  const undo = async () => {
    if (!undoEntry) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/manual-official-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undoEntry) })
      if (!response.ok) throw new Error('Undo failed; the record remains removed.')
      setUndoEntry(null); await load(); onSaved(); setSuccess(text(language, 'Manual record restored.', 'म्यानुअल रेकर्ड पुनःस्थापित भयो।'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Undo failed.') }
    finally { setBusy(false) }
  }

  if (!open) return null
  return <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="accuracy-drawer stage3-drawer" role="dialog" aria-modal="true" aria-labelledby="manual-rates-title">
      <div className="drawer-heading"><div><span className="drawer-kicker"><Save size={13} /> {text(language, 'OFFICIAL RATE FALLBACK', 'आधिकारिक दर वैकल्पिक')}</span><h2 id="manual-rates-title">{text(language, 'Manual FENEGOSIDA actuals', 'म्यानुअल फेनेगोसीडा दर')}</h2><p>{text(language, 'Enter a dated 24K Hallmark and Tejabi fixing when the automatic feed fails. Values remain explicitly labelled as manual transcriptions.', 'स्वचालित फिड असफल हुँदा मिति सहित २४K छापावाल र तेजाबी दर राख्नुहोस्। यी मानहरू म्यानुअल प्रतिलिपि भनेर स्पष्ट देखाइनेछन्।')}</p></div><button type="button" className="drawer-close" onClick={onClose} aria-label="Close manual rates"><X size={18} /></button></div>
      <div className="drawer-content">
        <div className="manual-provenance-note"><AlertCircle size={15} /><span>{text(language, 'Manual entries are never represented as automatic observations. Automatic FENEGOSIDA values take precedence for the same date. A manual fixing can anchor the fallback forecast, accuracy tracker, Tejabi learning, and official-rate chart.', 'म्यानुअल मानलाई स्वचालित अवलोकन भनेर देखाइँदैन। एउटै मितिमा स्वचालित फेनेगोसीडा मानलाई प्राथमिकता दिइन्छ। म्यानुअल दरले वैकल्पिक पूर्वानुमान, शुद्धता ट्र्याकिङ, तेजाबी सिकाइ र आधिकारिक इतिहास चार्टमा सहयोग गर्छ।')}</span></div>
        {!adminAuthenticated && <div className="manual-readonly-note">Read-only access. Sign in as an administrator to add, edit, remove, or undo manual rates.</div>}
        <form className="manual-rate-form" onSubmit={(event) => void save(event)}>
          <fieldset disabled={!adminAuthenticated || busy} className="admin-fieldset">
          <div className="manual-form-heading"><div><span>{editingDate ? text(language, 'EDIT EXISTING DATE', 'अवस्थित मिति सम्पादन') : text(language, 'ADD OR REPLACE DATE', 'मिति थप्नुहोस् वा सच्याउनुहोस्')}</span><small>{text(language, 'One manual record per date · rates in NPR per tola', 'प्रति मिति एउटा म्यानुअल रेकर्ड · NPR प्रति तोला')}</small></div>{editingDate && <button className="button button-subtle" type="button" onClick={reset}>{text(language, 'Cancel edit', 'सम्पादन रद्द')}</button>}</div>
          <div className="manual-rate-fields">
            <label>{text(language, 'FIXING DATE', 'दरको मिति')}<input type="date" value={date} max={nptToday()} disabled={Boolean(editingDate)} onChange={(event) => setDate(event.target.value)} required /></label>
            <label>{text(language, '24K HALLMARK · NPR/TOLA', '२४K छापावाल · NPR/तोला')}<input type="number" min="10000" max="2000000" step="1" inputMode="numeric" value={rate24} onChange={(event) => setRate24(event.target.value)} placeholder="e.g. 300000" required /></label>
            <label>{text(language, 'TEJABI · NPR/TOLA', 'तेजाबी · NPR/तोला')}<input type="number" min="10000" max="2000000" step="1" inputMode="numeric" value={tejabi} onChange={(event) => setTejabi(event.target.value)} placeholder="e.g. 294000" required /></label>
          </div>
          <div className="manual-validation-hint">{text(language, 'Validation: NPR 10,000–2,000,000 and Tejabi ratio 90%–105% of same-date 24K.', 'जाँच: NPR १०,०००–२०,००,००० र सोही मितिको २४K को ९०%–१०५% तेजाबी अनुपात।')}</div>
          {error && <div className="drawer-error"><AlertCircle size={15} />{error}</div>}{success && <div className="manual-success"><Check size={14} />{success}</div>}
          <button className="button button-primary manual-save" type="submit" disabled={!adminAuthenticated || busy}><Save size={14} />{busy ? text(language, 'Saving…', 'सुरक्षित हुँदै…') : editingDate ? text(language, 'Save correction', 'सच्याइएको दर सुरक्षित') : text(language, 'Save manual actual', 'म्यानुअल दर सुरक्षित')}</button>
          </fieldset>
        </form>
        {undoEntry && adminAuthenticated && <div className="manual-undo-row"><span>{text(language, 'Last removed record', 'अन्तिम हटाइएको रेकर्ड')}: {digits(undoEntry.date, language)}</span><button className="button button-subtle" type="button" onClick={() => void undo()} disabled={busy}><RotateCcw size={13} />{text(language, 'Undo', 'फिर्ता गर्नुहोस्')}</button></div>}
        <section className="manual-records-section"><div className="drawer-section-head"><div><span>{text(language, 'PERSISTED ENTRIES', 'सुरक्षित प्रविष्टिहरू')}</span><h3>{text(language, 'Manual rate ledger', 'म्यानुअल दर सूची')}</h3></div><span className="notice-count">{digits(String(entries.length), language)}</span></div>
          {loading ? <div className="drawer-state">{text(language, 'Loading saved manual rates…', 'सुरक्षित म्यानुअल दरहरू लोड हुँदै…')}</div> : entries.length ? <div className="manual-record-list">{entries.map((entry) => <article className="manual-record-card" key={entry.date}><div className="manual-record-main"><b>{digits(entry.date, language)} · {bsDate(entry.date, language)} {language === 'ne' ? 'वि.सं.' : 'BS'}</b><span>24K <strong>{digits(Math.round(entry.rate24kTolaNpr).toLocaleString('en-IN'), language)}</strong> · Tejabi <strong>{digits(Math.round(entry.tejabiTolaNpr).toLocaleString('en-IN'), language)}</strong> NPR/tola</span><small>{entry.source} · Updated {new Date(entry.updatedAt).toLocaleString(language === 'ne' ? 'ne-NP' : 'en-GB')}</small></div>{adminAuthenticated && <div className="manual-record-actions"><button type="button" aria-label={`Edit ${entry.date}`} title="Edit" onClick={() => edit(entry)}><Pencil size={14} /></button><button type="button" aria-label={`Remove ${entry.date}`} title="Remove and undo" onClick={() => void remove(entry)} disabled={busy}><Trash2 size={14} /></button></div>}</article>)}</div> : <div className="drawer-empty">{text(language, 'No manual official-rate entries saved.', 'म्यानुअल आधिकारिक दर सुरक्षित गरिएको छैन।')}</div>}
        </section>
      </div>
    </aside>
  </div>
}
