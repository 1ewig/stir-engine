import { TechnicalLayerResult } from '../types';
import {
  dataProvider,
  calcWilderRSI,
  calcWilderATR,
  tanhNormalize
} from '../dataProvider';

// ============================================================================
// LAYER 3: LOCAL MARKET STRUCTURE & MULTI-TIMEFRAME TECHNICAL ENGINE (25% Weight)
// Integrates 5-day local structure (tight invalidation) with Weekly trend alignment
// ============================================================================

export async function runTechnicalEngine(): Promise<TechnicalLayerResult> {
  console.log("Analyzing Pillar 4: Market Structure & Trade Geometry (5-Day Structure & Volatility Bands)...");

  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?range=1y&interval=1d';
  const { data } = await dataProvider.fetchWithRetry<any>('Yahoo_EURUSD_Chart', url);

  const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes: number[] = (quotes?.close || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  const highs: number[] = (quotes?.high || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  const lows: number[] = (quotes?.low || []).filter((x: any): x is number => typeof x === 'number' && !isNaN(x) && x > 0);

  // Fallback guard
  if (!closes || closes.length < 30 || !highs || highs.length < 30 || !lows || lows.length < 30) {
    console.warn("[Technical Engine] Insufficient price history from Yahoo Finance (< 30 bars). Falling back to safe baseline.");
    const fallbackPrice = closes.length > 0 ? closes[closes.length - 1] : 1.0800;
    return {
      score: 0,
      currentPrice: parseFloat(fallbackPrice.toFixed(4)),
      weeklyTrend: 'WEEKLY_NEUTRAL',
      sma20w: parseFloat(fallbackPrice.toFixed(4)),
      sma20: parseFloat(fallbackPrice.toFixed(4)),
      sma20SlopePips: 0,
      sma50: parseFloat(fallbackPrice.toFixed(4)),
      sma200: parseFloat(fallbackPrice.toFixed(4)),
      rsiWilder: 50.0,
      rsiScore: 0,
      rsiExhaustionState: 'NORMAL',
      atrPips: 55,
      localSwingHigh5d: parseFloat((fallbackPrice + 0.0040).toFixed(4)),
      localSwingLow5d: parseFloat((fallbackPrice - 0.0040).toFixed(4)),
      swingHigh20: parseFloat((fallbackPrice + 0.0080).toFixed(4)),
      swingLow20: parseFloat((fallbackPrice - 0.0080).toFixed(4)),
      channelMid: parseFloat(fallbackPrice.toFixed(4)),
      breakoutState: 'INSIDE_RANGE'
    };
  }

  const currentPrice = closes[closes.length - 1];

  // Moving average helper
  const calcSMA = (p: number, offset = 0) => {
    const end = closes.length - offset;
    const period = Math.min(p, end);
    if (period <= 0) return closes[closes.length - 1] || 1.08;
    const slice = closes.slice(end - period, end);
    return slice.reduce((a, b) => a + b, 0) / period;
  };

  const sma20 = calcSMA(20);
  const sma20_prev5 = calcSMA(20, 5);
  const sma20SlopePips = parseFloat((((sma20 - sma20_prev5) / 5) * 10000).toFixed(1));

  const sma50 = calcSMA(50);
  const sma200 = calcSMA(200);

  // Weekly Trend Structure (20-week moving average = 100 trading days)
  const sma20w = calcSMA(100);
  const sma20w_prev10 = calcSMA(100, 10);
  const sma20wSlopePips = parseFloat((((sma20w - sma20w_prev10) / 10) * 10000).toFixed(1));

  let weeklyTrend: 'WEEKLY_BULLISH' | 'WEEKLY_BEARISH' | 'WEEKLY_NEUTRAL' = 'WEEKLY_NEUTRAL';
  if (currentPrice > sma20w && sma20wSlopePips >= 0.5) {
    weeklyTrend = 'WEEKLY_BULLISH';
  } else if (currentPrice < sma20w && sma20wSlopePips <= -0.5) {
    weeklyTrend = 'WEEKLY_BEARISH';
  }

  // Wilder's indicators
  const rsiWilder = calcWilderRSI(closes, 14);
  const atrDaily = calcWilderATR(highs, lows, closes, 14);
  const safeAtrDaily = (atrDaily && !isNaN(atrDaily) && atrDaily > 0) ? atrDaily : 0.0055;
  const atrPips = Math.round(safeAtrDaily * 10000);

  // Local 5-Day Swing Structure (for tight asymmetric invalidation)
  const recentHighs5 = highs.slice(-5);
  const recentLows5 = lows.slice(-5);
  const localSwingHigh5d = Math.max(...recentHighs5);
  const localSwingLow5d = Math.min(...recentLows5);

  let breakoutState: 'BULLISH_BREAKOUT_5D' | 'BEARISH_BREAKOUT_5D' | 'INSIDE_RANGE' = 'INSIDE_RANGE';
  if (currentPrice >= localSwingHigh5d) {
    breakoutState = 'BULLISH_BREAKOUT_5D';
  } else if (currentPrice <= localSwingLow5d) {
    breakoutState = 'BEARISH_BREAKOUT_5D';
  }

  // 20-day swing extremes (major regime channel)
  const recentHighs20 = highs.slice(-20);
  const recentLows20 = lows.slice(-20);
  const swingHigh20 = Math.max(...recentHighs20);
  const swingLow20 = Math.min(...recentLows20);
  const channelMid = (swingHigh20 + swingLow20) / 2;

  // Technical Scoring Formula (-100 to +100):
  // 1. Weekly Structure Alignment (35% of technical layer)
  const weeklyScore = weeklyTrend === 'WEEKLY_BULLISH' ? +35 : weeklyTrend === 'WEEKLY_BEARISH' ? -35 : 0;

  // 2. Daily Moving Average Slope & Proximity (35% of technical layer)
  // Distance capped to avoid giving max points when price is stretched far from mean
  const dist20Atr = (currentPrice - sma20) / safeAtrDaily;
  const dist50Atr = (currentPrice - sma50) / safeAtrDaily;
  const slopeScore = tanhNormalize(sma20SlopePips / 4.0) * 15;
  const smaScore = (tanhNormalize(dist20Atr, 0.5) * 10) +
                   (tanhNormalize(dist50Atr, 0.5) * 10) +
                   slopeScore;

  // 3. Wilder RSI Exhaustion Guard (30% of technical layer)
  let rsiExhaustionState: 'NORMAL' | 'OVERSOLD_EXHAUSTION' | 'OVERBOUGHT_EXHAUSTION' = 'NORMAL';
  let rsiScore = 0;

  if (rsiWilder <= 30) {
    rsiExhaustionState = 'OVERSOLD_EXHAUSTION';
    // Downside is stretched: dampen short bias to prevent selling into the bottom
    rsiScore = +12.0;
  } else if (rsiWilder >= 70) {
    rsiExhaustionState = 'OVERBOUGHT_EXHAUSTION';
    // Upside is stretched: dampen long bias to prevent buying at top
    rsiScore = -12.0;
  } else {
    // Healthy trend runway
    const deviation = (rsiWilder - 50) / 20; // -1.0 at 30, +1.0 at 70
    rsiScore = parseFloat((tanhNormalize(deviation * 1.2) * 30).toFixed(1));
  }

  let totalTechScore = weeklyScore + smaScore + rsiScore;
  totalTechScore = Math.max(-100, Math.min(100, parseFloat(totalTechScore.toFixed(1))));

  return {
    score: totalTechScore,
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    weeklyTrend,
    sma20w: parseFloat(sma20w.toFixed(4)),
    sma20: parseFloat(sma20.toFixed(4)),
    sma20SlopePips,
    sma50: parseFloat(sma50.toFixed(4)),
    sma200: parseFloat(sma200.toFixed(4)),
    rsiWilder: parseFloat(rsiWilder.toFixed(1)),
    rsiScore: parseFloat(rsiScore.toFixed(1)),
    rsiExhaustionState,
    atrPips,
    localSwingHigh5d: parseFloat(localSwingHigh5d.toFixed(4)),
    localSwingLow5d: parseFloat(localSwingLow5d.toFixed(4)),
    swingHigh20: parseFloat(swingHigh20.toFixed(4)),
    swingLow20: parseFloat(swingLow20.toFixed(4)),
    channelMid: parseFloat(channelMid.toFixed(4)),
    breakoutState
  };
}
