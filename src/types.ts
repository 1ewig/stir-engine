// ============================================================================
// SYSTEM CONFIGURATION & INTERFACES FOR EUR/USD INSTITUTIONAL SWING TRADING ENGINE
// Specially calibrated for multi-week to monthly legs (10 to 25 trading days)
// Asymmetric Risk Geometry: 40-65 pip stops, 1:2.5 to 1:5+ R:R payoffs
// ============================================================================

export interface SystemConfig {
  layerWeights: {
    macro: number;              // default 0.55 (Two-speed sovereign yield spreads, real yields, energy ToT)
    positioning: number;        // default 0.25 (CFTC CoT divergence & institutional flow)
    news: number;               // default 0.20 (Live news sentiment & economic surprises)
    technical: number;          // default 0.00 (Technicals 0% scoring weight by default)
  };
  convictionThreshold: number;  // score threshold for conviction activation (25.0)
  cacheTtlMs: number;           // in-memory API cache TTL (5 mins)
  accountEquity?: number;       // optional legacy context
  maxRiskPerTradePct?: number;  // optional legacy context
}

export const DEFAULT_CONFIG: SystemConfig = {
  layerWeights: {
    macro: 0.55,                // 55% Yields, Real Rates, Energy
    positioning: 0.25,          // 25% CFTC CoT Flow Divergence
    news: 0.20,                 // 20% News Sentiment & Economic Calendar
    technical: 0.00             // 0% Technicals Disabled by default (structural reference only)
  },
  convictionThreshold: 25.0,
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

export interface LiveRates {
  fedRate: number;
  fedSource: string;
  fedRate30dAgo: number;
  ecbRate: number;
  ecbRate30dAgo: number;
  rateDifferential: number;
  rateDifferential30dChange: number;
}

export interface YieldSpreadMetrics {
  us2y: number;
  de2y: number;
  spread2y: number;             // US 2Y - DE 2Y
  spread2yFastDelta3d: number;  // Fast 3-day spread velocity (impulse detection)
  spread2yMedDelta10d: number;  // Medium 10-day spread velocity (trend confirmation)
  spread2yZScore: number;       // 30d z-score of spread
  us10y: number;
  de10y: number;
  spread10y: number;            // US 10Y - DE 10Y
  spread10yDelta10d: number;    // 10-day 10Y spread momentum
}

export interface MacroFactor {
  name: string;
  weight: number;
  rawReading: string;
  normalizedScore: number;      // continuous -1.0 (Max USD) to +1.0 (Max EUR)
  weightedScore: number;
  rationale: string;
}

export interface MacroLayerResult {
  score: number;                // -100 to +100
  bias: 'STRONG_USD' | 'STRONG_EUR' | 'NEUTRAL';
  factors: MacroFactor[];
  yieldSpreads: YieldSpreadMetrics;
  rateMetrics: {
    liveFedRate: number;
    liveFedSource: string;
    liveEcbRate: number;
    currentRateDifferential: number;
    rateDifferential30dChange: number;
    policyScore?: number;
    rateRegime: 'WIDENING_USD_ADVANTAGE' | 'COMPRESSING_EUR_RELIEF' | 'STABLE_SPREAD';
  };
  rawMetrics: {
    us2y: number;
    de2y: number;
    us10y: number;
    de10y: number;
    brent: number;
    vix: number;
  };
  realYields?: {
    us10yTips: number;
    us10yBreakeven: number;
    rollingZScore?: number;
  };
  energy?: {
    brent: number;
    dutchTtfGas: number;
  };
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  date?: string;
  sentiment: 'USD_BULLISH' | 'EUR_BULLISH' | 'NEUTRAL';
  score: number; // -1.0 (USD) to +1.0 (EUR)
  snippet: string;
}

export interface CalendarEvent {
  title: string;
  country: 'USD' | 'EUR';
  impact: 'High' | 'Medium' | 'Low';
  date: string;
  forecast?: string;
  previous?: string;
  hoursUntil: number;
}

export interface NewsAndCalendarResult {
  score: number; // -100 to +100
  bias: 'USD_BULLISH' | 'EUR_BULLISH' | 'NEUTRAL';
  headlines: NewsItem[];
  calendarEvents: CalendarEvent[];
  upcomingHighImpact: CalendarEvent[];
  eventRiskActive: boolean;
  eventRiskReason?: string;
}

export interface CotPositioningMetrics {
  reportDate: string;
  nonCommercialLong: number;
  nonCommercialShort: number;
  netPosition: number;
  netPosition4wChange: number;
  openInterest: number;
  netPctOfOpenInterest: number;
  cotIndex52w: number;          // 0 to 100 percentile over 52 weeks
  minNet52w: number;
  maxNet52w: number;
  isCrowdedLong: boolean;       // cotIndex52w > 80
  isCrowdedShort: boolean;      // cotIndex52w < 20
  isFlowDecelerating: boolean;  // 4w change diverging from prevailing trend
  sizingMultiplier: number;     // 1.0 (normal) or 0.70 (crowded trend haircut)
  regime: 'EXTREME_DIVERGENCE_REVERSAL' | 'BULLISH_FLOW_ACCELERATION' | 'BEARISH_FLOW_ACCELERATION' | 'TREND_CONTINUATION_CROWDED' | 'NEUTRAL';
}

export interface PositioningLayerResult {
  score: number;                // -100 to +100
  status: string;
  metrics: CotPositioningMetrics;
  rationale: string;
}

export interface TechnicalLayerResult {
  score: number;                // -100 to +100
  currentPrice: number;
  weeklyTrend: 'WEEKLY_BULLISH' | 'WEEKLY_BEARISH' | 'WEEKLY_NEUTRAL';
  sma20w: number;
  sma20: number;
  sma20SlopePips: number;
  sma50: number;
  sma200: number;
  rsiWilder: number;
  rsiScore: number;
  rsiExhaustionState: 'NORMAL' | 'OVERSOLD_EXHAUSTION' | 'OVERBOUGHT_EXHAUSTION';
  atrPips: number;
  localSwingHigh5d: number;     // Local 5-day high (tight invalidation anchor)
  localSwingLow5d: number;      // Local 5-day low (tight invalidation anchor)
  swingHigh20: number;          // 20-day high (major structure)
  swingLow20: number;           // 20-day low (major structure)
  channelMid: number;
  breakoutState: 'BULLISH_BREAKOUT_5D' | 'BEARISH_BREAKOUT_5D' | 'INSIDE_RANGE';
}

export type DirectionalBias = 'BULLISH_EUR' | 'BEARISH_EUR' | 'NEUTRAL_PARITY';
export type ConvictionLevel = 'STRONG' | 'MODERATE' | 'LOW' | 'STAND_ASIDE';

export interface StructuralReferenceLevels {
  currentPrice: number;
  localResistance5d: number;
  localSupport5d: number;
  rangeHigh20d: number;
  rangeLow20d: number;
  channelMid: number;
  dailyAtrPips: number;
  volatilityState: 'NORMAL' | 'ELEVATED' | 'COMPRESSED';
}

export interface DirectionalRegimeOutlook {
  regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL_RANGE';
  directionalBias: DirectionalBias;
  conviction: ConvictionLevel;
  action: string;
  compositeScore: number;
  rateRegimeFlag: string;
  positioningRegimeFlag: string;
  vetoTriggered?: boolean;
  vetoReason?: string;
  eventRiskActive?: boolean;
  eventRiskReason?: string;

  // Cross-Pillar Narrative Synthesis
  executiveThesis: string;
  macroPillarSummary: string;
  positioningPillarSummary: string;
  newsPillarSummary: string;
  conflictDiagnosis?: string;

  // Structural Reference Framework (Purely contextual, NO rigid signals)
  referenceLevels: StructuralReferenceLevels;

  // Conditional Scenarios & Invalidation
  thesisConfirmationTriggers: string[];
  thesisInvalidationTriggers: string[];
  tacticalPlaybook: string;

  // Optional legacy fields for backwards compatibility
  entryType?: string;
  entryZone?: string;
  entryMid?: number;
  stopLossPrice?: number;
  stopDistancePips?: number;
  target1Price?: number;
  target1Pips?: number;
  target1RR?: string;
  target2Price?: number;
  target2Pips?: number;
  target2RR?: string;
  dailyAtrPips?: number;
  holdingHorizon?: string;
  sizing?: any;
}

// Backwards compatibility alias
export type TradePlan = DirectionalRegimeOutlook;

export interface SystemAuditReport {
  timestamp: string;
  config: SystemConfig;
  status: 'SUCCESS' | 'CRITICAL_DATA_FAILURE';
  sourceHealth: DataSourceHealth[];
  compositeScore: number;
  verdict: string;
  weightsApplied: { macro: number; positioning: number; news?: number; technical: number };
  layers: {
    macro?: MacroLayerResult;
    positioning?: PositioningLayerResult;
    news?: NewsAndCalendarResult;
    technical?: TechnicalLayerResult;
  };
  regimeOutlook?: DirectionalRegimeOutlook;
  tradePlan?: DirectionalRegimeOutlook; // alias for backwards compatibility
  abortReason?: string;
}
