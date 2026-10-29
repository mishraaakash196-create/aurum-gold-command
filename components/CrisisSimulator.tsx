'use client'

import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeAlert, MapPin, RotateCcw, ShieldAlert, Siren, Sparkles, Zap } from 'lucide-react'
import { buildSimulatedEvent, eventLocations, formatEventVerdict } from '@/lib/eventImpact'
import type { GeoLocation, LiveEvent } from '@/lib/types'

interface CrisisSimulatorProps {
  baseXauUsd: number | null
  baseNepalTolaNpr: number | null
  thresholdNpr: number
  activeEvent: LiveEvent | null
  onApply: (event: LiveEvent) => void
  onClear: () => void
}

export default function CrisisSimulator({
  baseXauUsd,
  baseNepalTolaNpr,
  thresholdNpr,
  activeEvent,
  onApply,
  onClear,
}: CrisisSimulatorProps) {
  const [category, setCategory] = useState<'geopolitical' | 'calamity'>('geopolitical')
  const [severity, setSeverity] = useState(6)
  const [title, setTitle] = useState('Cross-border escalation raises safe-haven demand')
  const locations = useMemo(() => eventLocations().filter((location) => location.id !== 'global'), [])
  const [locationId, setLocationId] = useState('middle-east')
  const location = locations.find((item) => item.id === locationId) ?? locations[0]
  const preview = useMemo(() => buildSimulatedEvent({
    title: title.trim() || (category === 'calamity' ? 'Major natural calamity' : 'Regional conflict escalation'),
    category,
    location: location as GeoLocation,
    severity,
    baseXauUsd,
    baseNepalTolaNpr,
    thresholdNpr,
  }), [baseNepalTolaNpr, baseXauUsd, category, location, severity, thresholdNpr, title])
  const impact = preview.nepalImpactNprPerTola
  const isolatedCrossesThreshold = impact !== null && Math.abs(impact) >= thresholdNpr

  return (
    <section className="panel crisis-simulator" id="crisis-simulator">
      <div className="section-heading crisis-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-index">06</span> Command exercise <span className="eyebrow-separator">/</span> simulated only</div>
          <h2>Model a crisis. <span className="heading-dot">Stress the forecast.</span></h2>
          <p>Run a clearly marked geopolitical or calamity shock against the current baseline. This does not add fictional news to the live feed.</p>
        </div>
        <div className="simulator-badge crisis-badge"><ShieldAlert size={15} />OFFLINE STRESS TEST</div>
      </div>

      <div className="crisis-sim-layout">
        <div className="crisis-inputs">
          <div className="control-section-title"><span>01</span><b>Scenario definition</b><i /><span className="sim-only-badge"><i />SIMULATED</span></div>
          <div className="crisis-type-toggle" role="group" aria-label="Scenario type">
            <button className={category === 'geopolitical' ? 'selected' : ''} onClick={() => {
              setCategory('geopolitical')
              setTitle('Cross-border escalation raises safe-haven demand')
              if (locationId === 'nepal') setLocationId('middle-east')
            }}><Siren size={14} /><span><b>GEOPOLITICAL</b><small>War · escalation · truce</small></span></button>
            <button className={category === 'calamity' ? 'selected calamity-selected' : ''} onClick={() => {
              setCategory('calamity')
              setTitle('Major earthquake triggers regional safe-haven demand')
              if (locationId === 'middle-east') setLocationId('nepal')
            }}><AlertTriangle size={14} /><span><b>CALAMITY</b><small>Quake · flood · cyclone</small></span></button>
          </div>
          <label className="crisis-field"><span>SCENARIO HEADLINE <small>Local exercise only · not news</small></span><input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="crisis-field"><span><span>COUNTRY / REGION ANCHOR</span><small>Best named map pin · approximate</small></span><div className="crisis-select-wrap"><MapPin size={13} /><select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.region}</option>)}</select></div></label>
          <label className="slider-control crisis-severity"><span className="slider-head"><span>Event severity</span><b>{severity} / 10</b></span><input type="range" min={1} max={10} step={1} value={severity} onChange={(event) => setSeverity(Number(event.target.value))} /><span className="slider-scale"><span>LOW · 1</span><span>SEVERE · 10</span></span><small>Heuristic sensitivity only. Not a probability or a causal estimate.</small></label>
          <div className="crisis-safety-note"><AlertTriangle size={13} /><span>All output below is marked SIMULATED and stays separate from fetched headlines, live sentiment, and the official FENEGOSIDA quote.</span></div>
        </div>

        <div className={`crisis-preview ${isolatedCrossesThreshold ? 'crisis-preview-alert' : ''}`}>
          <div className="crisis-preview-head"><span><Sparkles size={13} /> SIMULATED IMPACT</span><span className="sim-chip">NOT LIVE NEWS</span></div>
          <div className="crisis-preview-location"><MapPin size={12} />{location?.label} <i>·</i>{location?.region}</div>
          <div className="crisis-preview-impact-grid"><div><span>GLOBAL XAU / OZ</span><b className={preview.globalImpactUsd === null ? '' : preview.globalImpactUsd >= 0 ? 'positive' : 'negative'}>{preview.globalImpactUsd === null ? '—' : `${preview.globalImpactUsd >= 0 ? '+' : '−'}$${Math.abs(preview.globalImpactUsd).toFixed(2)}`}</b><small>{preview.globalImpactPct >= 0 ? '+' : ''}{preview.globalImpactPct.toFixed(3)}% isolated overlay</small></div><div><span>NEPAL 24K / TOLA</span><b className={impact === null ? '' : impact >= 0 ? 'positive' : 'negative'}>{impact === null ? '—' : `${impact >= 0 ? '+' : '−'}Rs ${Math.abs(impact).toLocaleString('en-IN')}`}</b><small>Relative to baseline forecast</small></div></div>
          <div className={`crisis-verdict verdict-${preview.verdict}`}>
            <span>{preview.verdict === 'positive' ? <><ArrowUpRight size={13} />YES · UPSIDE</> : preview.verdict === 'negative' ? <><ArrowDownRight size={13} />YES · DOWNSIDE</> : preview.verdict === 'no-impact' ? <><Activity size={13} />NO IMPACT</> : <><Activity size={13} />IMPACT UNAVAILABLE</>}</span>
            <b>{formatEventVerdict(preview, thresholdNpr)}</b>
          </div>
          <div className={`crisis-alarm-preview ${isolatedCrossesThreshold ? 'will-trigger' : ''}`}><Zap size={12} />{impact === null ? 'Alarm test requires a Nepal local baseline.' : isolatedCrossesThreshold ? `Isolated event shock meets the ±Rs ${thresholdNpr.toLocaleString('en-IN')}/tola threshold; the combined forecast is checked when applied.` : `Isolated shock is below ±Rs ${thresholdNpr.toLocaleString('en-IN')}; the combined forecast move may still trigger the alarm.`}</div>
          <button className="button button-apply-scenario" onClick={() => onApply(preview)} disabled={!baseXauUsd && !baseNepalTolaNpr}><BadgeAlert size={14} />APPLY SIMULATED EVENT <Zap size={13} /></button>
          {activeEvent && <button className="button button-clear-simulation" onClick={onClear}><RotateCcw size={13} />CLEAR ACTIVE SIMULATION</button>}
          {!baseXauUsd && !baseNepalTolaNpr && <div className="crisis-unavailable"><Activity size={13} />Waiting for a live or observed forecast baseline.</div>}
        </div>
      </div>
      <div className="crisis-simulator-footnote"><BadgeAlert size={12} />Any alarm caused by this exercise is visibly tagged SIMULATED. Clear the event to restore the unsimulated forecast.</div>
    </section>
  )
}
