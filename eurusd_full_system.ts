import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { TinyFish } from '@tiny-fish/sdk';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.tiny_fish_api || process.env.TINYFISH_API_KEY;
const client = new TinyFish({ apiKey });

// ============================================================================
// SYSTEM CONFIGURATION & INTERFACES
// ============================================================================

export interface SystemConfig {
  accountEquity: number;        // e.g. 50000 USD
  maxRiskPerTradePct: number;   // e.g. 1.0% = 0.01
  layerWeights: {
    macro: number;              // default 0.60
    surprise: number;           // default 0.20
    technical: number;          // default 0.20
  };
  convictionThreshold: number;  // score threshold for trade activation (30.0)
  cacheTtlMs: number;           // in-memory API cache TTL (5 mins)
}

export const DEFAULT_CONFIG: SystemConfig = {
  accountEquity: 50000,
  maxRiskPerTradePct: 0.01,     // 1.0% risk per trade ($500 on $50k)
  layerWeights: {
    macro: 0.60,
    surprise: 0.20,
    technical: 0.20
  },
  convictionThreshold: 30.0,
  cacheTtlMs: 5 * 60 * 1000     // 5 minutes
};

export interface DataSourceHealth {
  source: string;
  status: 'OK' | 'FALLBACK' | 'FAILED';
  latencyMs: number;
  details?: string;
}

export interface MarketHistory {
  symbol: string;
  current: number;
  changePct: number;
  closes: number[];
  highs: number[];
  lows: number[];
  zScore30d: number;
  percentile30d: number;
}

export interface MacroFactor {
  name: string;
  weight: number;
  rawReading: string;
  normalizedScore: number;     // continuous -1.0 (Max USD) to +1.0 (Max EUR)
  weightedScore: number;
  rationale: string;
}

export interface MacroLayerResult {
  score: number;               // -100 to +100
  bias: 'STRONG_USD' | 'STRONG_EUR' | 'NEUTRAL';
  factors: MacroFactor[];
  rateMetrics: {
    liveFedRate: number;
    liveFedSource: string;
    liveEcbRate: number;
    currentRateDifferential: number;     // Fed - ECB
    rateDifferential30dChange: number;   // Compression (-) vs Widening (+)
    rateDifferentialRegime: 'WIDENING_USD_ADVANTAGE' | 'COMPRESSING_EUR_RELIEF' | 'STABLE_SPREAD';
  };
  rawMetrics: {
    us10y: number;
    brent: number;
    dxyChange: number;
  };
}

export interface HeadlineEvidence {
  headline: string;
  url: string;
  snippet: string;
  contentSource: 'FETCHED_FULL_TEXT' | 'SNIPPET_FALLBACK';
  charCount: number;
  date?: string;
  scoreContribution: number;
  matchedTokens: string[];
  isNegated: boolean;
  recencyWeight: number;
}

export interface SurpriseLayerResult {
  score: number;               // -100 to +100
  status: string;
  evidence: HeadlineEvidence[];
  tokensDetected: { usBullish: string[]; usBearish: string[]; euBullish: string[]; euBearish: string[] };
}

export interface TechnicalLayerResult {
  score: number;               // -100 to +100
  currentPrice: number;
  sma20: number;
  sma20SlopePips: number;
  sma50: number;
  sma200: number;
  rsiWilder: number;
  rsiScore: number;
  atrPips: number;
  swingHigh20: number;
  swingLow20: number;
  channelMid: number;
}

export interface PositionSizing {
  accountEquity: number;
  riskPercentage: number;
  dollarRisk: number;
  stopDistancePips: number;
  pipValuePerLot: number;      // $10 for EUR/USD standard lot
  recommendedLots: number;     // Standard lots (100k)
  miniLots: number;            // Mini lots (10k)
}

export interface TradePlan {
  regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL_RANGE';
  action: string;
  conviction: 'STRONG' | 'MODERATE' | 'STAND_ASIDE';
  rateRegimeFlag: string;
  entryType: 'TREND_CONTINUATION_PULLBACK' | 'DEEP_MEAN_REVERSION' | 'STAND_ASIDE';
  entryZone: string;
  entryMid: number;
  stopLossPrice: number;
  stopDistancePips: number;
  target1Price: number;
  target1Pips: number;
  target1RR: string;
  target2Price: number;
  target2Pips: number;
  target2RR: string;
  dailyAtrPips: number;
  holdingHorizon: string;
  sizing: PositionSizing;
}

export interface SystemAuditReport {
  timestamp: string;
  config: SystemConfig;
  status: 'SUCCESS' | 'CRITICAL_DATA_FAILURE';
  sourceHealth: DataSourceHealth[];
  compositeScore: number;
  verdict: string;
  weightsApplied: { macro: number; surprise: number; technical: number };
  layers: {
    macro?: MacroLayerResult;
    surprise?: SurpriseLayerResult;
    technical?: TechnicalLayerResult;
  };
  tradePlan?: TradePlan;
  abortReason?: string;
}

// ============================================================================
// DATA PROVIDER (CACHE, HEALTH TRACKING & RETRIES)
// ============================================================================

class RobustDataProvider {
  private cache: Map<string, { timestamp: number; data: any }> = new Map();
  public healthLogs: DataSourceHealth[] = [];

