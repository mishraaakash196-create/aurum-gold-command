import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve('.next/static')
const secretNames = [
  'ADMIN_PASSWORD', 'CRON_SECRET', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'FRED_API_KEY', 'CME_FEDWATCH_BEARER_TOKEN',
]
const configured = secretNames.map((name) => [name, process.env[name]?.trim() ?? '']).filter(([, value]) => value.length >= 8)
const files = []
async function walk(directory) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(full)
    else files.push(full)
  }
}
await walk(root)
if (!files.length) {
  console.error('Client-bundle secret scan failed: no .next/static assets were found.')
  process.exit(1)
}
const leaks = []
for (const file of files) {
  const bytes = await readFile(file)
  for (const [name, value] of configured) if (bytes.includes(Buffer.from(value))) leaks.push({ file, name })
}
if (leaks.length) {
  console.error('Client-bundle secret scan failed:', leaks)
  process.exitCode = 1
} else {
  console.log(`Client-bundle secret scan passed (${files.length} static assets; ${configured.length} configured secret values checked).`)
}
