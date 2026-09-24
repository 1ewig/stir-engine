import {
  LiveRates,
  MacroFactor,
  MacroLayerResult,
  MarketHistory,
  YieldSpreadMetrics,
  DEFAULT_CONFIG
} from '../types';
import {
  dataProvider,
  fetchUstYieldSeries,
  fetchEcbBenchmarkYield,
  fetchFredValue,
  fetchFredSeries,
  fetchDutchTtfGas,
  calcZScore,
  calcPercentile,
  tanhNormalize
} from '../dataProvider';

// ============================================================================
// CENTRAL BANK POLICY RATE RETRIEVAL (FED & ECB) - CONTEXTUAL MONITORING
// ============================================================================

export async function fetchLivePolicyRates(): Promise<LiveRates> {
  console.log("Fetching live Central Bank policy rates (Federal Reserve & ECB)...");

  let fedRate = 3.875;
  let fedRate30dAgo = 3.875;
  let fedSource = "Static Fallback (3.875%)";

  // 1. Primary Fed Source: NY Fed EFFR
  const nyFedRes = await dataProvider.fetchWithRetry<any>(
    'NY_Fed_Reference_Rates',
    'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/30.json'
  );

  const effrRates = nyFedRes.data?.refRates;
  if (Array.isArray(effrRates) && effrRates.length > 0) {
    const latest = effrRates[0];
    if (typeof latest.percentRate === 'number' && latest.percentRate > 0) {
      fedRate = latest.percentRate;
      const targetFrom = latest.targetRateFrom;
      const targetTo = latest.targetRateTo;
      fedSource = (targetFrom !== undefined && targetTo !== undefined)
        ? `NY Fed (EFFR: ${fedRate.toFixed(2)}%, Target: [${targetFrom.toFixed(2)}% - ${targetTo.toFixed(2)}%])`
        : `NY Fed (EFFR: ${fedRate.toFixed(2)}%)`;
    }

    const oldest = effrRates[effrRates.length - 1];
    if (typeof oldest?.percentRate === 'number' && oldest.percentRate > 0) {
      fedRate30dAgo = oldest.percentRate;
    }
  } else {
    // 2. Secondary Fed Fallback: FRED Target Range (DFEDTARU / DFEDTARL)
    const upperRes = await dataProvider.fetchTextWithRetry(
      'FRED_DFEDTARU',
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU',
      2
    );
    const lowerRes = await dataProvider.fetchTextWithRetry(
      'FRED_DFEDTARL',
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL',
      2
    );

    if (upperRes.text && lowerRes.text) {
      const uLines = upperRes.text.trim().split('\n').filter((l: string) => l.includes(','));
      const lLines = lowerRes.text.trim().split('\n').filter((l: string) => l.includes(','));

      if (uLines.length > 0 && lLines.length > 0) {
        const uLatest = parseFloat(uLines[uLines.length - 1].split(',')[1]);
        const lLatest = parseFloat(lLines[lLines.length - 1].split(',')[1]);
        if (!isNaN(uLatest) && !isNaN(lLatest) && uLatest > 0) {
          fedRate = (uLatest + lLatest) / 2;
          fedSource = `FRED Target Range [${lLatest.toFixed(2)}% - ${uLatest.toFixed(2)}%] Midpoint`;
        }

        const idx30d = Math.max(1, uLines.length - 23);
        const u30d = parseFloat(uLines[idx30d]?.split(',')[1]);
        const l30d = parseFloat(lLines[idx30d]?.split(',')[1]);
        if (!isNaN(u30d) && !isNaN(l30d) && u30d > 0) {
          fedRate30dAgo = (u30d + l30d) / 2;
        }
      }
    }
  }

  // 3. Fetch ECB Deposit Facility Rate (DFR)
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
  const rateDifferential30dAgo = parseFloat((fedRate30dAgo - ecbRate30dAgo).toFixed(3));
  const rateDifferential30dChange = parseFloat((rateDifferential - rateDifferential30dAgo).toFixed(3));

  return {
    fedRate,
    fedSource,
    fedRate30dAgo,
    ecbRate,
    ecbRate30dAgo,
    rateDifferential,
    rateDifferential30dChange
  };
}

