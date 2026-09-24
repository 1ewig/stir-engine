# EUR/USD Institutional Swing Trading Engine

> **A fundamental-first quantitative engine designed for 2-week to 1-month EUR/USD swing legs, driven by sovereign rate velocity, energy terms of trade, CFTC positioning divergence, modular AI semantic analysis, and real-time news flow.**

Most retail trading bots try to predict currency moves using lagging chart indicators on 5-minute candles—and consistently get chopped up. 

Institutional foreign exchange desks at major investment banks and macro hedge funds approach the market differently: **currencies trade on macro divergence, real yield differentials, terms of trade, and institutional positioning imbalances.**

This project is a TypeScript/Bun quantitative engine that pulls live macroeconomic data, performs qualitative semantic classification via a modular AI layer, computes deterministic quantitative scoring matrices, and generates an asymmetric swing execution plan with strict capital preservation vetoes.

---

## How the Engine Thinks

The engine synthesizes market reality across four core pillars:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          LIVE DATA INGESTION                            │
│  FRED (US Yields, TIPS)  │  ECB API (AAA Yields, DFR) │  NY Fed (EFFR) │
│  CFTC (Euro FX CoT)      │  TinyFish (Live News)      │  ForexFactory   │
│  ICE / Yahoo (TTF Gas, Brent, VIX, Spot Price)                          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    DYNAMIC MULTI-CATEGORY SCORING MATRIX                │
│                                                                         │
│  1. Macro Fundamentals & Sovereign Yields                  [55% Weight] │
│  2. Institutional Positioning & Flow (CFTC CoT)            [25% Weight] │
│  3. News Sentiment & Catalyst Calendar (Modular AI)        [20% Weight] │
│  4. Market Structure & Trade Geometry                      [ 0% Default]│
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONFLUENCE VETO & RISK GUARD                       │
│  • Event-Risk Veto: Blocks entry ±6h around Tier-1 releases (CPI/NFP)   │
│  • CoT Squeeze Veto: Blocks shorting into hedge fund short-covering     │
│  • Liquidation Veto: Blocks buying into crowded long unwinds            │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       ASYMMETRIC EXECUTION PLAN                         │
│  Limit Retracement Entry  │  Structural Stop Outside 5-Day Structure    │
│  Take Profit 1 (1:2.0 R) │  Take Profit 2 (1:4.0 R) │ Exact Sizing ($) │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1. Sovereign Yield Velocity & Real Rates (55% Default Weight)
Currencies flow toward higher real return and superior balance-of-payments dynamics. The engine evaluates:
* **Two-Speed 2Y Spread Velocity (US vs. German Bund):** Rather than using lagging 20-day moving averages, it calculates a **Fast 3-day impulse** (capturing immediate post-catalyst repricing) and a **10-day medium delta** (confirming 2-week swing momentum).
* **Real Yields (10Y US TIPS & 10Y Breakeven):** Pulls live inflation-protected yields (`DFII10`) to track real return advantage over Eurozone debt.
* **Energy Terms of Trade:** Evaluates **Dutch TTF Natural Gas** alongside **Brent Crude**. Because the US is an energy exporter and the Eurozone is an industrial net energy importer, elevated European gas prices act as a direct structural tax on the Euro.
* **Central Bank Spreads & VIX:** Compares the NY Fed Effective Federal Funds Rate against the ECB Deposit Facility Rate, factoring in global risk-off liquidity hoarding via the VIX.

### 2. CFTC CoT Flow Divergence (25% Default Weight)
Addresses the classic "exchange rate disconnect" where price diverges from macro in the short term due to crowded speculative positioning:
* Tracks non-commercial futures positions directly from the **CFTC Euro FX Commitment of Traders report**.
* Computes the **52-week percentile index** (detecting crowded extremes $>80\%$ or $<20\%$) and 4-week net contract momentum.
* **Smart Squeeze Detection:** If macro is bearish but hedge funds are aggressively covering shorts at 52-week positioning lows, trend-following shorts are prohibited to protect capital from short squeezes.

