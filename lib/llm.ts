import { z } from 'zod'
import type { AnalysisOutput, MarketSnapshot } from './types'
import type { QuantForecast } from './types'

export const AI_SYSTEM_INSTRUCTION = `You are an elite Quantitative Commodities Strategist and Geopolitical Risk Engine specializing in XAU/USD (Spot Gold) and Nepal's FENEGOSIDA physical bullion pricing structure.

Analyze the provided technical indicators (RSI, EMA, MACD, ATR), macroeconomic metrics (DXY, US 10Y Real Yields, Brent Crude, USD/NPR exchange rate), and breaking global news (armed conflicts, Middle East/Eastern Europe escalations, maritime blockades, central bank gold buying, Federal Reserve rate decisions).

Rules:

1. Distinguish between initial geopolitical escalations (strongly bullish safe-haven inflow) vs. liquidity selloffs where spiking DXY/equities margin calls cause temporary gold pullbacks.

2. Weigh geopolitical risk against US 10Y Real Yields and DXY movements.

3. Factor in USD/INR and USD/NPR exchange rate shifts that impact Nepal's 11:00 AM NPT domestic rate even when global XAU/USD is flat.

4. Output strictly valid JSON containing: geopolitical_risk_score (-10 to +10), macro_yield_score (-10 to +10), technical_momentum_score (-10 to +10), market_regime, global_forecast_24h (predicted_xau_usd, change_usd, change_pct, range_low, range_high, confidence_pct), nepal_forecast_11am (predicted_24k_tola_npr, predicted_22k_tola_npr, predicted_24k_10g_npr, expected_change_tola_npr), and key_drivers_explanation (array of headlines/metrics with BULLISH/BEARISH impact and institutional reasoning).

`

const modelDriverSchema = z.object({
  headline: z.string().optional(),
  metric: z.string().optional(),
  impact: z.string().optional(),
  score: z.number().finite().optional(),
  reasoning: z.string().optional(),
  institutional_reasoning: z.string().optional(),
  explanation: z.string().optional(),
}).passthrough()

const analysisSchema = z.object({
  geopolitical_risk_score: z.number().finite().min(-10).max(10),
  macro_yield_score: z.number().finite().min(-10).max(10),
  technical_momentum_score: z.number().finite().min(-10).max(10),
  market_regime: z.string().min(1).max(120),
  global_forecast_24h: z.object({
    predicted_xau_usd: z.number().finite().positive(),
    change_usd: z.number().finite(),
    change_pct: z.number().finite(),
    range_low: z.number().finite().positive(),
    range_high: z.number().finite().positive(),
    confidence_pct: z.number().finite().min(0).max(100),
  }),
  nepal_forecast_11am: z.object({
    predicted_24k_tola_npr: z.number().finite().positive(),
    predicted_22k_tola_npr: z.number().finite().positive(),
    predicted_24k_10g_npr: z.number().finite().positive(),
    expected_change_tola_npr: z.number().finite(),
  }),
  key_drivers_explanation: z.array(modelDriverSchema).max(24),
}).passthrough()

function formatMaybe(value: number | null, digits = 4): number | string {
  return value === null ? 'unavailable' : Number(value.toFixed(digits))
}

export interface ProviderRequest {
  provider?: ProviderChoice
  apiKey?: string
  model?: string
}

export interface ModelCallResult {
  provider: Exclude<ProviderChoice, 'auto'>
  model: string
  analysis: Partial<AnalysisOutput>
}

export interface ModelCallError {
  error: string
  provider?: Exclude<ProviderChoice, 'auto'>
}

export type ProviderChoice = 'auto' | 'openai' | 'gemini' | 'anthropic'

export function hasConfiguredProvider(request: ProviderRequest): boolean {
  return Boolean(selectProvider(request).key)
}

