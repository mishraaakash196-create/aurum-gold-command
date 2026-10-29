import { NextRequest, NextResponse } from 'next/server'
import { getAlarmSettings, saveAlarmSettings } from '@/data/jsonStore'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET() {
  return NextResponse.json({ settings: await getAlarmSettings() }, { headers })
}

export async function POST(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const settings = await saveAlarmSettings(body?.settings ?? body)
    return NextResponse.json({ settings }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save alarm settings.' }, { status: 400, headers })
  }
}