### 3. News Sentiment & Catalyst Calendar (20% Default Weight)
* **Modular AI Semantic Classifier (`src/ai/`):** Utilizes **Groq (`qwen/qwen3.8-27b`)** for ultra-fast (~500ms) qualitative semantic classification (policy bias, intensity, catalyst driver).
* **Deterministic Code Math:** The LLM is strictly prohibited from doing arithmetic. All directional scoring, magnitude mapping, weighting, and normalization are computed deterministically in pure TypeScript.
* **Dual-Vector Discovery:** Concurrently queries **Fed/USD** policy and **ECB/EUR** dynamics via `@tiny-fish/sdk`, restricted to top institutional financial domains (Reuters, Bloomberg, FT, WSJ) within a strict 48-hour freshness window.
* **Multi-Tier Fallback:** If the LLM times out or rate limits, the engine smoothly falls back to an internal 28+ keyword dictionary NLP engine, and then to neutral baseline without interrupting other pillars.
* **Tier-1 Event Risk Guard:** Fetches weekly high- and medium-impact economic releases. If an ultra-high-impact release is due in $<6$ hours, an execution blackout veto is triggered.

### 4. Market Structure & Trade Geometry (0% Default Scoring Weight)
Technicals are **disabled by default from biasing the directional score** (avoiding curve-fitting and lagging signals). Instead, local structure is strictly used to anchor entry and invalidation:
* **True Structural Invalidation:** Stops are never placed at arbitrary pip distances. They are anchored strictly outside the local 5-day swing highs/lows plus an ATR buffer.
* **Location Guard:** If price is stretched far from resistance (e.g. after a 300-pip drop), the engine refuses to market sell. It demands a limit order retracement closer to value, ensuring asymmetric payoffs:
  * **Take Profit 1:** 1:2.0 Risk/Reward (partial profit & de-risk).
  * **Take Profit 2:** 1:4.0 Risk/Reward (runner for multi-week expansion).

---

## Quick Start