function selectProvider(request: ProviderRequest): {
  provider: Exclude<ProviderChoice, 'auto'> | null
  key: string | null
  model: string | null
} {
  const requested = request.provider ?? 'auto'
  const userKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : ''
  const envChoice = (process.env.AI_PROVIDER ?? '').toLowerCase()
  const envs: Record<Exclude<ProviderChoice, 'auto'>, { key: string | undefined; model: string | undefined }> = {
    openai: { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    gemini: { key: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL },
    anthropic: { key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL },
  }

  if (userKey) {
    const provider = requested === 'auto'
      ? (envChoice === 'openai' || envChoice === 'gemini' || envChoice === 'anthropic' ? envChoice : 'gemini')
      : requested
    const defaultModels = { openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', anthropic: 'claude-3-5-haiku-latest' }
    return {
      provider,
      key: userKey,
      model: request.model?.trim() || envs[provider].model || defaultModels[provider],
    }
  }

  const order: Exclude<ProviderChoice, 'auto'>[] = envChoice === 'openai'
    ? ['openai', 'gemini', 'anthropic']
    : envChoice === 'anthropic'
      ? ['anthropic', 'gemini', 'openai']
      : ['gemini', 'openai', 'anthropic']
  for (const provider of order) {
    const key = envs[provider].key?.trim()
    if (key) {
      const defaultModels = { openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', anthropic: 'claude-3-5-haiku-latest' }
      return { provider, key, model: request.model?.trim() || envs[provider].model || defaultModels[provider] }
    }
  }
  return { provider: null, key: null, model: null }
}

export function makeModelUserPrompt(market: MarketSnapshot, quant: QuantForecast, extraHeadline = ''): string {
  const macro = market.macro
  const input = {
    task: 'Forecast the next available global session and next FENEGOSIDA 11:00 NPT benchmark. Use the provided observations only.',
    as_of_utc: market.generatedAt,
    xau_usd_spot: {
      price: market.spot,
      as_of: market.spotAsOf,
      source: market.spotSource,
      stale: market.spotStale,
      daily_history_source: market.historySource,
    },
    technical_indicators: market.indicators ? {
      rsi_14: formatMaybe(market.indicators.rsi14, 2),
      ema_20: formatMaybe(market.indicators.ema20, 4),
      ema_50: formatMaybe(market.indicators.ema50, 4),
      ema_200: formatMaybe(market.indicators.ema200, 4),
      macd_histogram_usd: formatMaybe(market.indicators.macdHistogram, 4),
      bollinger_20_2sd: {
        upper: formatMaybe(market.indicators.bollingerUpper, 4),
        middle: formatMaybe(market.indicators.bollingerMiddle, 4),
        lower: formatMaybe(market.indicators.bollingerLower, 4),
      },
      atr_14_usd: formatMaybe(market.indicators.atr14, 4),
      rules_based_technical_score: market.indicators.technicalMomentumScore,
    } : 'unavailable',
    macroeconomic_metrics: {
      dxy: { value: formatMaybe(macro.dxy.value), change_pct: formatMaybe(macro.dxy.changePct), source: macro.dxy.source, as_of: macro.dxy.asOf },
      us_10y_tips_real_yield: { value_pct: formatMaybe(macro.real10y.value), change_pp: formatMaybe(macro.real10y.change), source: macro.real10y.source, as_of: macro.real10y.asOf },
      us_10y_nominal_yield: { value_pct: formatMaybe(macro.nominal10y.value), change_pp: formatMaybe(macro.nominal10y.change), source: macro.nominal10y.source, as_of: macro.nominal10y.asOf },
      fed_funds_futures_rate_path_proxy: { price: formatMaybe(macro.fedFundsFutures.value), price_change: formatMaybe(macro.fedFundsFutures.change), source: macro.fedFundsFutures.source, as_of: macro.fedFundsFutures.asOf, stale: macro.fedFundsFutures.stale, caveat: 'ZQ=F front-month 30-day federal-funds futures repricing proxy, not CME FedWatch next-meeting cut probability.' },
      brent_usd_per_barrel: { value: formatMaybe(macro.brent.value), change_pct: formatMaybe(macro.brent.changePct), source: macro.brent.source, as_of: macro.brent.asOf },
      usd_npr_nrb_selling: { value: formatMaybe(macro.nrbUsdNprSell.value), rate_date: macro.nrbUsdNprSell.rateDate, source: macro.nrbUsdNprSell.source, stale: macro.nrbUsdNprSell.stale },
      usd_npr_indicative_market: { value: formatMaybe(macro.usdNprSpot.value), change_pct: formatMaybe(macro.usdNprSpot.changePct), source: macro.usdNprSpot.source, as_of: macro.usdNprSpot.asOf },
      usd_npr_yahoo_daily_trend: { value: formatMaybe(macro.usdNprTrend.value), change_pct: formatMaybe(macro.usdNprTrend.changePct), source: macro.usdNprTrend.source, as_of: macro.usdNprTrend.asOf, stale: macro.usdNprTrend.stale, use: 'If fresh, relative daily move is applied to the selected USD/NPR parity level with a +/-0.5% cap.' },
      usd_npr_parity_conversion: { value: formatMaybe(macro.usdNprParity.value), source: macro.usdNprParity.source, as_of: macro.usdNprParity.asOf, stale: macro.usdNprParity.stale },
      usd_inr: { value: formatMaybe(macro.usdInr.value), change_pct: formatMaybe(macro.usdInr.changePct), source: macro.usdInr.source, as_of: macro.usdInr.asOf },
    },
    institutional_and_central_bank_demand: {
      status: market.institutionalDemand.status,
      provenance_rule: 'Reported WGC monthly and IMF reserve observations only. Missing or unavailable data are null; never substitute simulated values. Monthly reports are lagged and not real-time order flow.',
      central_bank_report: {
        provenance: market.institutionalDemand.centralBank.provenance,
        source: market.institutionalDemand.centralBank.source,
        url: market.institutionalDemand.centralBank.url,
        published_at: market.institutionalDemand.centralBank.publishedAt,
        reported_period: market.institutionalDemand.centralBank.period,
        reported_global_net_purchases_tonnes: formatMaybe(market.institutionalDemand.centralBank.netPurchasesTonnes),
        reported_ytd_purchases_tonnes: formatMaybe(market.institutionalDemand.centralBank.ytdPurchasesTonnes),
        stale: market.institutionalDemand.centralBank.stale,
        reported_country_purchases: market.institutionalDemand.centralBank.purchases.map((item) => ({
          country: item.country, monthly_net_tonnes: formatMaybe(item.monthlyTonnes), ytd_net_tonnes: formatMaybe(item.ytdTonnes), period: item.period,
        })),
      },
      global_gold_etf_report: {
        provenance: market.institutionalDemand.goldEtf.provenance,
        source: market.institutionalDemand.goldEtf.source,
        url: market.institutionalDemand.goldEtf.url,
        published_at: market.institutionalDemand.goldEtf.publishedAt,
        reported_period: market.institutionalDemand.goldEtf.period,
        net_flow_usd_bn: formatMaybe(market.institutionalDemand.goldEtf.netFlowUsdBn),
        holdings_change_tonnes: formatMaybe(market.institutionalDemand.goldEtf.holdingsChangeTonnes),
        stale: market.institutionalDemand.goldEtf.stale,
      },
      imf_irfcl_official_gold_reserves: market.institutionalDemand.goldReserves.map((reserve) => ({
        country: reserve.country, tonnes: formatMaybe(reserve.tonnes, 2), observation_month: reserve.asOf,
        change_tonnes: formatMaybe(reserve.changeTonnes, 2), stale: reserve.stale,
        anomaly_detected: reserve.anomalyDetected, source: reserve.sourceUrl, note: reserve.note,
      })),
      interpretation: 'Reserve stocks are long-term structural context; only fresh reported monthly purchase and ETF flow observations are allowed into the capped 24-hour demand overlay.',
    },
    macro_overlay_contributions_pct: quant.macroFactorContributions ?? 'unavailable',
    fenegosida_official_rate: {
      fine_24k_tola_npr: market.nepal.rate24kTola,
      fine_24k_10g_npr: market.nepal.rate24k10g,
      previous_24k_tola_npr: market.nepal.previous24kTola,
      rate_date: market.nepal.rateDate,
      source: market.nepal.rateSource,
      local_spread_pct: formatMaybe(market.localSpreadPct, 3),
      spread_method: market.localSpreadMethod,
      spread_matched_observations: market.localSpreadSamples,
      forecast_conversion: 'The server will recompute Nepal prices with the import-parity engine; use your local forecast fields only as a cross-check.',
    },
    algorithmic_baseline: {
      predicted_xau_usd: quant.predictedXauUsd,
      change_usd: quant.changeUsd,
      change_pct: quant.changePct,
      atr_range_low: quant.rangeLow,
      atr_range_high: quant.rangeHigh,
      confidence_pct: quant.confidencePct,
      method: quant.method,
    },
    recent_headlines: market.news.map((headline) => ({
      title: headline.title,
      source: headline.source,
      published_at: headline.publishedAt,
      url: headline.url,
    })),
    user_submitted_breaking_headline: extraHeadline.trim().slice(0, 500) || 'none',
    output_shape: {
      geopolitical_risk_score: 'number, -10 to +10',
      macro_yield_score: 'number, -10 to +10',
      technical_momentum_score: 'number, -10 to +10',
      market_regime: 'short string',
      global_forecast_24h: {
        predicted_xau_usd: 'number', change_usd: 'number', change_pct: 'number', range_low: 'number', range_high: 'number', confidence_pct: 'number 0-100',
      },
      nepal_forecast_11am: {
        predicted_24k_tola_npr: 'number', predicted_22k_tola_npr: 'number', predicted_24k_10g_npr: 'number', expected_change_tola_npr: 'number',
      },
      key_drivers_explanation: [{ headline: 'actual supplied headline or metric only', impact: 'BULLISH | BEARISH | NEUTRAL', score: 'number -10 to +10', institutional_reasoning: 'short explanation grounded in supplied observations' }],
    },
  }
  return JSON.stringify(input)
}

function parseJsonText(text: string): Partial<AnalysisOutput> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('The model returned no JSON object.')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(first, last + 1))
  } catch {
    throw new Error('The model response was not valid JSON.')
  }
  const checked = analysisSchema.safeParse(parsed)
  if (!checked.success) throw new Error('The model response did not match the required forecast schema.')
  const value = checked.data
  const drivers = value.key_drivers_explanation.map((item) => {
    const candidateImpact = String(item.impact ?? 'NEUTRAL').toUpperCase()
    const impact: AnalysisOutput['key_drivers_explanation'][number]['impact'] = candidateImpact === 'BULLISH' || candidateImpact === 'BEARISH' || candidateImpact === 'NEUTRAL'
      ? candidateImpact as AnalysisOutput['key_drivers_explanation'][number]['impact']
      : 'NEUTRAL'
    return {
      headline: (item.headline ?? item.metric ?? 'Unlabeled metric').trim().slice(0, 240),
      impact,
      score: Number.isFinite(item.score) ? Math.max(-10, Math.min(10, item.score as number)) : 0,
      reasoning: (item.institutional_reasoning ?? item.reasoning ?? item.explanation ?? 'No explanation supplied.').trim().slice(0, 700),
    }
  })
  return {
    geopolitical_risk_score: value.geopolitical_risk_score,
    macro_yield_score: value.macro_yield_score,
    technical_momentum_score: value.technical_momentum_score,
    market_regime: value.market_regime,
    global_forecast_24h: value.global_forecast_24h,
    nepal_forecast_11am: value.nepal_forecast_11am,
    key_drivers_explanation: drivers,
  }
}

