export interface ManualOfficialRateInput {
  date: string
  rate24kTolaNpr: number
  tejabiTolaNpr: number
}

export interface ManualRateValidation {
  valid: boolean
  errors: Partial<Record<keyof ManualOfficialRateInput, string>>
}

export function validateManualOfficialRate(input: unknown, now = new Date()): ManualRateValidation {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const errors: ManualRateValidation['errors'] = {}
  const date = typeof value.date === 'string' ? value.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    errors.date = 'Enter a valid YYYY-MM-DD date.'
  } else {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    if (date > parts) errors.date = 'Future official-rate dates are not allowed.'
  }
  const fine = Number(value.rate24kTolaNpr)
  const tejabi = Number(value.tejabiTolaNpr)
  if (!Number.isFinite(fine) || fine < 10_000 || fine > 2_000_000) errors.rate24kTolaNpr = '24K tola rate must be between NPR 10,000 and 2,000,000.'
  if (!Number.isFinite(tejabi) || tejabi < 10_000 || tejabi > 2_000_000) errors.tejabiTolaNpr = 'Tejabi tola rate must be between NPR 10,000 and 2,000,000.'
  if (Number.isFinite(fine) && fine > 0 && Number.isFinite(tejabi) && tejabi > 0) {
    const ratio = tejabi / fine
    if (ratio < 0.9 || ratio > 1.05) errors.tejabiTolaNpr = 'Tejabi must be 90%–105% of the same-date 24K rate.'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}
