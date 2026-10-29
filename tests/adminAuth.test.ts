import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { ADMIN_COOKIE, createAdminSessionToken, verifyAdminSessionToken } from '@/lib/adminAuth'
import { requireAdminWrite } from '@/lib/adminRoute'
import { POST as settingsPost } from '@/app/api/settings/route'
import { POST as manualPost, DELETE as manualDelete } from '@/app/api/manual-official-rates/route'
import { POST as alarmPost } from '@/app/api/alarm-settings/route'
import { GET as backupGet, POST as backupPost } from '@/app/api/admin/backup/route'
import { GET as predictGet, POST as predictPost } from '@/app/api/predict/route'
import { GET as marketGet } from '@/app/api/market/route'

const previous = process.env.ADMIN_PASSWORD

 test('admin password sessions are signed, expiring and checked by the shared write-route guard', () => {
  process.env.ADMIN_PASSWORD = 'test-only-admin-password-2026'
  const now = Date.now()
  const token = createAdminSessionToken(process.env.ADMIN_PASSWORD, now)
  assert.equal(verifyAdminSessionToken(token, process.env.ADMIN_PASSWORD, now + 1_000), true)
  assert.equal(verifyAdminSessionToken(`${token}x`, process.env.ADMIN_PASSWORD, now + 1_000), false)
  assert.equal(verifyAdminSessionToken(token, process.env.ADMIN_PASSWORD, now + 8 * 60 * 60 * 1000 + 1), false)

  const anonymous = new NextRequest('http://localhost/api/settings', { method: 'POST' })
  const denied = requireAdminWrite(anonymous)
  assert.equal(denied?.status, 401)
  const signedIn = new NextRequest('http://localhost/api/settings', {
    method: 'POST',
    headers: { cookie: `${ADMIN_COOKIE}=${token}`, origin: 'http://localhost' },
  })
  assert.equal(requireAdminWrite(signedIn), null)
  const foreignOrigin = new NextRequest('http://localhost/api/settings', {
    method: 'POST',
    headers: { cookie: `${ADMIN_COOKIE}=${token}`, origin: 'https://attacker.example' },
  })
  assert.equal(requireAdminWrite(foreignOrigin)?.status, 403)
})

test('persistent write handlers reject anonymous requests before touching storage', async () => {
  process.env.ADMIN_PASSWORD = 'test-only-admin-password-2026'
  const json = (url: string) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(url).origin }, body: '{}' })
  assert.equal((await settingsPost(json('http://localhost/api/settings'))).status, 401)
  assert.equal((await manualPost(json('http://localhost/api/manual-official-rates'))).status, 401)
  assert.equal((await manualDelete(new NextRequest('http://localhost/api/manual-official-rates?date=2026-01-01', { method: 'DELETE' }))).status, 401)
  assert.equal((await alarmPost(json('http://localhost/api/alarm-settings'))).status, 401)
  assert.equal((await backupGet(new NextRequest('http://localhost/api/admin/backup'))).status, 401)
  assert.equal((await backupPost(json('http://localhost/api/admin/backup'))).status, 401)
  assert.equal((await predictGet(new NextRequest('http://localhost/api/predict?refresh=1'))).status, 401)
  assert.equal((await predictPost(new NextRequest('http://localhost/api/predict', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: '{\"refresh\":true}' }))).status, 401)
  assert.equal((await marketGet(new NextRequest('http://localhost/api/market?refresh=1'))).status, 401)
})

test.after(() => {
  if (previous === undefined) delete process.env.ADMIN_PASSWORD
  else process.env.ADMIN_PASSWORD = previous
})
