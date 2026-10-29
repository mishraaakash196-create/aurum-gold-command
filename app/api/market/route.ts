import { NextRequest, NextResponse } from 'next/server'
import { getMarketData } from '@/lib/marketData'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1'
  if (refresh) {
    const denied = requireAdminWrite(request)
    if (denied) return denied
  }
  try {
    const market = await getMarketData(refresh)
    return NextResponse.json(market, {
      status: market.status === 'unavailable' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
    })
  } catch {
    return NextResponse.json(
      { error: 'Live market feeds are unavailable. No static price fallback is configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