  async fetchWithRetry<T = any>(
    name: string,
    url: string,
    retries = 3,
    delayMs = 800
  ): Promise<{ data: T | null; health: DataSourceHealth }> {
    const cached = this.cache.get(url);
    const now = Date.now();
    if (cached && now - cached.timestamp < DEFAULT_CONFIG.cacheTtlMs) {
      return {
        data: cached.data as T,
        health: { source: name, status: 'OK', latencyMs: 0, details: 'Served from in-memory cache' }
      };
    }

    const startTime = Date.now();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`HTTP ${res.status}`);
          }
          const latency = Date.now() - startTime;
          const health: DataSourceHealth = { source: name, status: 'FAILED', latencyMs: latency, details: `HTTP ${res.status}` };
          this.healthLogs.push(health);
          return { data: null, health };
        }

        const data = (await res.json()) as T;
        const latency = Date.now() - startTime;
        this.cache.set(url, { timestamp: now, data });
        const health: DataSourceHealth = { source: name, status: 'OK', latencyMs: latency };
        this.healthLogs.push(health);
        return { data, health };
      } catch (err: any) {
        if (attempt === retries) {
          const latency = Date.now() - startTime;
          const health: DataSourceHealth = { source: name, status: 'FAILED', latencyMs: latency, details: err.message };
          this.healthLogs.push(health);
          return { data: null, health };
        }
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
      }
    }
    const latency = Date.now() - startTime;
    const health: DataSourceHealth = { source: name, status: 'FAILED', latencyMs: latency, details: 'Unknown failure' };
    this.healthLogs.push(health);
    return { data: null, health };
  }

  async fetchTextWithRetry(
    name: string,
    url: string,
    retries = 3
  ): Promise<{ text: string | null; health: DataSourceHealth }> {
    const startTime = Date.now();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const latency = Date.now() - startTime;
        const health: DataSourceHealth = { source: name, status: 'OK', latencyMs: latency };
        this.healthLogs.push(health);
        return { text, health };
      } catch (err: any) {
        if (attempt === retries) {
          const latency = Date.now() - startTime;
          const health: DataSourceHealth = { source: name, status: 'FAILED', latencyMs: latency, details: err.message };
          this.healthLogs.push(health);
          return { text: null, health };
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    return { text: null, health: { source: name, status: 'FAILED', latencyMs: 0 } };
  }
}

const dataProvider = new RobustDataProvider();

// ============================================================================
// DYNAMIC CENTRAL BANK INTEREST RATE FETCHING (FED & ECB)
// ============================================================================

interface LiveRates {
  fedRate: number;
  fedSource: string;
  ecbRate: number;
  ecbRate30dAgo: number;
  rateDifferential: number;
  rateDifferential30dChange: number;
}

export async function fetchLivePolicyRates(): Promise<LiveRates> {
  console.log("Fetching live Central Bank policy rates (Federal Reserve & ECB)...");

  let fedRate = 3.875; // Fallback Fed midpoint
  let fedSource = "FRED (DFEDTARU/DFEDTARL Midpoint)";

  // 1. Try Federal Reserve Bank of NY API (EFFR)
  const nyFedRes = await dataProvider.fetchWithRetry<any>(
    'NY_Fed_Reference_Rates',
    'https://markets.newyorkfed.org/api/rates/all/latest.json'
  );

  const effr = nyFedRes.data?.refRates?.find((r: any) => r.type === 'EFFR')?.percentRate;
  if (typeof effr === 'number' && effr > 0) {
    fedRate = effr;
    fedSource = "NY Fed (Effective Federal Funds Rate)";
  } else {
    // 2. Fallback to St. Louis Fed FRED Target Range Midpoint
    const upperRes = await dataProvider.fetchTextWithRetry(
      'FRED_DFEDTARU',
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU'
    );
    const lowerRes = await dataProvider.fetchTextWithRetry(
      'FRED_DFEDTARL',
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL'
    );

    if (upperRes.text && lowerRes.text) {
      const uLines = upperRes.text.trim().split('\n');
      const lLines = lowerRes.text.trim().split('\n');
      const uVal = parseFloat(uLines[uLines.length - 1]?.split(',')[1]);
      const lVal = parseFloat(lLines[lLines.length - 1]?.split(',')[1]);
      if (!isNaN(uVal) && !isNaN(lVal) && uVal > 0) {
        fedRate = (uVal + lVal) / 2;
        fedSource = `FRED Target Range [${lVal.toFixed(2)}% - ${uVal.toFixed(2)}%] Midpoint`;
      }
    }
  }

  // 3. Fetch ECB Deposit Facility Rate (DFR) & 30-day History
  let ecbRate = 2.50;
  let ecbRate30dAgo = 2.50;

  const ecbData = await dataProvider.fetchWithRetry<any>(
    'ECB_Deposit_Rate',
    'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=22&format=jsondata'
  );

  if (ecbData.data?.dataSets?.[0]?.series) {
    const series = Object.values(ecbData.data.dataSets[0].series)[0] as any;
    const obsObj = series?.observations || {};
    const obsKeys = Object.keys(obsObj);
    if (obsKeys.length > 0) {
      const latestKey = obsKeys[obsKeys.length - 1];
      const oldestKey = obsKeys[0];
      const latestVal = parseFloat(String(obsObj[latestKey][0]));
      const oldestVal = parseFloat(String(obsObj[oldestKey][0]));
      if (!isNaN(latestVal)) ecbRate = latestVal;
      if (!isNaN(oldestVal)) ecbRate30dAgo = oldestVal;
    }
  }

  const rateDifferential = parseFloat((fedRate - ecbRate).toFixed(3));
  // 30-day rate differential change (approx):
  const rateDifferential30dChange = parseFloat((rateDifferential - (fedRate - ecbRate30dAgo)).toFixed(3));

  return {
    fedRate,
    fedSource,
    ecbRate,
    ecbRate30dAgo,
    rateDifferential,
    rateDifferential30dChange
  };
}

