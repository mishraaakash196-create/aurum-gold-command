import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/cron/forecast/route'

const prior = process.env.CRON_SECRET

test('scheduled forecast route rejects requests without the server cron bearer secret', async () => {
  process.env.CRON_SECRET = 'cron-test-secret-not-used-for-network'
  const missing = await POST(new NextRequest('http://localhost/api/cron/forecast', { method: 'POST' }))
  assert.equal(missing.status, 401)
  const wrong = await POST(new NextRequest('http://localhost/api/cron/forecast', { method: 'POST', headers: { authorization: 'Bearer wrong-secret' } }))
  assert.equal(wrong.status, 401)
})

test.after(() => {
  if (prior === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = prior
})
