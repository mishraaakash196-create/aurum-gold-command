import { NextResponse } from 'next/server'
import { getMarketData } from '@/lib/marketData'
import { replayOhlcvBacktest } from '@/tracking/backtest'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const market = await getMarketData(false)
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      source: market.historySource,
      backtest: replayOhlcvBacktest(market.candles),
      note: 'Chronological technical-only OHLCV replay. Each estimate uses candles available before its next-session target; historical macro snapshots are not stored.',
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch {
    return NextResponse.json({ error: 'Historical OHLCV backtest is unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
