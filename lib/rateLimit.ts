interface Bucket {
  startsAt: number
  count: number
}

const globalLimits = globalThis as typeof globalThis & { __aurumRateLimits?: Map<string, Bucket> }

/** Small in-memory guard for user-supplied LLM requests; use a shared store at scale. */
export function checkRateLimit(key: string, limit = 12, windowMs = 60_000): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const store = globalLimits.__aurumRateLimits ?? new Map<string, Bucket>()
  globalLimits.__aurumRateLimits = store
  for (const [bucketKey, bucket] of store) {
    if (now - bucket.startsAt > windowMs * 2) store.delete(bucketKey)
  }
  const current = store.get(key)
  if (!current || now - current.startsAt >= windowMs) {
    store.set(key, { startsAt: now, count: 1 })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - current.startsAt)) / 1000)),
    }
  }
  current.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}
