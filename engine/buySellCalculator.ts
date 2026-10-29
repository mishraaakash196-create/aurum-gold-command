export const TOLA_GRAMS = 11.6638038
export const NEPAL_VAT_RATE = 0.13

export interface BuySellCalculatorInput {
  mode: 'buy' | 'sell'
  weight: number
  unit: 'tola' | 'gram'
  karat: '24k' | 'tejabi'
  rate24kPerTolaNpr: number | null
  rateTejabiPerTolaNpr: number | null
  learnedTejabiRatio?: number | null
  makingPct: number
  wastagePct: number
}

export interface BuySellCalculatorResult {
  valid: boolean
  error?: string
  sourceLabel: string
  ratePerTolaNpr: number | null
  weightTola: number
  goldValueNpr: number | null
  makingNpr: number | null
  wastageNpr: number | null
  vatNpr: number | null
  totalNpr: number | null
}

export function calculateBuySell(input: BuySellCalculatorInput): BuySellCalculatorResult {
  const empty = { weightTola: 0, goldValueNpr: null, makingNpr: null, wastageNpr: null, vatNpr: null, totalNpr: null }
  if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 10_000) return { valid: false, error: 'Weight must be greater than 0 and no more than 10,000 units.', sourceLabel: 'Unavailable', ratePerTolaNpr: null, ...empty }
  if (![input.makingPct, input.wastagePct].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) return { valid: false, error: 'Making and wastage percentages must be between 0 and 100.', sourceLabel: 'Unavailable', ratePerTolaNpr: null, ...empty }
  const rate24 = input.rate24kPerTolaNpr
  if (rate24 === null || !Number.isFinite(rate24) || rate24 <= 0) return { valid: false, error: 'A current official 24K benchmark is unavailable.', sourceLabel: 'Unavailable', ratePerTolaNpr: null, ...empty }
  let rate: number
  let sourceLabel: string
  if (input.karat === '24k') {
    rate = rate24
    sourceLabel = '24K FENEGOSIDA benchmark'
  } else if (input.rateTejabiPerTolaNpr !== null && Number.isFinite(input.rateTejabiPerTolaNpr) && input.rateTejabiPerTolaNpr > 0) {
    rate = input.rateTejabiPerTolaNpr
    sourceLabel = 'Separate Tejabi fixing'
  } else if (input.learnedTejabiRatio !== null && input.learnedTejabiRatio !== undefined && Number.isFinite(input.learnedTejabiRatio) && input.learnedTejabiRatio >= 0.9 && input.learnedTejabiRatio <= 1.05) {
    rate = rate24 * input.learnedTejabiRatio
    sourceLabel = 'Tejabi estimate · learned/manual ratio (not an official fixing)'
  } else {
    return { valid: false, error: 'A Tejabi fixing or valid learned ratio is unavailable.', sourceLabel: 'Unavailable', ratePerTolaNpr: null, ...empty }
  }
  const weightTola = input.unit === 'tola' ? input.weight : input.weight / TOLA_GRAMS
  const goldValueNpr = rate * weightTola
  if (input.mode === 'buy') {
    const makingNpr = goldValueNpr * input.makingPct / 100
    const wastageNpr = goldValueNpr * input.wastagePct / 100
    const vatNpr = (goldValueNpr + makingNpr + wastageNpr) * NEPAL_VAT_RATE
    return { valid: true, sourceLabel, ratePerTolaNpr: rate, weightTola, goldValueNpr, makingNpr, wastageNpr, vatNpr, totalNpr: goldValueNpr + makingNpr + wastageNpr + vatNpr }
  }
  // Indicative resale excludes original making charges and VAT; wastage is a user-entered deduction.
  const wastageNpr = goldValueNpr * input.wastagePct / 100
  return { valid: true, sourceLabel, ratePerTolaNpr: rate, weightTola, goldValueNpr, makingNpr: 0, wastageNpr, vatNpr: 0, totalNpr: goldValueNpr - wastageNpr }
}
