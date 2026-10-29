import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminCookieOptions, adminPasswordConfigured, createAdminSessionToken, isAdminRequest, isSameOriginRequest, verifyAdminPassword } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET(request: NextRequest) {
  return NextResponse.json({ configured: adminPasswordConfigured(), authenticated: isAdminRequest(request) }, { headers })
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Cross-origin sign-in rejected.' }, { status: 403, headers })
  if (!adminPasswordConfigured()) return NextResponse.json({ error: 'Set ADMIN_PASSWORD on the server to enable admin access.' }, { status: 503, headers })
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > 2_000) return NextResponse.json({ error: 'Request is too large.' }, { status: 413, headers })
  try {
    const body = await request.json()
    if (!verifyAdminPassword(body?.password)) return NextResponse.json({ error: 'Incorrect admin password.' }, { status: 401, headers })
    const response = NextResponse.json({ authenticated: true }, { headers })
    response.cookies.set(ADMIN_COOKIE, createAdminSessionToken(process.env.ADMIN_PASSWORD!), adminCookieOptions())
    return response
  } catch {
    return NextResponse.json({ error: 'Invalid sign-in request.' }, { status: 400, headers })
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Cross-origin sign-out rejected.' }, { status: 403, headers })
  const response = NextResponse.json({ authenticated: false }, { headers })
  response.cookies.set(ADMIN_COOKIE, '', { ...adminCookieOptions(), maxAge: 0 })
  return response
}
