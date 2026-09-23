import {
  LiveRates,
  MacroFactor,
  MacroLayerResult,
  MarketHistory,
  DEFAULT_CONFIG
} from '../types';
import {
  dataProvider,
  calcZScore,
  calcPercentile,
  tanhNormalize
} from '../dataProvider';

// ============================================================================
// DYNAMIC CENTRAL BANK POLICY RATE RETRIEVAL (FED & ECB)
// ============================================================================

export async function fetchLivePolicyRates(): Promise<LiveRates> {
  console.log("Fetching live Central Bank policy rates (Federal Reserve & ECB)...");

  let fedRate = 3.875;
  let fedRate30dAgo = 3.875;
  let fedSource = "Static Fallback (Midpoint 3.875%)";

  // 1. Primary Fed Source: Federal Reserve Bank of New York (EFFR 30-day series & Target Range)
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
        : `NY Fed (Effective Federal Funds Rate: ${fedRate.toFixed(2)}%)`;
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
// LAYER 1: DATA-DRIVEN DYNAMIC MACRO ENGINE (60% Weight)
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
      weight: 35,
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
