'use client'

import { ChevronDown, CircleHelp } from 'lucide-react'
import type { ForecastWhyFactor } from '@/lib/types'

export default function ForecastWhyPanel({ factors, language = 'en', local = false, unavailableReason }: { factors: ForecastWhyFactor[]; language?: 'en' | 'ne'; local?: boolean; unavailableReason?: string }) {
  const title = language === 'ne' ? 'किन यो पूर्वानुमान?' : 'Why this forecast?'
  const sign = (value: number) => value > 0 ? '+' : value < 0 ? '−' : ''
  const impact = (factor: ForecastWhyFactor) => factor.unit === 'percent'
    ? `${sign(factor.impact)}${Math.abs(factor.impact).toFixed(3)} pp`
    : `${sign(factor.impact)}Rs ${Math.abs(factor.impact).toLocaleString('en-IN', { maximumFractionDigits: 0 })}/tola`
  return <details className="forecast-why-panel"><summary><CircleHelp size={12} /><span>{title}</span><b>{factors.length ? `${factors.length} ${language === 'ne' ? 'कारक' : 'factors'}` : ''}</b><ChevronDown size={12} /></summary>
    <div className="forecast-why-content">{factors.length ? <><div className="forecast-why-list">{factors.map((factor) => <div className="forecast-why-row" key={factor.key} title={`${factor.source}${factor.asOf ? ` · ${factor.asOf}` : ''}`}><span><b>{factor.label}</b><small>{factor.source}{factor.asOf ? ` · ${factor.asOf.slice(0, 10)}` : ''}</small></span><strong className={factor.impact > 0 ? 'positive' : factor.impact < 0 ? 'negative' : ''}>{impact(factor)}</strong></div>)}</div><p>{local ? (language === 'ne' ? 'विश्व मोडेलका प्रतिशत योगदान आधिकारिक २४K आधारमा पास-थ्रु गरिएको अनुमान हो; FX समायोजन छुट्टै देखाइएको छ। यो क्यालिब्रेटेड एट्रिब्युसन होइन।' : 'Global model percentage terms are passed through the official 24K anchor; FX adjustment is separate. This is not a calibrated attribution.') : (language === 'ne' ? 'देखाइएका चिह्नित योगदान वास्तविक मोडेल सूत्र र ताजा इनपुटबाट हुन्। दायरा सीमा/घटना समायोजनले अन्तिम दायरा बदल्न सक्छ; यो सम्भाव्यता ग्यारेन्टी होइन।' : 'Signed terms come from model formulas and usable inputs only. Range caps, volatility regime, and event widening may alter the final range; these are not calibrated probabilities.')}</p></> : <div className="forecast-why-empty">{unavailableReason ?? (language === 'ne' ? 'यो पूर्वानुमानका लागि पुष्टि भएका योगदान उपलब्ध छैनन्; कारण अनुमान गरिएको छैन।' : 'No verified signed contributors are available for this forecast; no cause is inferred.')}</div>}</div>
  </details>
}
