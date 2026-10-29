import { NextResponse, type NextRequest } from 'next/server'
import { adminPasswordConfigured, isAdminRequest, isSameOriginRequest } from '@/lib/adminAuth'

export function requireAdminWrite(request: NextRequest): NextResponse | null {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Cross-origin write rejected.' }, { status: 403 })
  if (!adminPasswordConfigured()) return NextResponse.json({ error: 'Admin writes are disabled until ADMIN_PASSWORD is configured.' }, { status: 503 })
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401 })
  return null
}
