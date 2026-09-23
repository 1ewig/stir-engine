// ============================================================================
// SYSTEM CONFIGURATION & INTERFACES FOR EUR/USD SWING TRADING ENGINE
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

export interface SeriesAnalysis {
  mean: number;
  stdDev: number;
  zScore: number;
  percentile: number;
  change30dPct: number;
}

export interface LiveRates {
  fedRate: number;
  fedSource: string;
  fedRate30dAgo: number;
  ecbRate: number;
  ecbRate30dAgo: number;
  rateDifferential: number;
  rateDifferential30dChange: number;
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
