'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Save, X } from 'lucide-react'
import { TOLA_GRAMS, TROY_OUNCE_GRAMS } from '@/lib/goldEngine'
import type { ParitySettings, TejabiRatioState } from '@/lib/types'

const initial: ParitySettings = { customsDutyPct: 15, vatOtherLevyPct: 1, dealerMarginPct: 0, tejabiManualRatio: 0.9915 }

function ratioTime(value: string | null | undefined) {
  if (!value) return 'not updated yet'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-NP', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ParitySettingsDrawer({ open, onClose, onSaved, activeRatio, adminAuthenticated }: {
  open: boolean
  onClose: () => void
  onSaved: (settings: ParitySettings) => void
  activeRatio?: TejabiRatioState
  adminAuthenticated: boolean
}) {
  const [settings, setSettings] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/settings', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('Settings are unavailable.')
      const result = await response.json()
      setSettings({ ...initial, ...result.settings })
      setError(null)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load settings.'))
  }, [open])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }), cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Settings could not be saved.')
      setSettings(result.settings)
      onSaved(result.settings)
      setMessage('Settings saved and applied to the next forecast.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved.') }
    finally { setSaving(false) }
  }

  if (!open) return null
  const fields: Array<{ key: 'customsDutyPct' | 'vatOtherLevyPct' | 'dealerMarginPct'; label: string; max: number; help: string }> = [
    { key: 'customsDutyPct', label: 'Customs duty', max: 60, help: 'Applied to fine-gold import parity comparisons.' },
    { key: 'vatOtherLevyPct', label: 'VAT / other levies', max: 40, help: 'Combined additional levy input; keep aligned with current rules.' },
    { key: 'dealerMarginPct', label: 'Dealer margin', max: 35, help: 'Additional dealer premium before rolling local spread.' },
  ]
  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="parity-settings-title">
        <div className="drawer-heading"><div><span className="drawer-kicker">NEPAL · IMPORT PARITY</span><h2 id="parity-settings-title">Parity settings</h2><p>Settings and observed source pairs are stored on this app server.</p></div><button type="button" className="drawer-close" onClick={onClose} aria-label="Close settings"><X size={18} /></button></div>
        {!adminAuthenticated && <div className="manual-readonly-note">Read-only access. Sign in as an administrator to change persistent parity settings.</div>}
        <form className="parity-settings-form" onSubmit={save}>
          <fieldset disabled={!adminAuthenticated || saving} className="admin-fieldset">
          <div className="tejabi-ratio-status">
            <div><span>ACTIVE TEJABI / 24K RATIO</span><b>{activeRatio ? `${(activeRatio.ratio * 100).toFixed(4)}%` : '—'}</b></div>
            <div><span>METHOD · OBSERVATIONS</span><b>{activeRatio ? `${activeRatio.source === 'learned' ? 'LEARNED' : 'MANUAL FALLBACK'} · ${activeRatio.sampleCount}/7` : 'Waiting for forecast'}</b></div>
            <small>Last update: {ratioTime(activeRatio?.lastUpdatedAt)}. Learned values use only paired daily FENEGOSIDA 24K and Tejabi quotes; no historical values are inferred.</small>
          </div>
          <label className="parity-setting-field tejabi-manual-field"><span>Manual fallback ratio<b>{(settings.tejabiManualRatio * 100).toFixed(4)}%</b></span><input type="number" min="90" max="105" step="0.0001" value={(settings.tejabiManualRatio * 100).toFixed(4)} onChange={(event) => setSettings((previous) => ({ ...previous, tejabiManualRatio: Number(event.target.value) / 100 }))} /><small>Used only until at least one genuine paired FENEGOSIDA observation is available. Change is not a reported official rate.</small></label>
          <div className="parity-reference-inputs">
            <div><span>XAU/USD spot</span><b>Live market feed</b></div><div><span>USD/NPR</span><b>NRB rate when available</b></div>
            <div><span>Grams / troy oz</span><b>{TROY_OUNCE_GRAMS}</b></div><div><span>Grams / tola</span><b>{TOLA_GRAMS}</b></div>
            <div><span>Rolling spread</span><b>Learned from FENEGOSIDA</b></div>
          </div>
          {fields.map((field) => <label className="parity-setting-field" key={field.key}><span>{field.label}<b>{settings[field.key].toFixed(2)}%</b></span><input type="number" min="0" max={field.max} step="0.25" value={settings[field.key]} onChange={(event) => setSettings((previous) => ({ ...previous, [field.key]: Number(event.target.value) }))} /><small>{field.help}</small></label>)}
          <div className="settings-budget-note"><AlertCircle size={15} /><span>Government budgets may change customs duty and tax rules. Verify current official levies; these inputs are user-configured estimates, not legal or tax guidance.</span></div>
          {error && <div className="drawer-error"><AlertCircle size={15} />{error}</div>}{message && <div className="settings-saved"><Check size={14} />{message}</div>}
          <button className="settings-save-button" disabled={!adminAuthenticated || saving} type="submit"><Save size={15} />{saving ? 'Saving…' : 'Save parity settings'}</button>
          </fieldset>
        </form>
      </aside>
    </div>
  )
}
