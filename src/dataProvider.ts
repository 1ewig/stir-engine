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
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000)
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
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000)
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
