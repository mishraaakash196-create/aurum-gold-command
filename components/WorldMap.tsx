'use client'

import { useMemo } from 'react'
import { AlertTriangle, Crosshair, ExternalLink, Globe2, MapPin, Radio, Waves } from 'lucide-react'
import type { LiveEvent } from '@/lib/types'
import { formatEventVerdict, verdictForImpact } from '@/lib/eventImpact'

interface WorldMapProps {
  events: LiveEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
  thresholdNpr: number
}

function categoryTone(event: LiveEvent) {
  if (event.category === 'calamity') return 'calamity'
  if (event.category === 'geopolitical') return 'conflict'
  return 'macro'
}

function relativeTime(value: string | null) {
  if (!value) return 'TIME N/A'
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m AGO`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h AGO`
  return `${Math.floor(seconds / 86_400)}d AGO`
}

export default function WorldMap({ events, selectedId, onSelect, thresholdNpr }: WorldMapProps) {
  const mappableEvents = useMemo(() => events.filter((event) => event.location), [events])
  const selected = events.find((event) => event.id === selectedId) ?? events[0] ?? null
  const selectedVerdict = selected ? verdictForImpact(selected.nepalImpactNprPerTola, thresholdNpr) : 'unavailable'
  const eventList = events.slice(0, 7)

  return (
    <section className="panel world-panel" id="world-radar">
      <div className="section-heading world-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-index">07</span> Global event radar <span className="eyebrow-separator">/</span> XAU sensitivity</div>
          <h2>Live event map <span className="heading-dot">/</span> risk pins</h2>
          <p>Named country/region anchors from live headlines. Pins show isolated sensitivity, not incident coordinates.</p>
        </div>
        <div className="world-scan-status"><span className="radar-sweep-mark"><Radio size={13} /></span><span><b>{mappableEvents.length.toString().padStart(2, '0')}</b> GEO-LOCATED</span><i /></div>
      </div>

      <div className="world-map-layout">
        <div className="world-map-side">
          <div className="map-topline"><span><Crosshair size={12} /> LIVE RISK SURFACE</span><span>SCHEMATIC · EQUIRECTANGULAR</span></div>
          <div className="map-canvas">
            <svg viewBox="0 0 960 460" role="img" aria-label="Stylized world map with live geopolitical and natural calamity markers">
              <defs>
                <linearGradient id="worldLand" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#203237" /><stop offset="100%" stopColor="#142126" /></linearGradient>
                <radialGradient id="worldHalo"><stop offset="0%" stopColor="#c8a85f" stopOpacity=".14" /><stop offset="100%" stopColor="#c8a85f" stopOpacity="0" /></radialGradient>
                <pattern id="worldDots" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#668077" opacity=".16" /></pattern>
              </defs>
              <rect width="960" height="460" rx="10" fill="#0b1317" />
              <rect width="960" height="460" rx="10" fill="url(#worldDots)" opacity=".7" />
              <ellipse cx="500" cy="224" rx="466" ry="224" fill="url(#worldHalo)" />
              <g className="map-graticule" fill="none">
                <path d="M20 78 Q480 114 940 78" /><path d="M8 132 Q480 159 952 132" /><path d="M3 190 Q480 201 957 190" /><path d="M2 248 Q480 250 958 248" /><path d="M13 308 Q480 292 947 308" /><path d="M34 372 Q480 337 926 372" />
                <path d="M126 16 Q197 230 126 444" /><path d="M256 8 Q300 230 256 452" /><path d="M380 2 Q398 230 380 458" /><path d="M500 0 Q500 230 500 460" /><path d="M620 2 Q602 230 620 458" /><path d="M744 8 Q700 230 744 452" /><path d="M864 16 Q793 230 864 444" />
                <ellipse cx="480" cy="230" rx="468" ry="219" />
              </g>
              <g className="map-land" fill="url(#worldLand)" stroke="#456066" strokeWidth="1.1" strokeLinejoin="round">
                <path d="M87 97 111 76 139 70 158 57 189 64 207 73 231 71 250 81 270 87 280 104 270 120 257 130 248 150 231 162 220 176 207 178 200 194 185 205 177 222 164 229 153 214 142 206 131 190 118 182 108 164 96 155 88 137 72 122 76 107Z" />
                <path d="M241 191 255 183 271 188 281 201 289 206 297 223 309 233 315 254 325 269 326 291 320 310 311 326 302 348 292 369 281 357 277 335 269 317 265 299 258 282 252 262 244 244 239 222 233 206Z" />
                <path d="M257 52 272 42 290 44 304 54 299 66 284 70 270 65Z" />
                <path d="M417 113 431 102 448 101 459 108 468 105 480 112 493 107 505 113 514 122 509 132 498 136 494 148 483 151 475 144 460 146 450 141 437 145 427 138 416 131Z" />
                <path d="M418 151 434 144 448 148 462 151 472 162 484 167 492 184 500 198 500 221 493 244 488 267 478 290 467 308 455 326 441 312 432 289 426 265 417 244 412 219 408 195 409 173Z" />
                <path d="M500 114 519 101 538 99 555 105 573 96 596 97 613 91 630 94 650 85 671 89 688 94 705 89 721 96 742 92 763 103 779 100 801 108 817 103 837 115 858 121 873 132 861 145 840 149 823 159 804 164 789 177 772 180 760 193 744 188 730 177 717 184 706 173 695 178 683 166 670 171 656 158 640 164 626 153 608 159 594 150 578 158 563 147 550 153 538 143 523 143 512 132Z" />
                <path d="M569 165 582 158 597 162 605 174 599 189 591 202 585 218 575 225 566 213 564 198 557 185Z" />
                <path d="M606 174 620 166 637 167 646 178 650 192 644 206 637 221 630 235 621 226 617 210 611 198Z" />
                <path d="M652 198 665 193 679 199 688 211 693 225 703 236 701 248 690 252 681 241 672 232 664 218Z" />
                <path d="M700 161 710 152 720 155 727 164 721 174 713 180 705 174Z" />
                <path d="M726 150 735 140 745 144 752 154 748 169 740 178 733 171Z" />
                <path d="M677 269 695 263 714 267 728 274 742 273 751 283 744 294 729 298 716 293 700 297 689 290 678 283Z" />
                <path d="M746 321 762 307 784 306 804 312 824 313 841 323 845 337 833 350 816 359 800 371 780 369 763 360 750 347 741 335Z" />
                <path d="M864 283 875 279 884 286 880 298 870 300Z" />
                <path d="M354 170 364 166 370 172 367 181 357 183Z" />
              </g>
              <g className="map-region-labels" aria-hidden="true">
                <text x="165" y="136">NORTH AMERICA</text><text x="283" y="283">SOUTH AMERICA</text><text x="453" y="126">EUROPE</text><text x="447" y="236">AFRICA</text><text x="678" y="133">ASIA</text><text x="792" y="338">OCEANIA</text><text x="552" y="188">MIDDLE EAST</text>
              </g>
              <g className="map-pin-layer">
                {mappableEvents.map((event, index) => {
                  const tone = categoryTone(event)
                  const selected = event.id === selectedId
                  const offset = (index % 3) * 4
                  return (
                    <g
                      key={event.id}
                      transform={`translate(${event.location!.x + offset} ${event.location!.y + offset})`}
                      className={`map-marker ${tone} ${selected ? 'selected' : ''} ${event.isSimulated ? 'simulated' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${event.category} at ${event.location!.label}: ${formatEventVerdict(event, thresholdNpr)}`}
                      onClick={() => onSelect(event.id)}
                      onKeyDown={(keyboard) => { if (keyboard.key === 'Enter' || keyboard.key === ' ') onSelect(event.id) }}
                    >
                      <circle className="pin-halo" r="22" />
                      <circle className="radar-ring ring-one" r="7" />
                      <circle className="radar-ring ring-two" r="7" />
                      <circle className="radar-ring ring-three" r="7" />
                      <circle className="pin-core" r="4.7" />
                      <circle className="pin-center" r="1.35" />
                      {event.isSimulated && <text className="pin-sim-label" x="8" y="-8">SIM</text>}
                      <title>{event.location!.label} · {event.title}</title>
                    </g>
                  )
                })}
              </g>
              <g className="map-coord-labels" aria-hidden="true"><text x="15" y="25">45° N</text><text x="15" y="235">0°</text><text x="15" y="445">45° S</text><text x="855" y="445">NPT / UTC+05:45</text></g>
            </svg>
            {!mappableEvents.length && <div className="map-no-pins"><Globe2 size={22} /><b>No geolocated crisis or calamity headlines</b><span>When the feed names a country or region, its radar pin appears here. Unlocated headlines are not guessed onto the map.</span></div>}
            <div className="map-live-chip"><i />LIVE HEADLINE PINS</div>
          </div>
          <div className="map-legend"><span><i className="legend-conflict" /> GEOPOLITICAL</span><span><i className="legend-calamity" /> CALAMITY</span><span><i className="legend-sim" /> SIMULATED</span><span className="map-precision"><MapPin size={11} /> Country/region anchors only</span></div>
        </div>

        <aside className="world-event-rail">
          <div className="world-event-rail-head"><span><Waves size={13} /> EVENT STREAM</span><b>{events.length.toString().padStart(2, '0')} EVENTS</b></div>
          {selected && <div className={`selected-event-card ${categoryTone(selected)} ${selected.isSimulated ? 'simulated' : ''}`}>
            <div className="selected-event-top"><span>{selectedId ? selected.isSimulated ? 'SIMULATED SCENARIO · OVERLAID' : `${selected.category.toUpperCase()} · OVERLAID` : 'PREVIEW ONLY · CLICK TO APPLY'}</span><span>{relativeTime(selected.publishedAt)}</span></div>
            <h3>{selected.title}</h3>
            <div className="selected-event-location"><MapPin size={12} />{selected.location?.label ?? 'Location not verified'} <i>·</i>{selected.location?.region ?? 'Unlocated'}</div>
            <div className={`event-verdict verdict-${selectedVerdict}`}>
              {selectedVerdict === 'positive' && <span>YES · UPSIDE</span>}
              {selectedVerdict === 'negative' && <span>YES · DOWNSIDE</span>}
              {selectedVerdict === 'no-impact' && <span>NO IMPACT · ABSORBED</span>}
              {selectedVerdict === 'unavailable' && <span>IMPACT UNAVAILABLE</span>}
              <b>{formatEventVerdict(selected, thresholdNpr)}</b>
            </div>
            <div className="event-impact-pair"><div><span>GLOBAL XAU / OZ</span><b className={selected.globalImpactUsd === null ? '' : selected.globalImpactUsd >= 0 ? 'positive' : 'negative'}>{selected.globalImpactUsd === null ? '—' : `${selected.globalImpactUsd >= 0 ? '+' : '−'}$${Math.abs(selected.globalImpactUsd).toFixed(2)}`}</b></div><div><span>NEPAL / TOLA</span><b className={selected.nepalImpactNprPerTola === null ? '' : selected.nepalImpactNprPerTola >= 0 ? 'positive' : 'negative'}>{selected.nepalImpactNprPerTola === null ? '—' : `${selected.nepalImpactNprPerTola >= 0 ? '+' : '−'}Rs ${Math.abs(selected.nepalImpactNprPerTola).toLocaleString('en-IN')}`}</b></div></div>
            <p>{selected.reasoning}</p>
            <div className="selected-event-method">ISOLATED {selected.globalImpactPct >= 0 ? '+' : ''}{selected.globalImpactPct.toFixed(3)}% SENSITIVITY · NOT A CALIBRATED FORECAST</div>
            {selected.url && <a className="event-source-link" href={selected.url} target="_blank" rel="noopener noreferrer">SOURCE · {selected.source}<ExternalLink size={11} /></a>}
          </div>}
          {selected && !selectedId && <div className="event-map-select-note"><Crosshair size={11} /> Select a pin or event row to overlay its isolated impact on the forecast cone.</div>}
          <div className="event-stream-list">
            {eventList.map((event) => {
              const verdict = verdictForImpact(event.nepalImpactNprPerTola, thresholdNpr)
              const verdictLabel = verdict === 'positive' ? 'YES ↑' : verdict === 'negative' ? 'YES ↓' : verdict === 'no-impact' ? 'NO' : 'N/A'
              return (
                <button key={event.id} className={`event-stream-item ${selectedId === event.id ? 'active' : ''}`} onClick={() => onSelect(event.id)} title={event.reasoning}>
                  <span className={`event-stream-dot ${categoryTone(event)} ${event.isSimulated ? 'simulated' : ''}`} />
                  <span className="event-stream-copy"><b>{event.location?.label ?? 'UNLOCATED EVENT'}</b><small>{event.title}</small></span>
                  <span className={`event-mini-verdict ${verdict}`} aria-label={formatEventVerdict(event, thresholdNpr)}>{verdictLabel}</span>
                </button>
              )
            })}
            {!events.length && <div className="event-stream-empty"><AlertTriangle size={15} /><span>Monitoring conflict and natural-calamity headlines. No qualifying recent event has been verified.</span></div>}
          </div>
        </aside>
      </div>
      <div className="world-map-footnote"><AlertTriangle size={12} />Location pins are approximate named-country/region anchors from RSS headlines—not verified incident coordinates. Every impact shown is an isolated rules-based sensitivity; live gold response depends on DXY, real yields, liquidity, currency and actual market pricing.</div>
    </section>
  )
}
