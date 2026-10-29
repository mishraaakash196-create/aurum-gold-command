import { NextResponse } from 'next/server'
import { getStorageHealth } from '@/data/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const storage = await getStorageHealth()
    const degraded = !storage.writable || storage.ephemeral
    return NextResponse.json({
      status: degraded ? 'degraded' : 'ok',
      service: 'aurum-nepal-gold-terminal',
      timestamp: new Date().toISOString(),
      storage,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch {
    return NextResponse.json({
      status: 'degraded',
      service: 'aurum-nepal-gold-terminal',
      timestamp: new Date().toISOString(),
      storage: { backend: 'unavailable', writable: false, ephemeral: true, configured: false, warning: 'Storage health could not be determined.' },
    }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }
}