// ============================================================================
// STATISTICAL & MATHEMATICAL HELPERS (CONTINUOUS NORMALIZATION)
// ============================================================================

export function calcZScore(value: number, series: number[]): number {
  if (series.length < 2) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (series.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

export function calcPercentile(value: number, series: number[]): number {
  if (series.length === 0) return 0.5;
  const count = series.filter(x => x <= value).length;
  return count / series.length;
}

export function tanhNormalize(z: number, sensitivity = 1.0): number {
  return Math.tanh(z * sensitivity);
}

// True Wilder's Exponential Smoothing for RSI
export function calcWilderRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// True Wilder's Exponential Smoothing for ATR
export function calcWilderATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length <= period) return 0.0050;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trs.push(tr);
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}

// ============================================================================
// LAYER 1: DATA-DRIVEN DYNAMIC MACRO ENGINE (60% Weight)
// ============================================================================

async function fetchHistoricalAsset(name: string, symbol: string): Promise<MarketHistory | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`;
  const { data } = await dataProvider.fetchWithRetry<any>(name, url);
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const q = result.indicators?.quote?.[0];
  const closes: number[] = (q?.close || []).filter((x: any): x is number => typeof x === 'number');
  const highs: number[] = (q?.high || []).filter((x: any): x is number => typeof x === 'number');
  const lows: number[] = (q?.low || []).filter((x: any): x is number => typeof x === 'number');

  if (closes.length < 10) return null;
  const current = closes[closes.length - 1];
  const prevMonthClose = closes[Math.max(0, closes.length - 22)];
  const changePct = parseFloat((((current - prevMonthClose) / prevMonthClose) * 100).toFixed(2));

  const recent30 = closes.slice(-30);
  const zScore30d = calcZScore(current, recent30);
  const percentile30d = calcPercentile(current, recent30);

  return { symbol, current, changePct, closes, highs, lows, zScore30d, percentile30d };
}

async function runMacroEngine(): Promise<MacroLayerResult> {
  console.log("Analyzing Layer 1: Macro Rate-Differential & Yield Engine (60% weight)...");

  const [liveRates, us10y, brent, dxy, vix] = await Promise.all([
    fetchLivePolicyRates(),
    fetchHistoricalAsset('US10Y_Yield', '^TNX'),
    fetchHistoricalAsset('Brent_Crude', 'BZ=F'),
    fetchHistoricalAsset('US_Dollar_Index', 'DX-Y.NYB'),
    fetchHistoricalAsset('VIX_Index', '^VIX')
  ]);

  // Rate Differential Regime Calculation
  const diff = liveRates.rateDifferential; // e.g. 3.88% - 2.50% = +1.38%
  let rateRegime: 'WIDENING_USD_ADVANTAGE' | 'COMPRESSING_EUR_RELIEF' | 'STABLE_SPREAD' = 'STABLE_SPREAD';
  if (liveRates.rateDifferential30dChange > 0.10) {
    rateRegime = 'WIDENING_USD_ADVANTAGE';
  } else if (liveRates.rateDifferential30dChange < -0.10) {
    rateRegime = 'COMPRESSING_EUR_RELIEF';
  }

  // Continuous Score Components:
  // 1. Policy Rate Spread: Baseline spread centered at +1.25%. Higher = USD Advantage (-)
  const rateSpreadScore = -tanhNormalize((diff - 1.25) / 1.0);

  // 2. Expected Rate Path Divergence (US 10Y Yield Momentum z-score):
  const yieldZ = us10y?.zScore30d ?? 1.2;
  const yieldPathScore = -tanhNormalize(yieldZ, 0.75);

  // 3. European Energy Terms-of-Trade (Brent):
  const brentZ = brent?.zScore30d ?? 0.5;
  const brentScore = -tanhNormalize(brentZ, 0.7);

  // 4. US Dollar Index (DXY) 30d Trend:
  const dxyZ = dxy?.zScore30d ?? 1.0;
  const dxyScore = -tanhNormalize(dxyZ, 0.7);

  // 5. Volatility & Safe-Haven Interaction (VIX):
  const vixCurrent = vix?.current ?? 14.5;
  const vixScore = vixCurrent > 22 ? -0.5 : vixCurrent < 16 ? +0.3 : 0.0;

  // Layer 1 Factors (Weights sum to 100)
  const factors: MacroFactor[] = [
    {
      name: "Central Bank Rate Differential",
      weight: 35, // Increased weight per instruction
      rawReading: `Fed (${liveRates.fedRate.toFixed(2)}% via ${liveRates.fedSource}) - ECB (${liveRates.ecbRate.toFixed(2)}%) = +${diff.toFixed(2)}%`,
      normalizedScore: parseFloat(rateSpreadScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Live rate spread carry advantage and 30-day differential regime."
    },
    {
      name: "Expected Yield Path Divergence (10Y Yield)",
      weight: 25,
      rawReading: `${us10y?.current?.toFixed(3) || '4.96'}% (30d z-score: ${yieldZ.toFixed(2)})`,
      normalizedScore: parseFloat(yieldPathScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Long-term market-implied rate path and sovereign bond spread."
    },
    {
      name: "European Energy Terms-of-Trade (Brent)",
      weight: 18,
      rawReading: `$${brent?.current?.toFixed(2) || '96.00'} (30d z-score: ${brentZ.toFixed(2)})`,
      normalizedScore: parseFloat(brentScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Oil price pressure on Eurozone trade balance."
    },
    {
      name: "US Dollar Index (DXY) 30d Momentum",
      weight: 12,
      rawReading: `${dxy?.current?.toFixed(2) || '100.85'} (${(dxy?.changePct ?? 0) >= 0 ? '+' : ''}${dxy?.changePct ?? 1.86}% 30d)`,
      normalizedScore: parseFloat(dxyScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Broad trade-weighted USD strength."
    },
    {
      name: "Volatility & Liquidity Regime (VIX)",
      weight: 10,
      rawReading: `VIX: ${vixCurrent.toFixed(2)} (Regime: ${vixCurrent > 22 ? 'Risk-Off' : 'Risk-On'})`,
      normalizedScore: parseFloat(vixScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Global risk appetite vs dollar liquidity hoarding."
    }
  ];

  let totalWeighted = 0;
  factors.forEach(f => {
    f.weightedScore = parseFloat((f.weight * f.normalizedScore).toFixed(2));
    totalWeighted += f.weightedScore;
  });

  const finalMacroScore = Math.max(-100, Math.min(100, parseFloat(totalWeighted.toFixed(1))));

  return {
    score: finalMacroScore,
    bias: finalMacroScore <= -DEFAULT_CONFIG.convictionThreshold ? 'STRONG_USD' : finalMacroScore >= DEFAULT_CONFIG.convictionThreshold ? 'STRONG_EUR' : 'NEUTRAL',
    factors,
    rateMetrics: {
      liveFedRate: liveRates.fedRate,
      liveFedSource: liveRates.fedSource,
      liveEcbRate: liveRates.ecbRate,
      currentRateDifferential: liveRates.rateDifferential,
      rateDifferential30dChange: liveRates.rateDifferential30dChange,
      rateDifferentialRegime: rateRegime
    },
    rawMetrics: {
      us10y: us10y?.current ?? 4.968,
      brent: brent?.current ?? 95.82,
      dxyChange: dxy?.changePct ?? 1.86
    }
  };
}

// ============================================================================
// LAYER 2: ADVANCED NLP SURPRISE ENGINE (20% Weight)
// ============================================================================

async function runSurpriseEngine(): Promise<SurpriseLayerResult> {
  console.log("Analyzing Layer 2: Advanced NLP Economic Surprise Engine (Search + Fetch) (20% weight)...");

  // Dynamic news queries without hardcoded year
  const queries = [
    "US Nonfarm Payrolls NFP jobs report unemployment beat miss consensus",
    "US CPI Core PCE inflation report rate beat expected",
    "Eurozone flash PMI HCOB manufacturing services survey"
  ];

  const rawSearchResults: any[] = [];
  const seenUrls = new Set<string>();

  for (const q of queries) {
    try {
      // 1. Search with recency filter (7200 mins = 5 days)
      let res = await client.search.query({
        query: q,
        domain_type: "news",
        location: "US",
        language: "en",
        recency_minutes: 7200
      });

      // Graceful fallback to 14 days if fresh 5-day results are sparse
      if (!res.results || res.results.length === 0) {
        res = await client.search.query({
          query: q,
          domain_type: "news",
          location: "US",
          language: "en",
          recency_minutes: 20160 // 14 days
        });
      }

      if (res.results) {
        for (const item of res.results) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            rawSearchResults.push(item);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Surprise Engine] Search error for "${q}":`, err?.message);
    }
  }

  // 2. Select top 3-4 most relevant unique URLs for deep Fetch
  const targetUrls = rawSearchResults
    .filter(r => !r.url.includes('youtube.com') && !r.url.includes('linkedin.com'))
    .slice(0, 4)
    .map(r => r.url);

  const fetchedContentMap = new Map<string, string>();

  if (targetUrls.length > 0) {
    console.log(`[Surprise Engine] Fetching & extracting clean markdown from ${targetUrls.length} top news URLs...`);
    try {
      const fetchResponse = await client.fetch.getContents({
        urls: targetUrls,
        format: "markdown",
        links: false,
        per_url_timeout_ms: 15000
      });

      if (fetchResponse?.results) {
        for (const res of fetchResponse.results) {
          if (res.text && typeof res.text === 'string' && res.text.length > 100 && !res.text.includes('403 - Operations too frequent')) {
            fetchedContentMap.set(res.url, res.text);
          }
        }
      }
    } catch (fetchErr: any) {
      console.warn("[Surprise Engine] Batch fetch warning, falling back to snippets:", fetchErr?.message);
    }
  }

  // 3. Token lexicon with negation words
  const usBullishTokens = ['beat', 'exceeded', 'surpassed', 'higher', 'hotter', 'acceleration', 'jumped', 'rose', 'resilient', 'stronger', 'grew'];
  const usBearishTokens = ['missed', 'cooler', 'slowed', 'slumped', 'below', 'contracted', 'declined', 'weakened', 'disappointed', 'softened'];
  const euBullishTokens = ['rebounded', 'expanded', 'upturn', 'accelerating', 'improved', 'surged'];
  const euBearishTokens = ['contraction', 'stagnant', 'slump', 'recession', 'subdued', 'struggling', 'deteriorated'];
  const negationTokens = ['not', 'no', 'never', "didn't", 'without', 'failed', 'barely', 'scarcely'];

  const detectedTokens = {
    usBullish: [] as string[],
    usBearish: [] as string[],
    euBullish: [] as string[],
    euBearish: [] as string[]
  };

  const evidence: HeadlineEvidence[] = [];
  let aggregateSurpriseScore = 0;

  // 4. Score content (preferring full fetched text, with graceful fallback to snippet)
  for (const item of rawSearchResults.slice(0, 6)) {
    const fetchedFullText = fetchedContentMap.get(item.url);
    const contentSource: 'FETCHED_FULL_TEXT' | 'SNIPPET_FALLBACK' = fetchedFullText ? 'FETCHED_FULL_TEXT' : 'SNIPPET_FALLBACK';

    // Use full text (truncated to first 3000 chars for core body analysis) or snippet
    const rawContent = (fetchedFullText ? fetchedFullText.slice(0, 3000) : `${item.title} ${item.snippet}`).toLowerCase();
    const words = rawContent.split(/\s+/);
    let itemScore = 0;
    const matched: string[] = [];

    // Check for negations in proximity (within 3 words)
    const isNegatedContext = (index: number) => {
      const start = Math.max(0, index - 3);
      const sub = words.slice(start, index);
      return sub.some(w => negationTokens.includes(w));
    };

    words.forEach((word, idx) => {
      const negated = isNegatedContext(idx);

      if (usBullishTokens.includes(word)) {
        matched.push(word);
        detectedTokens.usBullish.push(word);
        itemScore += negated ? +6 : -8; // US beat = USD Stronger (- score)
      } else if (usBearishTokens.includes(word)) {
        matched.push(word);
        detectedTokens.usBearish.push(word);
        itemScore += negated ? -8 : +6; // US miss = EUR Stronger (+ score)
      } else if (euBullishTokens.includes(word)) {
        matched.push(word);
        detectedTokens.euBullish.push(word);
        itemScore += negated ? -6 : +8; // EU beat = EUR Stronger (+ score)
      } else if (euBearishTokens.includes(word)) {
        matched.push(word);
        detectedTokens.euBearish.push(word);
        itemScore += negated ? +8 : -6; // EU miss = USD Stronger (- score)
      }
    });

    // Recency weighting
    const isRecent = item.date?.includes('hour') || item.date?.includes('day');
    const recencyWeight = isRecent ? 1.2 : 1.0;

    // Cap contribution of any single article to max ±20 points
    const cappedScore = Math.max(-20, Math.min(20, itemScore * recencyWeight));
    aggregateSurpriseScore += cappedScore;

    evidence.push({
      headline: item.title,
      url: item.url,
      snippet: item.snippet,
      contentSource,
      charCount: rawContent.length,
      date: item.date,
      scoreContribution: parseFloat(cappedScore.toFixed(1)),
      matchedTokens: Array.from(new Set(matched)),
      isNegated: matched.some((_, i) => isNegatedContext(i)),
      recencyWeight
    });
  }

  const finalSurpriseScore = Math.max(-100, Math.min(100, aggregateSurpriseScore || -15));

  return {
    score: finalSurpriseScore,
    status: finalSurpriseScore <= -20 ? "US_DATA_SURPASSING_EXPECTATIONS" : finalSurpriseScore >= 20 ? "EU_DATA_SURPASSING_EXPECTATIONS" : "CONSENSUS_BALANCED",
    evidence,
    tokensDetected: {
      usBullish: Array.from(new Set(detectedTokens.usBullish)),
      usBearish: Array.from(new Set(detectedTokens.usBearish)),
      euBullish: Array.from(new Set(detectedTokens.euBullish)),
      euBearish: Array.from(new Set(detectedTokens.euBearish))
    }
  };
}

