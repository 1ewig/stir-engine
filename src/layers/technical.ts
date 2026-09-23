import { TechnicalLayerResult } from '../types';
import {
  dataProvider,
  calcWilderRSI,
  calcWilderATR,
  tanhNormalize
} from '../dataProvider';

// ============================================================================
// LAYER 3: TECHNICAL ENGINE (WILDER RSI, ATR & SMA SLOPE) (20% Weight)
// ============================================================================

export async function runTechnicalEngine(): Promise<TechnicalLayerResult> {
  console.log("Analyzing Layer 3: Technical Execution & Wilder RSI Scoring (20% weight)...");

  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?range=1y&interval=1d';
  const { data } = await dataProvider.fetchWithRetry<any>('Yahoo_EURUSD_Chart', url);

  const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes: number[] = (quotes?.close || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  const highs: number[] = (quotes?.high || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  const lows: number[] = (quotes?.low || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);

  // Guard against missing, truncated or invalid price series from Yahoo Finance
  if (!closes || closes.length < 20 || !highs || highs.length < 20 || !lows || lows.length < 20) {
    console.warn("[Technical Engine] Insufficient price history from Yahoo Finance (< 20 bars). Falling back to safe baseline.");
    dataProvider.healthLogs.push({
      source: 'Yahoo_EURUSD_Chart',
      status: 'FAILED',
      latencyMs: 0,
      details: 'Insufficient price history returned (< 20 bars)'
    });
    const fallbackPrice = closes.length > 0 ? closes[closes.length - 1] : 1.0800;
    return {
      score: 0,
      currentPrice: parseFloat(fallbackPrice.toFixed(4)),
      sma20: parseFloat(fallbackPrice.toFixed(4)),
      sma20SlopePips: 0,
      sma50: parseFloat(fallbackPrice.toFixed(4)),
      sma200: parseFloat(fallbackPrice.toFixed(4)),
      rsiWilder: 50.0,
      rsiScore: 0,
      atrPips: 60,
      swingHigh20: parseFloat((fallbackPrice + 0.0060).toFixed(4)),
      swingLow20: parseFloat((fallbackPrice - 0.0060).toFixed(4)),
      channelMid: parseFloat(fallbackPrice.toFixed(4))
    };
  }

  const currentPrice = closes[closes.length - 1];

  // Moving averages with dynamic lookback protection
  const calcSMA = (p: number, offset = 0) => {
    const end = closes.length - offset;
    const period = Math.min(p, end);
    if (period <= 0) return closes[closes.length - 1] || 1.08;
    const slice = closes.slice(end - period, end);
    return slice.reduce((a, b) => a + b, 0) / period;
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
  const safeAtrDaily = (atrDaily && !isNaN(atrDaily) && atrDaily > 0) ? atrDaily : 0.0060;
  const atrPips = Math.round(safeAtrDaily * 10000);

  // 20-day swing extremes
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const swingHigh20 = Math.max(...recentHighs);
  const swingLow20 = Math.min(...recentLows);
  const channelMid = (swingHigh20 + swingLow20) / 2;

  // Technical Scoring Formula (Continuous, -100 to +100):
  // 1. SMA Distance in ATR units (40% weight of technical layer)
  const dist20Atr = (currentPrice - sma20) / safeAtrDaily;
  const dist50Atr = (currentPrice - sma50) / safeAtrDaily;
  const dist200Atr = (currentPrice - sma200) / safeAtrDaily;
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
