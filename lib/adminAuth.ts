import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const ADMIN_COOKIE = 'aurum_admin_session'
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60
const MAX_FUTURE_SKEW_MS = 30_000

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim())
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

export function verifyAdminPassword(candidate: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? ''
  if (!expected || typeof candidate !== 'string') return false
  return constantTimeTextEqual(candidate, expected)
}

export function createAdminSessionToken(password: string, issuedAt = Date.now()): string {
  const timestamp = String(issuedAt)
  const signature = createHmac('sha256', password).update(`aurum-admin-session:v1:${timestamp}`).digest('base64url')
  return `${timestamp}.${signature}`
}

export function verifyAdminSessionToken(token: string | null | undefined, password = process.env.ADMIN_PASSWORD ?? '', now = Date.now()): boolean {
  if (!password || !token) return false
  const [timestamp, signature, extra] = token.split('.')
  if (!timestamp || !signature || extra !== undefined || !/^\d{13}$/.test(timestamp)) return false
  const issuedAt = Number(timestamp)
  if (!Number.isFinite(issuedAt) || issuedAt > now + MAX_FUTURE_SKEW_MS || now - issuedAt > ADMIN_SESSION_SECONDS * 1000) return false
  const expected = createHmac('sha256', password).update(`aurum-admin-session:v1:${timestamp}`).digest('base64url')
  return constantTimeTextEqual(signature, expected)
}

export function isAdminRequest(request: NextRequest): boolean {
  return verifyAdminSessionToken(request.cookies.get(ADMIN_COOKIE)?.value)
}

export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try { return new URL(origin).origin === request.nextUrl.origin } catch { return false }
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: ADMIN_SESSION_SECONDS,
  }
}
