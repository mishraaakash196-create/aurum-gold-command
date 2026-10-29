import { NextRequest, NextResponse } from 'next/server'
import { deleteManualOfficialRate, getManualOfficialRates, upsertManualOfficialRate } from '@/data/jsonStore'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET() {
  return NextResponse.json({ entries: await getManualOfficialRates() }, { headers })
}

export async function POST(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const result = await upsertManualOfficialRate(body)
    if (!result.entry) return NextResponse.json({ error: 'Manual rate was not saved.', fields: result.errors }, { status: 400, headers })
    return NextResponse.json({ entry: result.entry }, { headers })
  } catch {
    return NextResponse.json({ error: 'Manual rate could not be saved.' }, { status: 400, headers })
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'A valid ISO date is required.' }, { status: 400, headers })
  const deleted = await deleteManualOfficialRate(date)
  return NextResponse.json({ deleted }, { headers })
}
