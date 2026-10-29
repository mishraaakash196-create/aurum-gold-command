# Aurum / NP — Gold & Nepal Bullion Intelligence

A self-contained Next.js App Router terminal for global XAU/USD and Nepal FENEGOSIDA bullion pricing. Market acquisition, technical indicators, the one-session forecast, Nepal import parity, scenario analysis, and provider API routes run in TypeScript/Node.js. There is no Python microservice and no seeded market-price fixture.

> **Research-use only.** XAU spot feeds are indicative, the Nepal local forecast is a parity estimate (not tomorrow's official fixing), AI output is advisory, and neither the prediction nor the ATR envelope is a guarantee or an executable quote. Verify source prices before trading.

## Run locally

- Node.js 20+
- `npm install`
- `npm run dev`
- Open `http://localhost:3000`

Useful checks:

- `npm run typecheck`
- `npm test`
- `npm run build`

The server binds to `0.0.0.0` for hosted previews and container deployments.

## Optional model and data configuration

Copy `.env.example` to `.env.local`. The app runs without AI credentials; in that case it uses its deterministic quantitative + rules-based news fallback and labels it as such.

```dotenv
# Choose gemini, openai or anthropic. If omitted, available keys are auto-detected.
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-haiku-latest

# Optional access to the 10-year TIPS real-yield series, FRED DFII10.
FRED_API_KEY=
```

Provider credentials are configured server-side with these environment variables. The dashboard has no client-side API-key input or settings modal; it automatically uses an available server key and otherwise runs the deterministic rules-based fallback. For production, use deployment-level environment secrets. Provider availability, model names, quotas and terms are controlled by each provider.

## Market feeds and provenance

The server caches the assembled market snapshot in memory for 60 seconds and marks stale or missing observations instead of inventing values.

- **XAU/USD spot and daily history:** XAUS (`xaus.com` API); the live spot is an indicative mid-market quote. Daily OHLC is used for indicators and charts.
- **Nepal official 24K benchmark:** FENEGOSIDA's public daily dashboard API. Tejabi is displayed as an official quote only when a same-date quote is actually reported; otherwise it is modelled from 24K using the learned seven-observation ratio or editable manual fallback. 22K is separately derived at 91.67% purity (`24K × 0.9167`), not an official FENEGOSIDA rate.
- **USD/NPR:** a fresh direct Nepal Rastra Bank API sell rate is preferred. When that is unavailable or stale, the parity engine uses a fresh `open.er-api.com` daily indicative USD/NPR rate, then Yahoo Finance `NPR=X`; both are explicitly labelled non-NRB fallbacks. A dated NRB data mirror is retained as a reference only and is never treated as live parity FX. Source, timestamp and freshness are shown.
- **DXY, USD/INR, U.S. 10Y nominal Treasury, Brent, and ZQ=F:** Yahoo Finance chart endpoint. `ZQ=F` is the front-month 30-day federal-funds futures price; its change is a directional policy-repricing proxy, **not** CME FedWatch meeting cut odds. Nominal yield remains distinct from 10Y TIPS real yield.
- **10Y TIPS real yield:** FRED `DFII10` when `FRED_API_KEY` is configured. If unavailable, the app does not relabel a nominal yield as a real yield.
- **WGC reported central-bank monthly purchases:** the latest accessible [World Gold Council Central Bank Gold Statistics](https://www.gold.org/goldhub/gold-focus) article is parsed for global net buying and disclosed buyer/month/YTD figures (e.g. Poland, Kazakhstan and China; Brazil is shown as unavailable when it is not named in that report).
- **WGC gold ETF flows:** the latest accessible [Gold ETF Flows](https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows) monthly report is parsed for global USD flows and reported holdings change.
- **Official gold reserve stocks:** IMF [IRFCL](https://data.imf.org/en/datasets/IMF.STA:IRFCL) monthly gold holdings series is downloaded through the IMF SDMX API for the United States, China, India, Poland, Kazakhstan, Brazil and other large holders. Fine troy ounces are converted to metric tonnes; country-by-country observation months are preserved. Implausible scale jumps are flagged, not silently accepted.
- **Headlines:** recent Google News RSS results. A transparent keyword ruleset provides a fallback score; it does not synthesize headlines when the feed is empty.

A ticker can remain visible when other feeds fail; each observation has its own provenance and age. The application withholds a full forecast if the spot/last-observed value, 200-day EMA warm-up, conversion rate, official local benchmark or local spread calibration needed for that output is unavailable.

## Quantitative method

`lib/goldEngine.ts` computes RSI(14), EMA(20/50/200), MACD histogram, Bollinger Bands(20,2) and Wilder ATR(14) directly from historical OHLC. The one-step quantitative ensemble combines recent drift, EMA trend, RSI reversion and MACD momentum, then applies a freshness-gated, explicitly heuristic macro/institutional overlay:

- DXY change is inverse to gold: `−ΔDXY × 0.24`, capped at ±0.18 percentage points.
- U.S. 10Y yield change is inverse: prefer a fresh 10Y TIPS change (`−Δyield pp × 0.60`); use fresh nominal 10Y only as a labeled fallback, capped at ±0.12 points.
- ZQ=F futures price change is direct to gold as a rate-easing proxy (`Δprice × 0.75`), capped at ±0.10 points. It is not converted into a meeting probability.
- Reported monthly global ETF flow is direct (`USD bn × 0.006`), capped at ±0.08 points; reported central-bank net purchases are direct (`tonnes × 0.0012`), capped at ±0.07 points.
- Available factors are summed and capped at ±0.42 percentage points. Missing/stale sources contribute nothing. Coefficients are not regression-fitted and the reported monthly demand observations are lagged; IMF reserve **stocks** are structural context and do not directly forecast a 24-hour move.

Ordinary moves are bounded by a 1.4× ATR-derived cap (bounded at 0.35–4.5%); explicitly selected severe event overlays may use a separately disclosed ±8% scenario cap. The displayed range is the forecast price plus/minus one observed ATR(14); it is an **ATR envelope**, not a statistical confidence interval. The confidence meter is explicitly uncalibrated.

A rolling Nepal local premium is estimated from up to 30 matched FENEGOSIDA, daily XAU and USD/NPR observations, carrying forward the last available market close across weekends/holidays. The engine filters/winsorizes isolated spread outliers and dynamically shifts from 78% latest-fixing weight with sparse data toward 56% as the robust matched sample fills, blending the latest anchor with the recent five-observation median. When too few matches exist, it calibrates from the latest official local benchmark if possible. It then applies:

```text
Base NPR/gram = predicted XAU/USD ÷ 31.1034768 × USD/NPR
24K NPR/tola = base × 11.6638038 × (1 + customs duty) × (1 + bank/freight premium) × (1 + implied local spread)
24K NPR/10g  = base × 10 × the same multipliers
Tejabi (modelled only when no official quote is reported) NPR/tola = 24K NPR/tola × the rolling mean of up to seven paired FENEGOSIDA Tejabi/24K daily ratios; if no observed pairs exist, the editable manual fallback is used. Never backfill or infer historical official Tejabi quotes.
22K NPR/tola = 24K NPR/tola × 0.9167
```

Default customs duty is 15%; bank/freight premium is 1.0%. The simulator exposes both as assumptions. If a fresh USD/NPR daily change exists, the next-fixing parity uses that trend with a ±0.5% cap; otherwise it holds the latest valid conversion level. The forecast UI labels that trend separately. Results are rounded to the nearest Rs 100 for the displayed tola benchmarks.

The accuracy ledger is a chronological, one-day walk-forward backtest over observed daily closes. Every historical estimate uses only candles available at that time. Because synchronized past macro and institutional snapshots are not stored, this ledger is explicitly **technical-only**; current macro/WGC overlays are not backfilled into history. The 30-day/30-session row reports MAPE, directional win rate and RMSE in USD per troy ounce; observation counts reflect the EMA(200) warm-up. These are descriptive historical metrics, not a guarantee of future accuracy.

## Real-time command features

- **Price-move alarm:** browser-native Web Audio oscillator tones use a rising sequence for a surge and a distinct descending sequence for a drop; no audio files or external audio services are used. The adjustable default trigger is ±Rs 2,000 per 24K tola and checks both today's same-day FENEGOSIDA move and the next-fixing forecast/scenario move. The header test plays both tones at ±Rs 2,000, the mute toggle controls synthesized sound, and the flashing in-app banner remains available when sound is muted. Desktop notifications require browser permission; threshold/armed/mute choices are stored locally in that browser.
- **Institutional & Central Bank Demand:** a compact, visible forecast-header card shows fresh XAU macro-factor contributions, the WGC central-bank and global ETF monthly reports, plus IMF reserve stocks for the U.S., China and India. Expanding the integrity audit exposes report links, disclosed country buyers (including Poland/Kazakhstan/Brazil availability), per-country reserve months, stale flags and detected scale anomalies. No synthetic demand values are substituted.
- **System Integrity & Data Sync Audit:** a visible expandable panel checks that chart observation points exactly equal the ticker/card quote state, reports source freshness and FX fallback provenance, distinguishes observed data from forecast points, displays selected event overlays and severe-event exceptions, and summarizes the technical-only 30-day validation metrics.
- **Crisis and calamity analysis:** recent Google News RSS conflict and natural-disaster headlines are classified with a transparent heuristic. Each qualifying event displays a YES-up, YES-down, NO-impact or unavailable verdict, Nepal and global isolated sensitivity estimates, reasoning, and a source link when supplied. Sensitivity numbers are heuristic overlays—not fitted causal responses or calibrated forecasts.
- **World event map:** the SVG map plots approximate country/region anchors inferred from headline text. A pin is not a verified incident location; headlines without a confidently named place are left unpinned. Selecting a live event pin or row applies its isolated sensitivity to the forecast cone and recalculates the local estimate/alarm; the initial preview is not overlaid until selected.
- **Crisis simulator:** generated war/escalation and calamity scenarios are marked SIMULATED, remain separate from the live news feed, and apply a bounded sensitivity overlay to the current forecast. A simulated result can cross the price alarm, but its alert is explicitly tagged as simulated. Clear the scenario to restore the unsimulated view.

## API routes

- `GET /api/market` — current live/partial market snapshot; `?refresh=1` bypasses the 60-second in-process cache.
- `GET /api/predict` — forecast, qualifying geopolitical/calamity event verdicts, methodology status and walk-forward ledger; `?refresh=1` refreshes feeds.
- `POST /api/predict` — optional provider analysis. Body: `{ "headline": "…", "refresh": false }`. Provider selection, model and keys are read only from server environment configuration; request bodies cannot supply API keys. The server validates the strict JSON response, bounds the global model adjustment, grounds displayed drivers against supplied feeds/metrics, and recomputes Nepal prices locally. Without server keys, the rules-based fallback remains available.
- `GET /api/health` — process health response.

`POST /api/predict` has a light in-memory per-client request limiter. For multi-instance or serverless production deployments, replace the in-memory market cache and limiter with a shared cache/rate-limit store, pin and monitor upstream feed terms/availability, and add operational alerts for stale feeds and model-provider errors.

## Project map

```text
app/                         Next.js App Router page, layout and API routes
components/AurumDashboard.tsx Interactive terminal, browser alarm and dashboard state
components/MarketChart.tsx    Recharts candlestick/area chart and forecast cone
components/CrisisSimulator.tsx Clearly labelled local crisis/calamity exercise
components/WorldMap.tsx       Dark SVG event radar and per-event impact analysis
lib/goldEngine.ts             Technical ensemble, dynamic local spread, parity, scenario and backtest
lib/systemAudit.ts            Exact chart-sync point, alarm selection and integrity helpers
lib/eventImpact.ts            Event classification, named anchors, overlay and heuristic verdicts
lib/marketData.ts             Live market source adapters and provenance/freshness
lib/institutionalData.ts      WGC report parsing, IMF IRFCL gold reserves, anomaly/freshness guards
lib/sentiment.ts              Auditable rules-based headline scorer
lib/llm.ts                    Exact system instruction and Gemini/OpenAI/Anthropic clients
lib/forecast.ts               Provider guardrails, deterministic explanation and forecast blend
```

## Stage 1 — probabilistic forecasts, accuracy tracking, and Nepal fixing mode

This update preserves the existing Next.js app and desktop no-scroll dashboard. The new features are modularized under `/engine`, `/data`, and `/tracking`; the accuracy and parity settings surfaces open as scrollable drawers so the main command screen remains fixed-height.

### Forecast output

The XAU/USD forecast and Nepal per-tola 24K Hallmark, 22K, and Tejabi estimates now include a low/base/high range, up/down directional probabilities, and a Low/Medium/High heuristic confidence tier. Nepal local ranges are pass-through estimates from the XAU range, USD/NPR, levies, the configured dealer margin, and the rolling FENEGOSIDA spread. Prices are rounded to the nearest Rs 100. The visible disclosure is **“Informational only. Not financial advice.”**

Directional probabilities and confidence tiers are model heuristics, not calibrated probabilities. They must not be interpreted as performance guarantees.

### Prediction logging and actuals

Every assembled quantitative forecast is appended to a JSON store with its timestamp, target fixing date/time, spot/FX/source inputs, macro-factor inputs, predicted base/range, direction, and reference price. When later XAU OHLC closes or FENEGOSIDA fixings become available, the server reconciles those observations against pending predictions. Official 24K is source-reported; 22K/Tejabi are recorded as purity-derived where the feed does not provide a corresponding independent fixing.

The Accuracy drawer shows 7/30/90-day range hit rate, MAE, MAPE, and direction accuracy, plus a predicted-versus-actual chart. Its historical OHLCV replay uses strictly chronological, technical-only one-session forecasts. Macro/institutional historical snapshots are not stored, so the replay does not pretend to backtest those factors.

### Data persistence

- Default directory: `./.data/` (created automatically). Predictions/actual updates are appended to `aurum-predictions.jsonl`; settings are stored in `aurum-settings.json`.
- Optional override: `AURUM_DATA_DIR=/path/to/persistent/writable/directory`.
- The append-only JSONL history is retained on disk; the running process indexes up to 150,000 latest records in memory for metric queries. `.data/` is git-ignored.
- JSON persistence is intended for a single writable app instance. For a multi-instance/serverless deployment, provide one shared writer or replace this store with a shared database before relying on cross-instance accuracy history.

### Nepal fixing schedule

The schedule treats Saturday as a FENEGOSIDA closure. Sunday is treated as an open day unless explicitly listed as a holiday. The forecast enters **last-minute** mode before 11:00 NPT on an open fixing day and switches to **overnight** mode after the fixing or on a closure day. Last-minute estimates refresh with the market poll (currently once per minute) and use the current XAU quote only when that source is fresh; otherwise the UI keeps the last observation visibly marked stale. Overnight estimates use the latest available XAU/FX parity for the next open fixing date.

Configure public holidays as comma-separated ISO dates (no fictitious holiday calendar is bundled):

```env
NEPAL_PUBLIC_HOLIDAYS=2026-10-30,2026-11-01
```

### Parity settings

Open **Parity** in the top navigation to edit customs duty, VAT/other levies, and dealer margin. The formula uses the live XAU/USD input, NRB USD/NPR rate when fresh/available (otherwise the existing explicitly identified fallback), the established 31.1034768 g/troy oz and 11.6638038 g/tola conversion constants, and a robust rolling spread learned from matched FENEGOSIDA/market observations. The settings drawer warns that government budgets can change rates. Spot, FX, gram conversions, and learned spread are shown as reference inputs rather than silently replaced with user-entered or mock values.

### Setup and environment

```bash
cd /home/user/aurum
npm install
cp .env.example .env.local   # optional; configure server-side provider keys only if desired
npm run dev
```

For a production check:

```bash
npm run typecheck
npm test
npm run build
npm start
```

No new package or Python service is required. `AURUM_DATA_DIR` and `NEPAL_PUBLIC_HOLIDAYS` are optional. Existing server-side LLM/FRED variables remain optional and unchanged; no API key is requested in the browser.

New/extended routes:

- `GET /api/accuracy` — persisted forecasts, verified metrics and chart series.
- `GET /api/accuracy/backtest` — historical XAU/USD OHLCV replay metrics.
- `GET /api/settings` / `POST /api/settings` — read/update bounded parity duty and margin inputs.

No mock or demo price series is used for the new prediction log, accuracy tracker, or OHLCV replay. Empty/unavailable observations remain unavailable rather than being filled with sample prices.

## Stage 2 — macro/Nepal signed factors, scheduled events, and a guarded ridge ensemble

Stage 2 keeps the same single-screen terminal. **Analytics** contains the signed-factor/weight audit; **Event lab** contains the scheduled CPI, NFP, FOMC and Federal Reserve speech countdown beside the separate simulated crisis tool. Existing overview, accuracy drawer, official-rate anchoring, learned/manual Tejabi ratio and parity settings remain in place.

### Stage 2 feed setup and provenance

The new sources are optional and fail closed. Each feed records source, checked time, last observed time, status, and an unavailable/stale note; failed upstream values are not replaced with generated observations.

- **CME FedWatch:** optionally set `CME_FEDWATCH_BEARER_TOKEN` to an entitled CME API OAuth bearer token. The forecasts API requires CME access. Without it (or if parsing/auth fails), official meeting probabilities remain unavailable. ZQ=F stays separately labelled a futures repricing proxy; it is never turned into invented FedWatch probabilities.
- **CFTC gold positioning:** public Disaggregated COT futures-only report, gold market code 088691. The model factor uses the reported managed-money net-position change scaled by open interest; the weekly report is lagged and not a real-time flow.
- **GLD/IAU holdings:** issuer pages are parsed only when a valid dated observation is actually present. Issuer blocking, missing holdings, or placeholder text means unavailable; no ETF value is filled from WGC monthly flows.
- **TIPS real yields:** uses `FRED_API_KEY` for DFII10 where available. Nominal U.S. 10Y remains distinct and is used only as a clearly labelled fallback when no real-yield change is available.
- **MCX:** Yahoo `GOLD.MCX` is only a symbol/price proxy and does not guarantee the contract unit. It is excluded from the gold forecast unless the operator has independently verified the quote as INR per 10g and explicitly sets `AURUM_MCX_QUOTE_UNIT=INR_PER_10G`. Do not enable this setting based only on the ticker label.
- **India duty:** `AURUM_INDIA_IMPORT_DUTY_PCT`, `AURUM_INDIA_IMPORT_DUTY_AS_OF`, and optional `AURUM_INDIA_IMPORT_DUTY_SOURCE_URL` are an operator-entered CBIC reference, not a live feed. The duty-change feature is excluded unless `AURUM_INDIA_IMPORT_DUTY_BASELINE_PCT` is also configured. Verify official budget/CBIC notices before updating.
- **NPR/INR:** calculated only from fresh observed USD/NPR and USD/INR quotes. No fixed peg is assumed.
- **Nepal duty change:** requires `AURUM_NEPAL_DUTY_BASELINE_PCT`; the current parity setting is compared to this explicit baseline. It is not represented as an automated live budget feed.
- **Festival demand:** Bikram Sambat windows for Dashain, Tihar, Akshaya Tritiya and wedding months are a calendar proxy, not measured jewellery demand or a source-observed seasonal index.
- **Silver correlation:** disabled by default. Set `AURUM_ENABLE_SILVER_CORRELATION=true` to fetch optional Yahoo SI=F history and calculate a rolling co-move; it is an estimate/proxy, not a causal relationship.
- **Event calendar:** BLS official ICS provides CPI and Employment Situation dates; Federal Reserve official calendar records provide FOMC/speech events. Events include source and timestamp. A high-impact event within 36 hours (or 4 hours after release) widens the forecast envelope and reduces its confidence score, leaving the forecast point unchanged. Feed staleness remains visible.

`CME_FEDWATCH_BASE_URL`, `CME_APPLICATION_NAME`, `CME_APPLICATION_VENDOR`, `AURUM_MCX_SYMBOL`, optional duty variables, and silver toggle are listed in `.env.example`. Only CME bearer access may require a new credential; no other new paid/API key is required. The default app remains useful without any of these settings.

### Ensemble, fit cadence and model limits

The TypeScript ensemble combines the established technical/macro forecast with signed, freshness-gated factor signals (technical momentum, headline sentiment, DXY, TIPS/nominal yield, FedWatch or the separately-labelled ZQ proxy, CFTC positioning, issuer holdings, Brent, India/Nepal duty assumptions, observed NPR/INR, BS seasonality and optional silver correlation). The Analytics disclosure shows signed signal percentages, direction, weighted contribution in predicted XAU percentage points, source, age and status. A factor without a valid observation/baseline is excluded rather than imputed.

Historical training uses (a) feature snapshots persisted with each prediction and only their later reconciled XAU actuals, and (b) strictly chronological OHLC technical-only walk-forward rows. Missing historical macro/local observations are **not** backfilled. Ridge regression uses an intercept and L2 penalty, and a learned model is saved as `.data/aurum-ensemble-model.json`; it refits no more often than weekly. It requires at least **25 verified logged outcomes** and **60 total training rows**. If that minimum is not met, the dashboard explicitly uses bounded deterministic heuristic coefficients and discloses the missing sample count. The backtest-only rows contain technical features only, so they cannot be described as macro validation. Neither the ridge fit nor current heuristic output constitutes calibration or reliable probabilities.

The current/fallback factor weights are deterministic model-design choices, not statistically learned estimates. Event range multipliers and confidence penalties are likewise conservative heuristics. Existing ATR ranges and directional probabilities remain uncalibrated. Nepal pricing is still recalculated through the established parity engine and anchored to the latest official FENEGOSIDA 24K quote when present; no ensemble or provider-supplied local price can override that official anchor.

### New artifacts and checks

- `engine/ensemble.ts` — feature building, signed driver status, ridge fitting, fallback and technical backtest rows.
- `engine/eventRisk.ts` — event countdown risk and range/confidence adjustment helpers.
- `engine/seasonality.ts` — BS-calendar festival/wedding proxy.
- `.data/aurum-ensemble-model.json` — learned-model summary/coefficients, persisted inside `AURUM_DATA_DIR`; existing `.data/aurum-predictions.jsonl` stores lagged feature snapshots and reconciled outcomes.
- `tests/stage2Models.test.ts` — ridge sufficiency/weight behavior, event range widening, seasonal index and fallback overlay tests.

Run `npm run typecheck`, `npm test`, and `npm run build` after configuring optional environment variables. The ridge model is stored on the same single-writer local JSON store as existing prediction accuracy; use a shared database/store before multi-instance deployment.

## Stage 3 — manual official actuals, volatility regime, explainability and local tools

Stage 3 preserves the single-screen terminal and adds only small dashboard controls plus drawers. The original Accuracy and Parity drawers, official-rate anchor, Stage 2 signed factors, events, scenario isolation, and append-only accuracy log remain available. No external Python service is introduced.

### Manual FENEGOSIDA rate fallback

Open the top-right **Rates / tools / language** menu → **Manual official rates**. Enter a Gregorian fixing date and the same-date 24K Hallmark and Tejabi rates in NPR per tola. Validation rejects invalid/future dates, values outside NPR 10,000–2,000,000, and Tejabi/24K ratios outside 90%–105%. Saving the same date edits/replaces its single manual record; edit, remove, and undo are supported.

Manual rows persist in `aurum-manual-official-rates.json` inside `AURUM_DATA_DIR`. Provenance is stored as `Manual entry · FENEGOSIDA transcription`; it is not silently recast as an automatic feed observation. If no automatic FENEGOSIDA 24K fixing exists for the current NPT date, a same-day manual record may supply the benchmark for the fallback forecast. An automatic fixing takes precedence for a duplicate date. Manual Tejabi/24K pairs are merged into the seven-observation ratio learner only when there is no automatic pair for that date; editing/removing the manual entry changes the learned sample set on the next refresh.

The accuracy tracker dynamically matches manual actuals to already-logged forecasts whose target date is within the existing reconciliation window and whose log predates the entry/update. Manual data is not backfilled into older prediction logs as if it had been observed earlier. Derived 22K is explicitly identified as derived from the manual 24K actual. Provenance is visible in the ledger and manual entries can be removed to undo their contribution to tracking.

### Official-rate history chart

Open **Calculator & history** → **Official rate history**. The chart has 7D, 30D and 1Y windows and contains only persisted FENEGOSIDA 24K observations or clearly marked manual transcriptions—never forecast/parity-generated values. Every dashboard refresh stores source-returned daily-history observations with a check timestamp in `aurum-official-rate-history.json`; manual rows remain separately marked, with the automatic feed winning for duplicate dates. A history point is not fabricated when a source has a gap. The 1Y view therefore shows only the history the running instance has actually stored; it may initially contain less than a year. Existing configurable price-alarm threshold crossings are marked on the fixing series; a marker is not a trade signal.

### Volatility regime and forecast “Why”

The dashboard shows **Calm / Normal / Stress** beside the global forecast. ATR(14) percentile is computed from the available daily OHLC history (up to the latest 252 ATR observations) and combined with the absolute geopolitical-risk score. Current rule thresholds are: Stress at ATR percentile ≥80 or absolute geopolitical risk ≥7/10; Calm only at ATR percentile ≤30 and risk magnitude ≤2.5/10; otherwise Normal. If ATR history is inadequate, the badge discloses that limitation and only the available risk-score input is used. Calm narrows the XAU envelope by 10% and adds 3 heuristic confidence points; Stress widens it by 25% and subtracts 8 points. Existing scheduled-event widening still applies. These deterministic thresholds and confidence adjustments are heuristics, not calibrated volatility forecasts or reliable probabilities.

The collapsible **Why this forecast?** panels show at most five signed, highest-magnitude terms from actual technical, fresh macro, reported institutional, and eligible Stage 2 model inputs. Each row identifies its source/time. Unavailable or stale drivers are excluded; a missing factor is never replaced with an invented contribution. Nepal-local rows pass the global terms through the latest official 24K anchor and show the FX adjustment separately; they are illustrative model-term contributions, not a causal or calibrated decomposition. When a scenario is active, the baseline “Why” terms are intentionally not reused for altered scenario inputs.

### Buy/sell calculator

The calculator supports weight in tola or grams, 24K Hallmark or Tejabi, making %, wastage %, and the 13% VAT assumption. Buy estimate adds gold value, making and wastage, then VAT on that subtotal. If no separate Tejabi fixing is present, the calculator uses the active learned/manual ratio only if available and labels that rate as an estimate. Indicative sellback subtracts only the user-entered wastage; it does not return making charges, charge VAT, or estimate a dealer buyback spread. Calculator outputs are indicative reference calculations, not an executable jeweller quote. The 13% VAT is a calculator assumption, not tax advice; verify current rules and the jeweller’s invoice.

### English / नेपाली and feed monitor

The browser menu toggles English and नेपाली and remembers the selection in local storage. Dashboard fixing horizons and official-history/manual-entry dates show Bikram Sambat dates; the Nepali language selection uses Nepali month names and Devanagari numerals. ISO/Gregorian dates remain in the manual-entry date input for unambiguous storage.

**Feed freshness & sources** lists source, last-updated time, and live/stale/unavailable/manual/proxy status for market, local, FX, macro, institutional and Stage 2 feeds. “Retry all feeds” refreshes the assembled snapshot with existing provider timeouts, 60-second caching, and available fallbacks. A failed source remains unavailable; proxy, stale, manual and reported-lagged values are labeled and are not promoted to fresh direct observations. The proxy labels in the panel do not imply source verification or live availability.

### Persistence, environment, limitations and routes

No new environment variable or credential is required for Stage 3. `AURUM_DATA_DIR` (already documented above and in `.env.example`) controls all local stores and should point to a writable persistent volume in production. Stage 3 adds:

- `aurum-manual-official-rates.json` — dated manual 24K/Tejabi pair records with provenance and update timestamps.
- `aurum-official-rate-history.json` — automatically reported official-rate history points and feed check times.
- `GET /api/manual-official-rates`, `POST /api/manual-official-rates`, `DELETE /api/manual-official-rates?date=YYYY-MM-DD` — local manual-rate ledger CRUD.
- `GET /api/official-rates?days=7|30|365` — persisted official-rate observations for the chart.

The collector currently obtains a rolling FENEGOSIDA history response; full one-year chart coverage requires actual stored points to accrue and is not backfilled. Manual rates are user transcriptions, not independently verified source downloads. Historical accuracy after manual entry is based on user-entered outcomes; review provenance before interpreting any metric. Keep the persistent store private and backed up. As with prior stages, the JSON store assumes one writable app instance; use a shared transactional database/writer before horizontal scaling.

## Stage 4 — fixing-aligned validation, empirical ranges, calibration, and reliability gates

Stage 4 keeps the Stage 1–3 dashboard and forecast pipeline intact. The new validation appears in the Accuracy drawer; reliability is surfaced on the existing forecast cards and feed monitor. There are no new environment variables or credentials.

### Naive baseline and scoring

The Accuracy drawer compares AURUM against **“tomorrow = today”** for XAU/USD and Nepal 24K/tola over rolling 7-, 30-, and 90-day windows. The naive forecast carries the previous fixing-time XAU reference or previous official 24K rate forward unchanged. The report shows MAE, MAPE, and directional accuracy for both methods. AURUM is marked **beats baseline** only when its MAE and MAPE are lower and its direction accuracy is no worse.

A comparison remains **Not enough data** until there are 20 matched outcomes for the selected instrument. A target fixing date counts once: if the app logged several refreshes for that date, only the latest forecast issued before the target observation is scored. This avoids treating minute-by-minute refreshes as independent forecast successes. Short windows may still contain fewer than 20 observations after the overall threshold is reached; their count is shown.

### Fixing-time alignment and timestamp audit

XAU outcome alignment targets the previous available FENEGOSIDA fixing at **11:00 NPT** through approximately **10:45 NPT** on the target fixing date. The app stores target instants plus the source observation timestamp, value, and source used. A recorded spot within five minutes of the intended instant is tagged exact; within one hour is labelled **approximate window**. If no quote snapshot was recorded near the target, an observed daily OHLC close may be used as an explicitly approximate fallback. If neither is available, the outcome is unavailable and excluded—no synthetic point is substituted.

Accuracy-chart tooltips show forecast issue time, reference target, actual source timestamp, method, and precision. FENEGOSIDA currently supplies a fixing date without a separately verified exact quote time in some responses; in that case the tooltip says date-only and shows the nominal 11:00 NPT fixing rather than claiming an exact source timestamp. Old Stage 1–3 log rows are not backfilled with fabricated Stage 4 timestamps; fixed-window metrics use Stage 4 snapshots only.

### Empirical-error ranges

With at least **30 matched outcomes per instrument**, the forecast low/high bounds use the empirical 10th and 90th percentiles of prior signed prediction errors, scaled by the current Calm / Normal / Stress range multiplier. Existing scheduled-event widening is retained. Until the threshold is met, ranges remain volatility/ATR-based and are labelled **“volatility-based, not error-based.”** A distribution learned from past outcomes is descriptive, may change with market regime, and is not a statistical guarantee.

### Probability calibration

For each instrument, after at least **100 matched, non-flat, direction-resolved outcomes**, AURUM fits an isotonic-regression map from past stated UP probabilities to subsequent UP outcomes. The Accuracy drawer shows 10-point stated-probability buckets, sample counts, mean stated probability, and observed UP rate. The fitted map is applied to future displayed UP probabilities; DOWN is its complement. Before the threshold, every dashboard direction probability is labelled **uncalibrated**. Calibration uses only outcomes already observed before the forecast being produced; the chart is descriptive and does not establish future performance.

### Snapshot logging and no-look-ahead rule

Every new prediction log includes an as-of snapshot of model feed values and source metadata (timestamps, stale/status flags, technical inputs, local spread and official-rate inputs, ensemble features and weights, model mode, regime, event risk, parity settings, and fixing-window references). Later source actuals are appended separately. Calibration, empirical errors, and fixing-aligned accuracy use these saved snapshots and later actuals; they do not replace old inputs with current feeds. Existing logs without a Stage 4 snapshot remain available in the append-only store but are excluded from fixed-window scoring rather than retroactively relabelled.

### Feed reliability gate

The forecast card is visibly dimmed and marked **LOW RELIABILITY** when a required source fails its configured age/availability check. Global XAU/USD requires a usable spot quote. The Nepal parity card additionally requires usable USD/NPR and a fresh automatic official FENEGOSIDA 24K rate. A manual transcription remains visible with manual provenance but does not pretend that the automatic official feed is fresh; the Nepal forecast is therefore still marked low reliability when the official source is unavailable.

Thresholds live in `engine/reliability.ts` (not environment variables): XAU spot older than 10 minutes during the configured 24/5 session, older than 50 hours outside session, USD/NPR older than 36 hours, or FENEGOSIDA more than one fixing business day old. The schedule treats Saturday as closed and Sunday as open unless included in `NEPAL_PUBLIC_HOLIDAYS`. The feed monitor shows the active global/Nepal reliability state, reason, and thresholds.

### Setup, storage, and limitations

No Stage 4 environment variable is added. Existing optional `AURUM_DATA_DIR` selects the writable persistent store; `NEPAL_PUBLIC_HOLIDAYS` provides explicit ISO holidays. Install and run as before:

```bash
cd /home/user/aurum
npm install
cp .env.example .env.local   # optional; no Stage 4 key is required
npm run dev                   # dashboard on port 3000
```

Validation commands:

```bash
npm run typecheck
npm test
npm run build
```

Stage 4 adds `engine/fixingWindow.ts`, `engine/reliability.ts`, and `tracking/stage4.ts`; extends the Accuracy API/drawer and `aurum-predictions.jsonl` snapshot events; and adds tests for the baseline, empirical percentiles, isotonic buckets, fixing windows, and reliability gate. Forecast rows without enough real matched outcomes stay on the existing ATR range and uncalibrated heuristic probabilities. Exact 10:45 snapshots depend on the dashboard/API being active near the target; approximate-window and unavailable cases are exposed rather than hidden. The append-only JSON store remains intended for one writable app instance; use a shared transactional store before multi-instance deployment.

## Production deployment and hardening

AURUM supports Turso/libSQL for durable free-tier hosting and retains the existing JSON/JSONL file store as a local fallback. All app records use the same storage adapter: forecasts and snapshots, later reconciled actuals, parity settings, manual FENEGOSIDA entries, observed official-rate history, Tejabi ratio observations, ensemble model, and alarm settings. Turso tables (`aurum_documents`, `aurum_events`) are created automatically when the server starts. The app does **not** import local `.data` records into a new Turso database: use the admin export/validated restore flow to migrate intentionally.

### Deployment and environment variables

Use Node.js 20.9 or newer (Node 22 is used in the Docker image). For a durable free-hosted deployment, provision a Turso database, configure both Turso credentials, set a strong admin password and a separate cron secret, then deploy:

```sh
npm ci
npm run build
npm start
```

`npm start` listens on `0.0.0.0` and respects the hosting platform's `PORT` value. `Dockerfile` provides the same production build/start path; build with `docker build -t aurum .` and run with the environment variables below. Keep all credentials in the host's server-side secret manager, never in client or `NEXT_PUBLIC_*` variables.

| Variable | Required | Purpose / default |
|---|---:|---|
| `TURSO_DATABASE_URL` | For Turso | libSQL URL. Turso is selected only when this **and** `TURSO_AUTH_TOKEN` are present. |
| `TURSO_AUTH_TOKEN` | For Turso | Server-only database token. Missing either Turso value selects local JSON; a partial pair is surfaced as a health warning. |
| `ADMIN_PASSWORD` | Recommended in production | Enables administrator sign-in and every persistent admin write. Use a unique random password of at least 32 characters. If unset, write routes fail closed. |
| `CRON_SECRET` | For scheduled logging | Separate bearer secret required by `POST /api/cron/forecast`. |
| `AURUM_DATA_DIR` | Local JSON only | Writable fallback path; defaults to `./.data`. |
| `AURUM_STORAGE_PERSISTENT` | Local JSON only | Set `true` only when `AURUM_DATA_DIR` is a durable mounted volume. Otherwise health marks local storage potentially ephemeral. |
| `PORT` | No | HTTP port; hosting platform value is honored (default 3000). |
| `HOSTNAME` | No | Docker default is `0.0.0.0`; the npm start script binds all interfaces. |
| `NODE_ENV` | No | Set by the production runtime/build. |
| `AI_PROVIDER` | No | Optional provider choice: `gemini`, `openai`, or `anthropic`. |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | No | Optional Gemini credentials; `GEMINI_API_KEY` takes precedence. |
| `GEMINI_MODEL` | No | Optional Gemini model override. |
| `OPENAI_API_KEY` | No | Optional OpenAI key. |
| `OPENAI_MODEL` | No | Optional OpenAI model override. |
| `ANTHROPIC_API_KEY` | No | Optional Anthropic key. |
| `ANTHROPIC_MODEL` | No | Optional Anthropic model override. |
| `FRED_API_KEY` | No | Optional official FRED access for the 10Y TIPS real yield. |
| `NEPAL_PUBLIC_HOLIDAYS` | No | Comma-separated ISO dates; Saturday is closed and Sunday is otherwise treated as open. |
| `CME_FEDWATCH_BEARER_TOKEN` | No | Optional entitled CME credential; no FedWatch distribution is invented without access. |
| `CME_FEDWATCH_BASE_URL` | No | CME endpoint override; default `https://markets.api.cmegroup.com/fedwatch/v1`. |
| `CME_APPLICATION_NAME` | No | CME client-identification header. |
| `CME_APPLICATION_VENDOR` | No | CME client-identification header. |
| `AURUM_ENABLE_SILVER_CORRELATION` | No | Set `true` to enable the optional SI=F history proxy; default `false`. |
| `AURUM_MCX_SYMBOL` | No | Optional MCX Yahoo Finance symbol; default `GOLD.MCX`. |
| `AURUM_MCX_QUOTE_UNIT` | No | Set `INR_PER_10G` only when the quote unit is verified. |
| `AURUM_INDIA_IMPORT_DUTY_PCT` | No | Optional manually verified CBIC rate. |
| `AURUM_INDIA_IMPORT_DUTY_AS_OF` | No | Date for the manual India duty reference (ISO date). |
| `AURUM_INDIA_IMPORT_DUTY_SOURCE_URL` | No | Provenance URL for the manually verified duty reference. |
| `AURUM_INDIA_IMPORT_DUTY_BASELINE_PCT` | No | Optional comparison baseline for India duty changes. |
| `AURUM_NEPAL_DUTY_BASELINE_PCT` | No | Optional comparison baseline for Nepal duty changes. |

`.env.example` lists the complete application configuration. `.gitignore` excludes `node_modules`, `.next`, `.env*` (except the safe template), and `.data`; do not commit a populated `.env.local` or local database backup.

### Admin writes, backup, and scheduled runs

Public dashboard access is read-only for persistent controls. Manual rates (including edit, delete, undo), parity settings, shared alarm threshold/armed/muted settings, force-refresh/retry-all, and backup import/export require the admin session. Sign in from the dashboard header; the server issues an eight-hour `httpOnly`, `SameSite=Strict` cookie and checks it again on every write endpoint. `ADMIN_PASSWORD` is never sent to the browser. Without it, writes are disabled. Backup export is an admin-only JSON download. Restore validates the version, allowed storage keys, record shapes, line formats, and 25 MiB maximum before replacing current data; a failed validation changes nothing. Keep an off-host copy of backups.

Configure your scheduler in the **Asia/Kathmandu** timezone to call the forecast job daily at about **10:30 AM NPT**, before the nominal FENEGOSIDA 11:00 fixing:

```sh
curl -fsS -X POST "$APP_URL/api/cron/forecast" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"forecast"}'
```

This protected run refreshes sources, captures the as-of model/input snapshot, appends the prediction and reconciles already-due outcomes. Add a periodic run (for example every 4 hours) to reconcile outcomes without adding another forecast row:

```sh
curl -fsS -X POST "$APP_URL/api/cron/forecast" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"reconcile"}'
```

Both modes reject requests without `CRON_SECRET`; never put it in a public URL or browser code. Check `/api/health` after deployment: it reports the active backend, writability, and whether local storage may be ephemeral. The dashboard shows a warning whenever local storage is potentially ephemeral or storage is unwritable. A successful health probe is not a substitute for testing a backup and restore before live use.

### Runtime controls and limits

API routes have per-IP in-process rate limits (sensitive endpoints are stricter), and the existing upstream collectors use server-side TTL caches: the assembled market snapshot is cached for 60 seconds, while slower Stage 2/institutional feeds retain their longer feed-specific TTLs. In-memory rate-limit buckets are per running application instance; if scaling across multiple instances, add an edge/WAF or shared distributed limiter. Local JSON storage is intended for a single writable process; use Turso for shared durable records. Database credentials and AI/feed keys are accessed only by server-side API/service modules, never by the client dashboard; the production build runs a client-bundle scan against configured secret values.

Validate a deployment with:

```sh
npm ci
npm run typecheck
npm test
npm audit --omit=dev
npm run build
PORT=3100 npm start
```

The health endpoint should report the configured backend and `writable: true`; no automatic migration, synthetic historical observation, or placeholder forecast is performed.