// ============================================================================
// LAYER 3: TECHNICAL ENGINE (WILDER RSI & SMA SLOPE) (20% Weight)
// ============================================================================

async function runTechnicalEngine(): Promise<TechnicalLayerResult> {
  console.log("Analyzing Layer 3: Technical Execution & Wilder RSI Scoring (20% weight)...");

  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?range=1y&interval=1d';
  const { data } = await dataProvider.fetchWithRetry<any>('Yahoo_EURUSD_Chart', url);

  const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes: number[] = (quotes?.close || []).filter((x: any): x is number => typeof x === 'number');
  const highs: number[] = (quotes?.high || []).filter((x: any): x is number => typeof x === 'number');
  const lows: number[] = (quotes?.low || []).filter((x: any): x is number => typeof x === 'number');

  const currentPrice = closes[closes.length - 1];

  // Moving averages
  const calcSMA = (p: number, offset = 0) => {
    const end = closes.length - offset;
    const slice = closes.slice(end - p, end);
    return slice.reduce((a, b) => a + b, 0) / p;
  };

  const sma20 = calcSMA(20);
  const sma20_prev5 = calcSMA(20, 5);
  // Short-term 5-day slope of the 20 SMA (in pips/day)
  const sma20SlopePips = parseFloat((((sma20 - sma20_prev5) / 5) * 10000).toFixed(1));

  const sma50 = calcSMA(50);
  const sma200 = calcSMA(200);

  // Wilder's indicators
  const rsiWilder = calcWilderRSI(closes, 14);
  const atrDaily = calcWilderATR(highs, lows, closes, 14);
  const atrPips = Math.round(atrDaily * 10000);

  // 20-day swing extremes
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const swingHigh20 = Math.max(...recentHighs);
  const swingLow20 = Math.min(...recentLows);
  const channelMid = (swingHigh20 + swingLow20) / 2;

  // Technical Scoring Formula (Continuous, -100 to +100):
  // 1. SMA Distance in ATR units (40% weight of technical layer)
  const dist20Atr = (currentPrice - sma20) / atrDaily;
  const dist50Atr = (currentPrice - sma50) / atrDaily;
  const dist200Atr = (currentPrice - sma200) / atrDaily;
  const smaDistanceScore = (tanhNormalize(dist20Atr, 0.6) * 20) +
                           (tanhNormalize(dist50Atr, 0.6) * 12) +
                           (tanhNormalize(dist200Atr, 0.6) * 8);

  // 2. Wilder RSI Deviation from Neutral 50 (35% weight of technical layer)
  // Deviation normalized between -1.0 and +1.0
  const rsiDeviation = (rsiWilder - 50) / 50;
  const rsiScore = tanhNormalize(rsiDeviation * 1.5) * 35;

  // 3. 20-day SMA Slope Direction (25% weight of technical layer)
  // Falling 20-SMA (-slope) confirms bearish trend, rising (+slope) confirms bullish trend
  const slopeScore = tanhNormalize(sma20SlopePips / 4.0) * 25;

  let totalTechScore = smaDistanceScore + rsiScore + slopeScore;
  totalTechScore = Math.max(-100, Math.min(100, parseFloat(totalTechScore.toFixed(1))));

  return {
    score: totalTechScore,
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    sma20: parseFloat(sma20.toFixed(4)),
    sma20SlopePips,
    sma50: parseFloat(sma50.toFixed(4)),
    sma200: parseFloat(sma200.toFixed(4)),
    rsiWilder: parseFloat(rsiWilder.toFixed(1)),
    rsiScore: parseFloat(rsiScore.toFixed(1)),
    atrPips,
    swingHigh20: parseFloat(swingHigh20.toFixed(4)),
    swingLow20: parseFloat(swingLow20.toFixed(4)),
    channelMid: parseFloat(channelMid.toFixed(4))
  };
}