// ============================================================================
// LAYER 1: TWO-SPEED SOVEREIGN YIELD ACCELERATION ENGINE (50% Weight)
// Eliminates 20-day lag: Fast 3-day impulse + Medium 10-day swing momentum
// ============================================================================

export async function fetchHistoricalAsset(name: string, symbol: string): Promise<MarketHistory | null> {
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

export async function runMacroEngine(): Promise<MacroLayerResult> {
  console.log("Analyzing Layer 1: Sovereign Yield Velocity, Level Z-Scores, Policy Spreads & Energy Terms of Trade...");

  const [liveRates, us2ySeries, de2ySeries, us10ySeries, de10ySeries, brent, vix, us10yTipsSeries, us10yBreakevenVal, dutchTtfGasVal] = await Promise.all([
    fetchLivePolicyRates(),
    fetchUstYieldSeries('DGS2'),
    fetchEcbBenchmarkYield('2Y'),
    fetchUstYieldSeries('DGS10'),
    fetchEcbBenchmarkYield('10Y'),
    fetchHistoricalAsset('Brent_Crude', 'BZ=F'),
    fetchHistoricalAsset('VIX_Index', '^VIX'),
    fetchFredSeries('DFII10', 90),
    fetchFredValue('T10YIE'),
    fetchDutchTtfGas()
  ]);

  const us10yTips = us10yTipsSeries.length > 0 ? us10yTipsSeries[us10yTipsSeries.length - 1] : 2.63;
  const us10yBreakeven = us10yBreakevenVal ?? 2.35;
  const dutchTtfGas = dutchTtfGasVal ?? 73.9;

  // Current Yield Readings
  const us2yCurrent = us2ySeries[us2ySeries.length - 1] ?? 3.85;
  const de2yCurrent = de2ySeries[de2ySeries.length - 1] ?? 2.10;

  // 1. Two-Speed 2Y Spread Velocity:
  const us2yPast3 = us2ySeries[Math.max(0, us2ySeries.length - 4)] ?? us2yCurrent;
  const de2yPast3 = de2ySeries[Math.max(0, de2ySeries.length - 4)] ?? de2yCurrent;
  const us2yPast10 = us2ySeries[Math.max(0, us2ySeries.length - 11)] ?? us2yCurrent;
  const de2yPast10 = de2ySeries[Math.max(0, de2ySeries.length - 11)] ?? de2yCurrent;

  const spread2yCurrent = parseFloat((us2yCurrent - de2yCurrent).toFixed(3));
  const spread2yPast3 = parseFloat((us2yPast3 - de2yPast3).toFixed(3));
  const spread2yPast10 = parseFloat((us2yPast10 - de2yPast10).toFixed(3));

  const spread2yFastDelta3d = parseFloat((spread2yCurrent - spread2yPast3).toFixed(3));
  const spread2yMedDelta10d = parseFloat((spread2yCurrent - spread2yPast10).toFixed(3));

  // Compute 2Y spread series over overlapping dates (up to 90 days) for rolling z-score
  const minLen2y = Math.min(us2ySeries.length, de2ySeries.length);
  const spread2yHistory: number[] = [];
  for (let i = 0; i < minLen2y; i++) {
    const uIdx = us2ySeries.length - minLen2y + i;
    const dIdx = de2ySeries.length - minLen2y + i;
    spread2yHistory.push(us2ySeries[uIdx] - de2ySeries[dIdx]);
  }
  const spread2yZScore = calcZScore(spread2yCurrent, spread2yHistory);

  // 2. 10-Year Sovereign Yield Spread (10-day delta)
  const us10yCurrent = us10ySeries[us10ySeries.length - 1] ?? 4.25;
  const de10yCurrent = de10ySeries[de10ySeries.length - 1] ?? 2.35;
  const us10yPast10 = us10ySeries[Math.max(0, us10ySeries.length - 11)] ?? us10yCurrent;
  const de10yPast10 = de10ySeries[Math.max(0, de10ySeries.length - 11)] ?? de10yCurrent;

  const spread10yCurrent = parseFloat((us10yCurrent - de10yCurrent).toFixed(3));
  const spread10yPast10 = parseFloat((us10yPast10 - de10yPast10).toFixed(3));
  const spread10yDelta10d = parseFloat((spread10yCurrent - spread10yPast10).toFixed(3));

  const yieldSpreads: YieldSpreadMetrics = {
    us2y: us2yCurrent,
    de2y: de2yCurrent,
    spread2y: spread2yCurrent,
    spread2yFastDelta3d,
    spread2yMedDelta10d,
    spread2yZScore,
    us10y: us10yCurrent,
    de10y: de10yCurrent,
    spread10y: spread10yCurrent,
    spread10yDelta10d
  };

  // Continuous Scoring Logic:
  // 1. Fast 2Y Yield Spread Impulse (3-day delta) (20% weight)
  const fastScore = -tanhNormalize(spread2yFastDelta3d / 0.08);

  // 2. Medium 2Y Yield Spread Momentum (10-day delta) (20% weight)
  const medScore = -tanhNormalize(spread2yMedDelta10d / 0.15);

  // 3. 2Y Spread Structural Level Advantage (90d Z-Score) (15% weight)
  // Fixes plateau blindness: rewards wide structural carry advantage even when momentum stalls
  const level2yScore = -tanhNormalize(spread2yZScore / 1.2);

  // 4. Central Bank Policy Rate Differential (EFFR vs ECB DFR) (10% weight)
  const policyDiff = liveRates.rateDifferential;
  const policyLevelScore = -tanhNormalize(policyDiff / 1.75);
  const policyDeltaScore = -tanhNormalize(liveRates.rateDifferential30dChange / 0.35);
  const policyScore = parseFloat(((policyLevelScore * 0.70) + (policyDeltaScore * 0.30)).toFixed(3));

  // 5. 10-Year Spread Divergence (10-day delta) (10% weight)
  const score10y = -tanhNormalize(spread10yDelta10d / 0.12);

  // 6. 10Y TIPS Real Yield Advantage (90-Day Rolling Z-Score) (10% weight)
  const tipsZ = us10yTipsSeries.length >= 10 ? calcZScore(us10yTips, us10yTipsSeries) : (us10yTips - 2.2) / 0.5;
  const realYieldAdvantageScore = -tanhNormalize(tipsZ * 0.8);

  // 7. European Energy Terms-of-Trade (Brent Crude + Dutch TTF Natural Gas) (8% weight)
  const ttfBurden = Math.max(0, (dutchTtfGas - 35) / 40);
  const brentZ = brent?.zScore30d ?? 0.0;
  const energyScore = -Math.min(1.0, Math.max(-1.0, (tanhNormalize(brentZ, 0.6) * 0.4) + (tanhNormalize(ttfBurden, 0.8) * 0.6)));

  // 8. Global Risk Regime (VIX Level & 5d Velocity) (7% weight)
  const vixCurrent = vix?.current ?? 15.0;
  const vixCloses = vix?.closes || [];
  const vixPast5 = vixCloses.length >= 6 ? vixCloses[vixCloses.length - 6] : vixCurrent;
  const vix5dChange = vixCurrent - vixPast5;
  const vixVelocityScore = vix5dChange > 2.5 ? -0.4 : vix5dChange < -2.5 ? +0.3 : 0.0;
  const vixLevelScore = vixCurrent >= 20 ? -tanhNormalize((vixCurrent - 20) / 8) : +tanhNormalize((20 - vixCurrent) / 10);
  const vixScore = parseFloat(((vixLevelScore * 0.6) + (vixVelocityScore * 0.4)).toFixed(3));

  // Determine Rate Regime flag for reporting
  let rateRegime: 'WIDENING_USD_ADVANTAGE' | 'COMPRESSING_EUR_RELIEF' | 'STABLE_SPREAD' = 'STABLE_SPREAD';
  if (spread2yMedDelta10d > 0.06 || policyDiff > 1.25) {
    rateRegime = 'WIDENING_USD_ADVANTAGE';
  } else if (spread2yMedDelta10d < -0.06 || policyDiff < 0.25) {
    rateRegime = 'COMPRESSING_EUR_RELIEF';
  }

  // Layer 1 Factors (Weights sum to 100)
  const factors: MacroFactor[] = [
    {
      name: "Fast 2Y Yield Spread Impulse (3-Day Delta)",
      weight: 20,
      rawReading: `Spread: +${spread2yCurrent.toFixed(2)}% | 3d Delta: ${spread2yFastDelta3d >= 0 ? '+' : ''}${spread2yFastDelta3d.toFixed(2)}%`,
      normalizedScore: parseFloat(fastScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Captures immediate front-end rate repricing within 72 hours of catalysts."
    },
    {
      name: "Medium 2Y Yield Spread Momentum (10-Day Delta)",
      weight: 20,
      rawReading: `10d Delta: ${spread2yMedDelta10d >= 0 ? '+' : ''}${spread2yMedDelta10d.toFixed(2)}%`,
      normalizedScore: parseFloat(medScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Confirms multi-week monetary policy divergence and swing momentum."
    },
    {
      name: "2Y Spread Structural Level Advantage (90d Z-Score)",
      weight: 15,
      rawReading: `Spread: +${spread2yCurrent.toFixed(2)}% (z-score: ${spread2yZScore.toFixed(2)})`,
      normalizedScore: parseFloat(level2yScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Structural carry advantage: rewards extreme persistent yield spreads even when momentum pauses."
    },
    {
      name: "Central Bank Policy Rate Spread (EFFR vs ECB DFR)",
      weight: 10,
      rawReading: `Differential: +${policyDiff.toFixed(2)}% (Fed ${liveRates.fedRate.toFixed(2)}% vs ECB ${liveRates.ecbRate.toFixed(2)}%)`,
      normalizedScore: parseFloat(policyScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Official monetary policy stance gap anchoring the absolute front-end of the yield curve."
    },
    {
      name: "10Y Sovereign Yield Spread Momentum (10-Day Delta)",
      weight: 10,
      rawReading: `Spread: +${spread10yCurrent.toFixed(2)}% | 10d Delta: ${spread10yDelta10d >= 0 ? '+' : ''}${spread10yDelta10d.toFixed(2)}%`,
      normalizedScore: parseFloat(score10y.toFixed(3)),
      weightedScore: 0,
      rationale: "Long-term economic growth divergence and sovereign bond term premium."
    },
    {
      name: "10Y TIPS Real Yield Advantage (90d Rolling Z-Score)",
      weight: 10,
      rawReading: `US TIPS: ${us10yTips.toFixed(2)}% (90d z-score: ${tipsZ.toFixed(2)}) | Breakeven: ${us10yBreakeven.toFixed(2)}%`,
      normalizedScore: parseFloat(realYieldAdvantageScore.toFixed(3)),
      weightedScore: 0,
      rationale: "Real rate return differential dynamically normalized over 90 days against regime shifts."
    },
    {
      name: "European Energy Terms-of-Trade (Brent & Dutch TTF Gas)",
      weight: 8,
      rawReading: `TTF Gas: €${dutchTtfGas.toFixed(1)}/MWh | Brent: $${brent?.current?.toFixed(2) || '95.00'}`,
      normalizedScore: parseFloat(energyScore.toFixed(3)),
      weightedScore: 0,
      rationale: "European industrial energy import burden (Dutch TTF) vs US LNG export self-sufficiency."
    },
    {
      name: "Global Risk Sentiment & VIX Velocity",
      weight: 7,
      rawReading: `VIX: ${vixCurrent.toFixed(2)} (${vix5dChange >= 0 ? '+' : ''}${vix5dChange.toFixed(1)} 5d)`,
      normalizedScore: vixScore,
      weightedScore: 0,
      rationale: "Global risk-off dollar liquidity hoarding vs risk-on pro-cyclical euro flows."
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
    yieldSpreads,
    rateMetrics: {
      liveFedRate: liveRates.fedRate,
      liveFedSource: liveRates.fedSource,
      liveEcbRate: liveRates.ecbRate,
      currentRateDifferential: liveRates.rateDifferential,
      rateDifferential30dChange: liveRates.rateDifferential30dChange,
      policyScore,
      rateRegime
    },
    rawMetrics: {
      us2y: us2yCurrent,
      de2y: de2yCurrent,
      us10y: us10yCurrent,
      de10y: de10yCurrent,
      brent: brent?.current ?? 95.0,
      vix: vixCurrent
    },
    realYields: {
      us10yTips,
      us10yBreakeven,
      rollingZScore: parseFloat(tipsZ.toFixed(2))
    },
    energy: {
      brent: brent?.current ?? 95.0,
      dutchTtfGas
    }
  };
}