### Prerequisites
* [Bun](https://bun.sh/) (recommended for fast TypeScript execution) or Node.js v18+
* Optional API keys:
  * TinyFish API key for live news search
  * Groq API key for AI semantic classification

### Installation

```bash
git clone <repo-url>
cd stir-engine
bun install
```

Configure your `.env.local` file:
```env
tiny_fish_api=your_tinyfish_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

---

## Running the Engine

### 1. Standard Run (Recommended: Macro + Positioning + AI News)
```bash
bun run start
# or:
bun run src/index.ts
```
Runs the balanced institutional framework: 55% Macro & Yields, 25% CFTC Positioning, 20% News & Economic Calendar, 0% Technicals.

### 2. Pure Macro Mode (Zero Technicals, Zero Positioning)
```bash
bun run start:macro
# or:
bun run src/index.ts --pure-macro
```
Focuses 100% on economic fundamentals and news (75% Sovereign Yields/Energy, 25% News Flow).

### 3. Opt-in Technicals Mode
```bash
bun run start:tech
# or:
bun run src/index.ts --with-tech
```
Enables technical scoring (40% Macro, 25% Positioning, 15% News, 20% Technicals).

---

## Understanding the Output

When you run the engine, you will see a structured real-time audit:

```text
--------------------------------------------------------------------------------
                  DYNAMIC MULTI-CATEGORY SCORING MATRIX                         
--------------------------------------------------------------------------------
┌──────────────────────────────────────┬──────────────────────┬────────┬──────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
│ Category                             │ Score (-100 to +100) │ Weight │ Weighted Pts │ Continuous Metric                                                                   │
├──────────────────────────────────────┼──────────────────────┼────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Macro Fundamentals & Yields       │ -16.8                │ 55%    │ -9.2         │ 2Y: +0.81% (z: -1.2) | Policy: +1.38% | TIPS: 2.63% (z: 0.86)                       │
│ 2. Institutional Positioning & Flow  │ +50.0                │ 25%    │ +12.5        │ Index: 18% (EXTREME_DIVERGENCE_REVERSAL) | 4w Net: +9,359 | Sizing: 1x              │
│ 3. News Sentiment & Calendar         │ -86.9                │ 20%    │ -17.4        │ Bias: USD_BULLISH | Event Risk: NORMAL | Headlines: 8                               │
│ 4. Market Structure & Geometry       │ -56.3                │  0%    │  0.0         │ Trend: WEEKLY_BEARISH | RSI: 25.1 (Technicals Disabled from Scoring)                │
└──────────────────────────────────────┴──────────────────────┴────────┴──────────────┴─────────────────────────────────────────────────────────────────────────────────────┘

>>> COMPOSITE TRADING SCORE: -14.1 / 100 (Negative = USD Advantage, Positive = EUR Advantage) <<<
>>> REGIME & VERDICT:        STAND ASIDE / CAPITAL PRESERVATION <<<
```

### Key Fields to Watch:
* **Composite Score:** Negative scores denote Dollar strength / Euro weakness. Positive scores denote Euro strength.
* **Veto Status:** If hedge funds are covering shorts or a Tier-1 news release is due, the engine triggers an **Institutional Confluence Veto** and advises standing aside.
* **Audit Trail:** Every run writes a full JSON snapshot to `audit_report.json` detailing latency, data source health, raw metrics, and exact trade parameters.

---

## Convex Hourly Cron & Reactive Database

The engine includes a full **Convex** backend integration for automated hourly execution, structured historical persistence, and zero-latency real-time client subscriptions.

### Convex Architecture

```
convex/
├── schema.ts         # Strictly typed tables (audit_reports, latest_signal, macro_indicators, calendar_events, news_stream)
│                     # Includes timestampMs epoch indexes for fast numerical range slicing
├── crons.ts          # Native cron scheduler:
│                     # • Hourly execution (:00 UTC) for 4-pillar analysis & DB persistence
│                     # • Weekly storage retention (Sundays 02:00 UTC) pruning audits >90 days
├── engine.ts         # Node.js action running the 4-pillar engine & internal mutations
├── mutations.ts      # Internal mutations (saveAuditReport, pruneOldAuditReports)
└── queries.ts        # Reactive queries for frontend dashboards:
                      # • getLatestSignal (singleton O(1) reactive trade plan)
                      # • getMacroIndicatorsRange (millisecond range slicing for charts)
                      # • getAuditHistory, getCalendarEvents, getNewsStream
```

### Initializing & Deploying with Convex

1. **Link your Convex project in development:**
   ```bash
   bun run convex:dev
   ```

2. **Sync Environment Secrets to Convex Cloud:**
   ```bash
   bun convex env set tiny_fish_api="your_tinyfish_api_key"
   bun convex env set GROQ_API_KEY="your_groq_api_key"
   ```

3. **Deploy the Production Cron & Backend:**
   ```bash
   bun run convex:deploy
   ```

4. **Trigger an On-Demand Cloud Run or Query Signals:**
   ```bash
   # Run on-demand execution on Convex cloud
   bun convex run engine:runNow

   # Query the latest active trade signal & regime
   bun convex run queries:getLatestSignal

   # Query macro indicator time-series for charting (last 7 days by default)
   bun convex run queries:getMacroIndicatorsRange
   ```

---

## Project Structure

```
├── src/
│   ├── index.ts             # Orchestrator & CLI entry point
│   ├── types.ts             # Strict TypeScript interfaces & config defaults
│   ├── dataProvider.ts      # Resilient data fetching, retries, caching, Wilder indicators
│   ├── tradePlan.ts         # Asymmetric risk geometry, position sizing, & veto gates
│   ├── ai/                  # Modular AI Qualitative Classification Layer
│   │   ├── types.ts         # Semantic bias types & classification interfaces
│   │   ├── groqProvider.ts  # Groq Qwen 3.8 27B implementation with timeout guard
│   │   └── index.ts         # Pluggable AI provider facade
│   └── layers/
│       ├── macro.ts         # Yield spreads, TIPS real rates, TTF gas, Brent, central banks
│       ├── positioning.ts   # CFTC CoT speculative positioning & squeeze detection
│       ├── news.ts          # Dual-vector TinyFish news stream & Forex calendar guard
│       └── technical.ts     # Multi-timeframe trend & local 5-day structural anchors
├── convex/                  # Convex Cloud Cron & Reactive Database
│   ├── schema.ts            # Typed database schema & indexes
│   ├── crons.ts             # Hourly cron schedule
│   ├── engine.ts            # Node.js cloud execution action
│   ├── mutations.ts         # Internal DB write mutations
│   └── queries.ts           # Real-time reactive query endpoints
├── scripts/                 # Independent testing & benchmarking scripts
│   ├── test_groq_models.ts  # Model benchmarking & semantic testing
│   └── benchmark_round2.ts  # Multi-scenario accuracy benchmarks
├── audit_report.json        # Persisted audit report from the latest run
├── bun.lock                 # Bun lockfile
├── package.json             # NPM / Bun scripts and dependencies
└── tsconfig.json            # TypeScript configuration
```

---

## License
ISC