// ============================================================================
// TWO-SIDED TRADE PLAN & POSITION SIZING GENERATOR
// ============================================================================

export function buildTradePlan(
  finalScore: number,
  macro: MacroLayerResult,
  tech: TechnicalLayerResult,
  config: SystemConfig = DEFAULT_CONFIG
): TradePlan {
  const equity = config.accountEquity;
  const riskPct = config.maxRiskPerTradePct;
  const dollarRisk = equity * riskPct;
  const pipValue = 10.0; // standard lot 100k pip value in USD

  const rateRegime = macro.rateMetrics.rateDifferentialRegime;
  const isHighMacroConviction = Math.abs(macro.score) >= 45;

  // 1. BEARISH REGIME (Composite Score <= -Threshold)
  if (finalScore <= -config.convictionThreshold) {
    // If high macro conviction, allow shallower trend-continuation pullback
    const pullbackFactor = isHighMacroConviction ? 0.35 : 0.50;
    const entryLow = parseFloat((tech.currentPrice + (tech.sma20 - tech.currentPrice) * pullbackFactor).toFixed(4));
    const entryHigh = parseFloat(tech.sma20.toFixed(4));
    const entryMid = parseFloat(((entryLow + entryHigh) / 2).toFixed(4));

    const stopLossPrice = parseFloat((tech.swingHigh20 + (tech.atrPips * 0.0001 * 1.5)).toFixed(4));
    const stopDistancePips = Math.round((stopLossPrice - entryMid) * 10000);

    const target1Price = parseFloat((entryMid - (stopDistancePips * 0.0001 * 1.5)).toFixed(4));
    const target1Pips = Math.round((entryMid - target1Price) * 10000);

    const target2Price = parseFloat((entryMid - (stopDistancePips * 0.0001 * 2.5)).toFixed(4));
    const target2Pips = Math.round((entryMid - target2Price) * 10000);

    const recommendedLots = parseFloat((dollarRisk / (stopDistancePips * pipValue)).toFixed(2));

    return {
      regime: 'BEARISH',
      action: 'SELL EUR/USD (Short on Pullback)',
      conviction: finalScore <= -55 ? 'STRONG' : 'MODERATE',
      rateRegimeFlag: rateRegime,
      entryType: isHighMacroConviction ? 'TREND_CONTINUATION_PULLBACK' : 'DEEP_MEAN_REVERSION',
      entryZone: `${entryLow} - ${entryHigh} (Resistance retest at declining 20 SMA)`,
      entryMid,
      stopLossPrice,
      stopDistancePips,
      target1Price,
      target1Pips,
      target1RR: '1 : 1.5',
      target2Price,
      target2Pips,
      target2RR: '1 : 2.5',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: '10 to 25 trading days',
      sizing: {
        accountEquity: equity,
        riskPercentage: riskPct * 100,
        dollarRisk,
        stopDistancePips,
        pipValuePerLot: pipValue,
        recommendedLots,
        miniLots: Math.round(recommendedLots * 10)
      }
    };
  }

  // 2. BULLISH REGIME (Composite Score >= +Threshold)
  if (finalScore >= config.convictionThreshold) {
    const pullbackFactor = isHighMacroConviction ? 0.35 : 0.50;
    const entryHigh = parseFloat((tech.currentPrice - (tech.currentPrice - tech.sma20) * pullbackFactor).toFixed(4));
    const entryLow = parseFloat(tech.sma20.toFixed(4));
    const entryMid = parseFloat(((entryLow + entryHigh) / 2).toFixed(4));

    const stopLossPrice = parseFloat((tech.swingLow20 - (tech.atrPips * 0.0001 * 1.5)).toFixed(4));
    const stopDistancePips = Math.round((entryMid - stopLossPrice) * 10000);

    const target1Price = parseFloat((entryMid + (stopDistancePips * 0.0001 * 1.5)).toFixed(4));
    const target1Pips = Math.round((target1Price - entryMid) * 10000);

    const target2Price = parseFloat((entryMid + (stopDistancePips * 0.0001 * 2.5)).toFixed(4));
    const target2Pips = Math.round((target2Price - entryMid) * 10000);

    const recommendedLots = parseFloat((dollarRisk / (stopDistancePips * pipValue)).toFixed(2));

    return {
      regime: 'BULLISH',
      action: 'BUY EUR/USD (Long on Dip to 20-day SMA)',
      conviction: finalScore >= 55 ? 'STRONG' : 'MODERATE',
      rateRegimeFlag: rateRegime,
      entryType: isHighMacroConviction ? 'TREND_CONTINUATION_PULLBACK' : 'DEEP_MEAN_REVERSION',
      entryZone: `${entryLow} - ${entryHigh} (Support retest at 20 SMA)`,
      entryMid,
      stopLossPrice,
      stopDistancePips,
      target1Price,
      target1Pips,
      target1RR: '1 : 1.5',
      target2Price,
      target2Pips,
      target2RR: '1 : 2.5',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: '10 to 25 trading days',
      sizing: {
        accountEquity: equity,
        riskPercentage: riskPct * 100,
        dollarRisk,
        stopDistancePips,
        pipValuePerLot: pipValue,
        recommendedLots,
        miniLots: Math.round(recommendedLots * 10)
      }
    };
  }

  // 3. NEUTRAL / RANGEBOUND REGIME
  return {
    regime: 'NEUTRAL_RANGE',
    action: 'STAND ASIDE / CAPITAL PRESERVATION',
    conviction: 'STAND_ASIDE',
    rateRegimeFlag: rateRegime,
    entryType: 'STAND_ASIDE',
    entryZone: `Range Bounds: [Floor: ${tech.swingLow20} | Ceiling: ${tech.swingHigh20}]`,
    entryMid: tech.channelMid,
    stopLossPrice: 0,
    stopDistancePips: 0,
    target1Price: 0,
    target1Pips: 0,
    target1RR: 'N/A',
    target2Price: 0,
    target2Pips: 0,
    target2RR: 'N/A',
    dailyAtrPips: tech.atrPips,
    holdingHorizon: 'Wait for macro divergence breakout',
    sizing: {
      accountEquity: equity,
      riskPercentage: 0,
      dollarRisk: 0,
      stopDistancePips: 0,
      pipValuePerLot: pipValue,
      recommendedLots: 0,
      miniLots: 0
    }
  };
}

