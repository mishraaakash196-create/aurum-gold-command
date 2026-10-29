import { NextRequest, NextResponse } from 'next/server'
import { createPrediction } from '@/lib/predictionService'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1'
  if (refresh) {
    const denied = requireAdminWrite(request)
    if (denied) return denied
  }
  try {
    const prediction = await createPrediction({ forceRefresh: refresh, persist: false })
    return NextResponse.json(prediction, { status: 200, headers: noStoreHeaders })
  } catch {
    return NextResponse.json(
      { error: 'Prediction service could not assemble current market data. Retry shortly; no placeholder prices are served.' },
      { status: 503, headers: noStoreHeaders },
    )
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 20_000) {
    return NextResponse.json({ error: 'Request is too large.' }, { status: 413, headers: noStoreHeaders })
  }
  try {
    const body = await request.json()
    const headline = typeof body?.headline === 'string' ? body.headline.trim().slice(0, 500) : ''
    const refresh = body?.refresh === true
    if (refresh) {
      const denied = requireAdminWrite(request)
      if (denied) return denied
    }
    // Provider/key/model selection is never accepted from the browser; server env configuration wins.
    const prediction = await createPrediction({ forceRefresh: refresh, headline, persist: false })
    return NextResponse.json(prediction, { status: 200, headers: noStoreHeaders })
  } catch {
    return NextResponse.json(
      { error: 'Analysis request failed. The market feed may be unavailable; no placeholder prices are served.' },
      { status: 503, headers: noStoreHeaders },
    )
  }
}
