import { NextResponse } from 'next/server'
import { getPredictionEntries } from '@/data/jsonStore'
import { buildAccuracySeries, calculateAccuracyMetrics } from '@/tracking/metrics'
import { calculateBaselineComparison, calculateCalibrationSummary, summarizeFixingWindowQuality } from '@/tracking/stage4'
import type { ProbabilisticInstrumentForecast } from '@/lib/types'

export const dynamic = 'force-dynamic'
const instruments: ProbabilisticInstrumentForecast['instrument'][] = ['xau-usd', 'nepal-24k', 'nepal-22k', 'nepal-tejabi']

export async function GET() {
  try {
    const entries = await getPredictionEntries()
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalLogged: entries.length,
      fixingWindowQuality: summarizeFixingWindowQuality(entries),
      metrics: calculateAccuracyMetrics(entries),
      baselines: {
        'xau-usd': calculateBaselineComparison(entries, 'xau-usd'),
        'nepal-24k': calculateBaselineComparison(entries, 'nepal-24k'),
      },
      calibrations: Object.fromEntries(instruments.map((instrument) => [instrument, calculateCalibrationSummary(entries, instrument)])),
      series: buildAccuracySeries(entries),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch {
    return NextResponse.json({ error: 'Accuracy history is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
