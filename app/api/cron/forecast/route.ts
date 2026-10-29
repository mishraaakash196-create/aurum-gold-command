import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createPrediction } from '@/lib/predictionService'
import { logAndReconcilePrediction } from '@/tracking/predictionLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

function hasValidCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? ''
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('x-cron-secret') ?? ''
  if (!expected || !supplied) return false
  const expectedDigest = createHmac('sha256', 'aurum-cron-check').update(expected).digest()
  const suppliedDigest = createHmac('sha256', 'aurum-cron-check').update(supplied).digest()
  return timingSafeEqual(expectedDigest, suppliedDigest)
}

export async function POST(request: NextRequest) {
  if (!hasValidCronSecret(request)) return NextResponse.json({ error: 'Valid CRON_SECRET is required.' }, { status: 401, headers })
  try {
    const body = await request.json().catch(() => ({})) as { mode?: unknown }
    const mode = body?.mode === 'reconcile' ? 'reconcile' : body?.mode === 'forecast' || body?.mode === undefined ? 'forecast' : null
    if (!mode) return NextResponse.json({ error: 'mode must be forecast or reconcile.' }, { status: 400, headers })
    if (mode === 'forecast') {
      const prediction = await createPrediction({ forceRefresh: true, persist: true })
      return NextResponse.json({ ok: true, mode, generatedAt: prediction.market.generatedAt, targetDate: prediction.nepalTiming?.targetDate, logged: true, reconciled: true }, { headers })
    }
    const prediction = await createPrediction({ persist: false, useAi: false })
    await logAndReconcilePrediction(prediction, false)
    return NextResponse.json({ ok: true, mode, generatedAt: prediction.market.generatedAt, reconciled: true, logged: false }, { headers })
  } catch {
    return NextResponse.json({ error: 'Scheduled forecast or reconciliation failed.' }, { status: 503, headers })
  }
}
