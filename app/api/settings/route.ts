import { NextRequest, NextResponse } from 'next/server'
import { getParitySettings, saveParitySettings } from '@/data/jsonStore'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  return NextResponse.json({ settings: await getParitySettings() }, { headers })
}

export async function POST(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const settings = await saveParitySettings(body?.settings ?? body)
    return NextResponse.json({ settings }, { headers })
  } catch {
    return NextResponse.json({ error: 'Unable to save parity settings.' }, { status: 400, headers })
  }
}