async function callOpenAI(key: string, model: string, system: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(24_000),
  })
  if (!response.ok) throw new Error(`OpenAI request failed (HTTP ${response.status}). Check the configured model and API key.`)
  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('OpenAI returned an empty model response.')
  return content
}

async function callGemini(key: string, model: string, system: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 1800 },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(24_000),
  })
  if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}). Check the configured model and API key.`)
  const payload = await response.json()
  const parts = payload?.candidates?.[0]?.content?.parts ?? []
  const content = parts.map((part: any) => part?.text ?? '').join('').trim()
  if (!content) throw new Error('Gemini returned an empty model response.')
  return content
}

async function callAnthropic(key: string, model: string, system: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 1800, temperature: 0.15, system, messages: [{ role: 'user', content: prompt }] }),
    cache: 'no-store',
    signal: AbortSignal.timeout(24_000),
  })
  if (!response.ok) throw new Error(`Anthropic request failed (HTTP ${response.status}). Check the configured model and API key.`)
  const payload = await response.json()
  const content = (payload?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('').trim()
  if (!content) throw new Error('Anthropic returned an empty model response.')
  return content
}

export async function requestModelAnalysis(
  market: MarketSnapshot,
  quant: QuantForecast,
  request: ProviderRequest,
  extraHeadline = '',
): Promise<ModelCallResult | ModelCallError | null> {
  const selection = selectProvider(request)
  if (!selection.provider || !selection.key || !selection.model) return null
  try {
    const prompt = makeModelUserPrompt(market, quant, extraHeadline)
    const content = selection.provider === 'openai'
      ? await callOpenAI(selection.key, selection.model, AI_SYSTEM_INSTRUCTION, prompt)
      : selection.provider === 'anthropic'
        ? await callAnthropic(selection.key, selection.model, AI_SYSTEM_INSTRUCTION, prompt)
        : await callGemini(selection.key, selection.model, AI_SYSTEM_INSTRUCTION, prompt)
    return { provider: selection.provider, model: selection.model, analysis: parseJsonText(content) }
  } catch (error) {
    return {
      provider: selection.provider,
      error: error instanceof Error ? error.message.slice(0, 220) : 'Provider call failed.',
    }
  }
}
