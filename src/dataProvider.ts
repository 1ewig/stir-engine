import { DataSourceHealth, DEFAULT_CONFIG } from './types';

// ============================================================================
// DATA PROVIDER (CACHE, HEALTH TRACKING, RETRIES & TIMEOUT SIGNALS)
// ============================================================================

export class RobustDataProvider {
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
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(7000)
        });
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
    retries = 2
  ): Promise<{ text: string | null; health: DataSourceHealth }> {
    const startTime = Date.now();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(7000)
        });
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

export const dataProvider = new RobustDataProvider();

// ============================================================================
// SOVEREIGN YIELD & POSITIONING SPECIALIZED DATA ADAPTERS
// ============================================================================

/**
 * Fetch US Treasury yield series from FRED (or Yahoo finance fallback)
 */
export async function fetchUstYieldSeries(seriesId: 'DGS2' | 'DGS10'): Promise<number[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const res = await dataProvider.fetchTextWithRetry(`FRED_${seriesId}`, url);
  if (res.text) {
    const lines = res.text.trim().split('\n');
    const values: number[] = [];
    // Read from end to get recent daily observations (skip headers and '.' missing days)
    for (let i = lines.length - 1; i >= 0 && values.length < 40; i--) {
      const parts = lines[i].split(',');
      if (parts.length >= 2) {
        const val = parseFloat(parts[1].trim());
        if (!isNaN(val) && val > 0) {
          values.unshift(val);
        }
      }
    }
    if (values.length >= 5) return values;
  }

  // Graceful fallback to Yahoo Finance if FRED is unreachable
  const yahooSymbol = seriesId === 'DGS10' ? '^TNX' : '^IRX';
  try {
    const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=3mo&interval=1d`;
    const { data } = await dataProvider.fetchWithRetry<any>(`Yahoo_${yahooSymbol}`, yUrl);
    const closes: number[] = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
    if (closes.length >= 5) {
      return closes.slice(-30);
    }
  } catch (err) {
    console.warn(`[dataProvider] Fallback for ${seriesId} failed:`, err);
  }

  // Default institutional baseline if all feeds time out
  return seriesId === 'DGS2' ? Array(30).fill(3.85) : Array(30).fill(4.25);
}

/**
 * Fetch Euro Area AAA benchmark government bond yields from official ECB Data Portal API
 */
export async function fetchEcbBenchmarkYield(maturity: '2Y' | '10Y'): Promise<number[]> {
  const url = `https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_${maturity}?lastNObservations=35&format=jsondata`;
  const { data } = await dataProvider.fetchWithRetry<any>(`ECB_AAA_Yield_${maturity}`, url);

  try {
    if (data?.dataSets?.[0]?.series) {
      const series = Object.values(data.dataSets[0].series)[0] as any;
      const obsObj = series?.observations || {};
      const obsKeys = Object.keys(obsObj).sort((a, b) => parseInt(a) - parseInt(b));
      const values: number[] = [];
      for (const k of obsKeys) {
        const val = parseFloat(String(obsObj[k][0]));
        if (!isNaN(val)) {
          values.push(val);
        }
      }
      if (values.length >= 5) {
        return values;
      }
    }
  } catch (e) {
    console.warn(`[dataProvider] Error parsing ECB yield ${maturity}:`, e);
  }

  // Safe fallback if ECB API is offline
  return maturity === '2Y' ? Array(30).fill(2.10) : Array(30).fill(2.35);
}

/**
 * Fetch weekly Commitments of Traders (COT) Euro FX speculative futures positioning from CFTC
 */
export async function fetchCftcEuroPositioning(): Promise<any[]> {
  const url = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=099741&$limit=52&$order=report_date_as_yyyy_mm_dd%20DESC';
  const { data } = await dataProvider.fetchWithRetry<any[]>('CFTC_COT_Euro_FX', url);
  if (Array.isArray(data) && data.length > 0) {
    return data;
  }
  return [];
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