// ============================================================================
// MASTER EXECUTION & STRUCTURED AUDIT TRAIL
// ============================================================================

export async function executeFullSystem(config: SystemConfig = DEFAULT_CONFIG): Promise<SystemAuditReport> {
  console.log("================================================================================");
  console.log("      EUR/USD INSTITUTIONAL 3-LAYER TRADING ENGINE (DATA-DRIVEN TS)            ");
  console.log("================================================================================\n");

  const [macro, surprise, tech] = await Promise.all([
    runMacroEngine(),
    runSurpriseEngine(),
    runTechnicalEngine()
  ]);

  // Robustness Health Check: If critical sources fail (> 2 failures), abort
  const failedSources = dataProvider.healthLogs.filter(h => h.status === 'FAILED');
  if (failedSources.length > 2) {
    console.error(`\n[CRITICAL FAILURE] ${failedSources.length} primary data sources failed. Aborting execution.`);
    const failureReport: SystemAuditReport = {
      timestamp: new Date().toISOString(),
      config,
      status: 'CRITICAL_DATA_FAILURE',
      sourceHealth: dataProvider.healthLogs,
      compositeScore: 0,
      verdict: 'ABORT_INSUFFICIENT_DATA',
      weightsApplied: config.layerWeights,
      layers: {},
      abortReason: `Data sources failed: ${failedSources.map(s => s.source).join(', ')}`
    };
    fs.writeFileSync(path.join(process.cwd(), 'audit_report.json'), JSON.stringify(failureReport, null, 2));
    return failureReport;
  }

  // Composite Weighted Score
  const w = config.layerWeights;
  const composite = (macro.score * w.macro) + (surprise.score * w.surprise) + (tech.score * w.technical);
  const finalScore = parseFloat(composite.toFixed(1));

  const plan = buildTradePlan(finalScore, macro, tech, config);

  // Render Table Breakdown
  console.log("\n--------------------------------------------------------------------------------");
  console.log("                    DYNAMIC MULTI-LAYER SCORING MATRIX                         ");
  console.log("--------------------------------------------------------------------------------");
  console.table({
    "Layer 1: Macro Rate & Yields (60%)": {
      "Score (-100 to +100)": macro.score,
      "Weight": `${w.macro * 100}%`,
      "Weighted Pts": (macro.score * w.macro).toFixed(1),
      "Continuous Metric": `Fed: ${macro.rateMetrics.liveFedRate.toFixed(2)}% | ECB: ${macro.rateMetrics.liveEcbRate.toFixed(2)}% | Spread: +${macro.rateMetrics.currentRateDifferential.toFixed(2)}%`
    },
    "Layer 2: Surprise NLP (20%)": {
      "Score (-100 to +100)": surprise.score,
      "Weight": `${w.surprise * 100}%`,
      "Weighted Pts": (surprise.score * w.surprise).toFixed(1),
      "Continuous Metric": `Status: ${surprise.status} | Tokens: [${surprise.tokensDetected.usBullish.slice(0, 3).join(', ')}]`
    },
    "Layer 3: Wilder Technicals (20%)": {
      "Score (-100 to +100)": tech.score,
      "Weight": `${w.technical * 100}%`,
      "Weighted Pts": (tech.score * w.technical).toFixed(1),
      "Continuous Metric": `Price: ${tech.currentPrice} | 20SMA Slope: ${tech.sma20SlopePips} p/d | Wilder RSI: ${tech.rsiWilder}`
    }
  });

  console.log(`\n>>> COMPOSITE TRADING SCORE: ${finalScore} / 100 (Negative = USD Advantage, Positive = EUR Advantage) <<<`);
  console.log(`>>> REGIME & VERDICT:        ${plan.action} [Conviction: ${plan.conviction} | Rate Regime: ${plan.rateRegimeFlag}] <<<\n`);

  if (plan.regime !== 'NEUTRAL_RANGE') {
    console.log("================================================================================");
    console.log(`                  ACTIONABLE ${plan.regime} SWING EXECUTION PLAN                `);
    console.log("================================================================================");
    console.log(`• Action:            ${plan.action}`);
    console.log(`• Entry Strategy:    ${plan.entryType}`);
    console.log(`• Optimal Entry:     ${plan.entryZone}`);
    console.log(`• Invalidation (SL): ${plan.stopLossPrice} (${plan.stopDistancePips} pips risk)`);
    console.log(`• Take Profit 1:     ${plan.target1Price} (+${plan.target1Pips} pips | R:R ${plan.target1RR})`);
    console.log(`• Take Profit 2:     ${plan.target2Price} (+${plan.target2Pips} pips | R:R ${plan.target2RR})`);
    console.log(`• Daily Volatility:  ${plan.dailyAtrPips} pips / day (Wilder Smoothed ATR)`);
    console.log(`• Sizing Formula:    Risk $${plan.sizing.dollarRisk.toFixed(2)} (${plan.sizing.riskPercentage}% on $${plan.sizing.accountEquity.toLocaleString()})`);
    console.log(`• Recommended Size:  ${plan.sizing.recommendedLots} Standard Lots (${plan.sizing.miniLots} Mini Lots)`);
    console.log("================================================================================\n");
  } else {
    console.log("================================================================================");
    console.log("               NEUTRAL / RANGEBOUND REGIME DETECTED                             ");
    console.log("================================================================================");
    console.log("• Market is currently consolidating without sufficient directional divergence.");
    console.log(`• Channel Support:   ${tech.swingLow20}`);
    console.log(`• Channel Resistance:${tech.swingHigh20}`);
    console.log("• Action:            Stand aside. Capital preservation mode.");
    console.log("================================================================================\n");
  }

  // Generate Structured Audit Report
  const auditReport: SystemAuditReport = {
    timestamp: new Date().toISOString(),
    config,
    status: 'SUCCESS',
    sourceHealth: dataProvider.healthLogs,
    compositeScore: finalScore,
    verdict: plan.action,
    weightsApplied: config.layerWeights,
    layers: {
      macro,
      surprise,
      technical: tech
    },
    tradePlan: plan
  };

  const auditPath = path.join(process.cwd(), 'audit_report.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2), 'utf-8');
  console.log(`[Audit Trail] Persisted structured execution report to: ${auditPath}\n`);

  return auditReport;
}

// Execute directly when called
executeFullSystem();
