import { NextRequest, NextResponse } from 'next/server'
import { getOfficialRateHistory } from '@/data/jsonStore'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam === '365' ? 365 : daysParam === '7' ? 7 : 30
  const records = await getOfficialRateHistory()
  const latestDate = records.at(-1)?.date
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => today.find((item) => item.type === name)?.value ?? '00'
  const currentDate = `${part('year')}-${part('month')}-${part('day')}`
  const cutoff = new Date(`${currentDate}T12:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1))
  const from = cutoff.toISOString().slice(0, 10)
  return NextResponse.json({ records: records.filter((record) => record.date >= from), totalStored: records.length, from, through: latestDate ?? null }, {
    headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
  })
}
