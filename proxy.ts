import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

export function proxy(request: NextRequest) {
  const ip = request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown-client'
  const path = request.nextUrl.pathname
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const sensitive = path.startsWith('/api/admin/') || path.startsWith('/api/cron/') || path === '/api/predict' || (path === '/api/market' && forceRefresh)
  const limit = sensitive ? 12 : isWrite ? 30 : 120
  const result = checkRateLimit(`${path}:${ip}`, limit, 60_000)
  if (!result.allowed) {
    return NextResponse.json({ error: 'Too many requests. Wait briefly and try again.' }, {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSeconds), 'Cache-Control': 'no-store' },
    })
  }
  return NextResponse.next()
}

export const config = { matcher: ['/api/:path*'] }
