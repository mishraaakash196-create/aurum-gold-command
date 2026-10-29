export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  if (!process.env.TURSO_DATABASE_URL?.trim() || !process.env.TURSO_AUTH_TOKEN?.trim()) return
  try {
    const { initializeStorage } = await import('@/data/storage')
    await initializeStorage()
  } catch (error) {
    console.error('AURUM could not initialize Turso tables at startup; health will report storage unavailable.', error)
  }
}
