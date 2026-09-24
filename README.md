# EUR/USD Institutional Swing Trading Engine

> **A fundamental-first quantitative engine designed for 2-week to 1-month EUR/USD swing legs, driven by sovereign rate velocity, energy terms of trade, CFTC positioning divergence, and real-time news flow.**

Most retail trading bots try to predict currency moves using lagging chart indicators on 5-minute candles—and consistently get chopped up. 

Institutional foreign exchange desks at major investment banks and macro hedge funds approach the market differently: **currencies trade on macro divergence, real yield differentials, terms of trade, and institutional positioning imbalances.**

This project is a TypeScript/Bun quantitative engine that pulls live, official macroeconomic data, analyzes live market sentiment, and generates an asymmetric swing execution plan with strict capital preservation vetoes.

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
│                       MULTI-LAYER SCORING MATRIX                        │
│                                                                         │
│  Layer 1: Sovereign Yields, Real Rates & Energy ToT        [55% Weight] │
│  Layer 2: CFTC CoT Speculative Flow & Squeeze Risk         [25% Weight] │
│  Layer 3: Live News Sentiment & Economic Calendar          [20% Weight] │
│  Layer 4: Technical Structure & Asymmetric Invalidation    [ 0% Default]│
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

### 3. Live News Sentiment & Event-Risk Guard (20% Default Weight)
* **Real-Time News Stream:** Integrates the `@tiny-fish/sdk` to query global financial outlets (Reuters, Bloomberg, ForexFactory, DailyFX, etc.) for live central bank and rate expectations, scoring headlines from `-100` (USD Bullish) to `+100` (EUR Bullish).
* **Tier-1 Event Risk Guard:** Fetches weekly high- and medium-impact economic releases (NFP, CPI, PMIs, Fed/ECB meetings). If an ultra-high-impact release is due in $<6$ hours, an execution blackout veto is triggered so you never gamble into a binary volatility spike.

### 4. Technical Structure & Risk Geometry (0% Default Scoring Weight)
Technicals are **disabled by default from biasing the directional score** (avoiding curve-fitting and lagging signals). Instead, local structure is strictly used to anchor entry and invalidation:
* **True Structural Invalidation:** Stops are never placed at arbitrary pip distances. They are anchored strictly outside the local 5-day swing highs/lows plus an ATR buffer.
* **Location Guard:** If price is stretched far from resistance (e.g. after a 300-pip drop), the engine refuses to market sell. It demands a limit order retracement closer to value, ensuring asymmetric payoffs:
  * **Take Profit 1:** 1:2.0 Risk/Reward (partial profit & de-risk).
  * **Take Profit 2:** 1:4.0 Risk/Reward (runner for multi-week expansion).

---

## Quick Start

### Prerequisites
* [Bun](https://bun.sh/) (recommended for fast TypeScript execution) or Node.js v18+
* Optional: A TinyFish API key for live news search (add to `.env.local`)

### Installation

```bash
git clone <repo-url>
cd "ai trading stuff"
bun install
```

Configure your `.env.local` file:
```env
tiny_fish_api=your_tinyfish_api_key_here
```
*(Note: If no TinyFish API key is present, the engine automatically falls back to neutral news sentiment while maintaining all calendar and macro feeds.)*

---

## Running the Engine

### 1. Standard Run (Recommended: Macro + Positioning + News)
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
                    DYNAMIC MULTI-LAYER SCORING MATRIX                         
--------------------------------------------------------------------------------
┌────────────────────────────────────────────────┬──────────────────────┬────────┬──────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
│ Layer                                          │ Score (-100 to +100) │ Weight │ Weighted Pts │ Continuous Metric                                                                   │
├────────────────────────────────────────────────┼──────────────────────┼────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Sovereign Yields, Real Rates & Energy │ -49.8                │ 55%    │ -27.4        │ 2Y: +1.57% | 10Y Real TIPS: 2.63% | TTF Gas: €73.9/MWh                              │
│ Layer 2: CFTC CoT Flow Divergence              │ +50.0                │ 25%    │ +12.5        │ Index: 18% (EXTREME_DIVERGENCE_REVERSAL) | 4w Net: +9,359 | Sizing: 1x              │
│ Layer 3: News Flow & Economic Calendar         │ -38.0                │ 20%    │ -7.6         │ Bias: USD_BULLISH | Event Risk: NORMAL | Headlines: 10                              │
│ Layer 4: Local Structure & Technicals          │ -56.0                │  0%    │  0.0         │ Trend: WEEKLY_BEARISH | RSI: 26.3 (Technicals Disabled from Scoring)                │
└────────────────────────────────────────────────┴──────────────────────┴────────┴──────────────┴─────────────────────────────────────────────────────────────────────────────────────┘

>>> COMPOSITE TRADING SCORE: -22.5 / 100 (Negative = USD Advantage, Positive = EUR Advantage) <<<
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
├── crons.ts          # Native hourly cron scheduler (runs at :00 UTC)
├── engine.ts         # Node.js action running the 4-layer engine & internal mutations
├── mutations.ts      # Internal mutations persisting reports, indicators, and calendar data
└── queries.ts        # Reactive queries for frontend dashboards (getLatestSignal, getAuditHistory, etc.)
```

### Initializing & Running with Convex

1. **Log in & link your Convex project:**
   ```bash
   bun run convex:dev
   ```
   Follow the CLI prompt to select or link your Convex project.

2. **Add Environment Secrets to Convex (Dashboard or CLI):**
   ```bash
   bun convex env set tiny_fish_api="your_tinyfish_api_key_here"
   ```

3. **Deploy the Production Cron & Backend:**
   ```bash
   bun run convex:deploy
   ```

---

## License
ISC
