import { NextRequest, NextResponse } from 'next/server'
import { validateStorageBackup } from '@/data/backup'
import { invalidateJsonStoreCache } from '@/data/jsonStore'
import { exportStorageBackup, restoreStorageBackup } from '@/data/storage'
import { requireAdminWrite } from '@/lib/adminRoute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  try {
    const backup = await exportStorageBackup()
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="aurum-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Storage backup export failed.' }, { status: 503, headers })
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdminWrite(request)
  if (denied) return denied
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 25 * 1024 * 1024) return NextResponse.json({ error: 'Backup exceeds the 25 MiB restore limit.' }, { status: 413, headers })
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 25 * 1024 * 1024) return NextResponse.json({ error: 'Backup exceeds the 25 MiB restore limit.' }, { status: 413, headers })
    const parsed = validateStorageBackup(JSON.parse(raw))
    if (!parsed.valid) return NextResponse.json({ error: 'Backup validation failed; no data was changed.', details: parsed.errors }, { status: 400, headers })
    await restoreStorageBackup(parsed.backup)
    invalidateJsonStoreCache()
    return NextResponse.json({ restored: true, version: parsed.backup.version, message: 'Validated backup restored. No automatic migration was performed.' }, { headers })
  } catch {
    return NextResponse.json({ error: 'Backup restore failed; verify the file and storage permissions.' }, { status: 400, headers })
  }
}
