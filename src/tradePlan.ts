import {
  MacroLayerResult,
  PositioningLayerResult,
  TechnicalLayerResult,
  NewsAndCalendarResult,
  TradePlan,
  SystemConfig,
  DEFAULT_CONFIG
} from './types';

// ============================================================================
// ASYMMETRIC INSTITUTIONAL SWING TRADE PLAN GENERATOR
// Resolves Stop Clipping: Stop loss is STRICTLY anchored outside the 5-day structure.
// Resolves Factor Smearing: Implements hard Confluence Veto Gate against flow squeezes.
// Protects Against Event Risk: Vetoes entries immediately prior to Tier-1 releases.
// ============================================================================

export function buildTradePlan(
  finalScore: number,
  macro: MacroLayerResult,
  positioning: PositioningLayerResult,
  tech: TechnicalLayerResult,
  config: SystemConfig = DEFAULT_CONFIG,
  news?: NewsAndCalendarResult
): TradePlan {
  const equity = config.accountEquity;
  const riskPct = config.maxRiskPerTradePct;
  const dollarRisk = equity * riskPct;
  const pipValue = 10.0; // standard lot 100k pip value in USD

  const rateRegime = macro.rateMetrics.rateRegime;
  const posRegime = positioning.metrics.regime;
  const sizingMult = positioning.metrics.sizingMultiplier;

  // ==========================================================================
  // CONFLUENCE VETO GATE: PREVENTS TRADING INTO ADVERSE SQUEEZES & EVENT RISK
  // ==========================================================================

  // VETO 0: Imminent Tier-1 Economic Calendar Event Risk (< 6h window)
  if (news?.eventRiskActive && news.eventRiskReason) {
    return {
      regime: 'NEUTRAL_RANGE',
      action: 'STAND ASIDE (TIER_1_EVENT_RISK_GUARD)',
      conviction: 'STAND_ASIDE',
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: true,
      vetoReason: news.eventRiskReason,
      eventRiskActive: true,
      eventRiskReason: news.eventRiskReason,
      entryType: 'STAND_ASIDE',
      entryZone: `Event Blackout Window. Local Price: ${tech.currentPrice}`,
      entryMid: tech.currentPrice,
      stopLossPrice: 0,
      stopDistancePips: 0,
      target1Price: 0,
      target1Pips: 0,
      target1RR: 'N/A',
      target2Price: 0,
      target2Pips: 0,
      target2RR: 'N/A',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: 'Stand aside until high-impact release passes and liquidity normalizes',
      sizing: {
        accountEquity: equity,
        riskPercentage: 0,
        dollarRisk: 0,
        stopDistancePips: 0,
        pipValuePerLot: pipValue,
        sizingMultiplier: 1.0,
        effectiveLots: 0,
        recommendedLots: 0,
        miniLots: 0
      }
    };
  }

  const positioningActive = (config.layerWeights?.positioning ?? 0.25) > 0;

  // VETO 1: Macro is Bearish, but CoT flags Bullish Short Squeeze Divergence
  if (positioningActive && finalScore <= -config.convictionThreshold && positioning.metrics.regime === 'EXTREME_DIVERGENCE_REVERSAL') {
    return {
      regime: 'NEUTRAL_RANGE',
      action: 'STAND ASIDE (FLOW_DIVERGENCE_SQUEEZE_VETO)',
      conviction: 'STAND_ASIDE',
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: true,
      vetoReason: `Macro is USD-bullish, but institutional hedge funds are actively covering shorts (+${positioning.metrics.netPosition4wChange.toLocaleString()} contracts in 4w) at 52-week positioning lows (${positioning.metrics.cotIndex52w}% CoT Index). High risk of an aggressive short squeeze; trend-following shorts prohibited.`,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      entryType: 'STAND_ASIDE',
      entryZone: `Local Support: ${tech.localSwingLow5d} | Resistance Pivot: ${tech.localSwingHigh5d}`,
      entryMid: tech.currentPrice,
      stopLossPrice: 0,
      stopDistancePips: 0,
      target1Price: 0,
      target1Pips: 0,
      target1RR: 'N/A',
      target2Price: 0,
      target2Pips: 0,
      target2RR: 'N/A',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: 'Stand aside until short-covering accumulation pressure subsides',
      sizing: {
        accountEquity: equity,
        riskPercentage: 0,
        dollarRisk: 0,
        stopDistancePips: 0,
        pipValuePerLot: pipValue,
        sizingMultiplier: 1.0,
        effectiveLots: 0,
        recommendedLots: 0,
        miniLots: 0
      }
    };
  }

  // VETO 2: Macro is Bullish, but CoT flags Bearish Long Liquidation Divergence
  if (positioningActive && finalScore >= config.convictionThreshold && positioning.metrics.regime === 'EXTREME_DIVERGENCE_REVERSAL') {
    return {
      regime: 'NEUTRAL_RANGE',
      action: 'STAND ASIDE (FLOW_DIVERGENCE_LIQUIDATION_VETO)',
      conviction: 'STAND_ASIDE',
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: true,
      vetoReason: `Macro is EUR-bullish, but institutional hedge funds are actively liquidating longs (${positioning.metrics.netPosition4wChange.toLocaleString()} contracts in 4w) at 52-week positioning highs (${positioning.metrics.cotIndex52w}% CoT Index). High risk of a liquidation cascade; trend-following longs prohibited.`,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      entryType: 'STAND_ASIDE',
      entryZone: `Local Support: ${tech.localSwingLow5d} | Resistance Pivot: ${tech.localSwingHigh5d}`,
      entryMid: tech.currentPrice,
      stopLossPrice: 0,
      stopDistancePips: 0,
      target1Price: 0,
      target1Pips: 0,
      target1RR: 'N/A',
      target2Price: 0,
      target2Pips: 0,
      target2RR: 'N/A',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: 'Stand aside until long-liquidation pressure subsides',
      sizing: {
        accountEquity: equity,
        riskPercentage: 0,
        dollarRisk: 0,
        stopDistancePips: 0,
        pipValuePerLot: pipValue,
        sizingMultiplier: 1.0,
        effectiveLots: 0,
        recommendedLots: 0,
        miniLots: 0
      }
    };
  }

  // ==========================================================================
  // 1. BEARISH REGIME (Score <= -Threshold) -> USD Advantage / EUR Weakness
  // ==========================================================================
  if (finalScore <= -config.convictionThreshold) {
    const isExhausted = tech.rsiExhaustionState === 'OVERSOLD_EXHAUSTION';
    const isBreakout = tech.breakoutState === 'BEARISH_BREAKOUT_5D';

    // True structural stop loss is strictly placed OUTSIDE the 5-day swing structure
    // Never clamped below the 5-day high!
    const trueStopLossPrice = parseFloat((tech.localSwingHigh5d + (tech.atrPips * 0.0001 * 0.35)).toFixed(4));
    const distFromCurrent = Math.round((trueStopLossPrice - tech.currentPrice) * 10000);

    let entryMid: number;
    let entryZone: string;
    let entryType: 'LOCAL_BREAKOUT_CONFIRMATION' | 'MICRO_PULLBACK_RETEST' = 'MICRO_PULLBACK_RETEST';
    let action = 'SELL EUR/USD (Short on Local Invalidation)';

    // Location Guard: If price is > 80 pips away from the structural pivot,
    // selling here has adverse location (selling at the bottom of the range).
    // Demand a Limit Order Retracement closer to resistance so the true stop is 50-65 pips away!
    if (distFromCurrent > 80 || isExhausted) {
      // Optimal entry is placed 55-65 pips below the true structural stop
      const targetRiskPips = Math.min(65, Math.max(50, Math.round(tech.atrPips * 1.1)));
      entryMid = parseFloat((trueStopLossPrice - (targetRiskPips * 0.0001)).toFixed(4));
      entryZone = `${parseFloat((entryMid - 0.0015).toFixed(4))} - ${parseFloat((entryMid + 0.0015).toFixed(4))} (Limit entry on pullback closer to 5d resistance)`;
      action = 'SELL EUR/USD (Limit Order on Retracement to Value)';
      entryType = 'MICRO_PULLBACK_RETEST';
    } else if (isBreakout && !isExhausted) {
      entryMid = tech.currentPrice;
      entryZone = `${parseFloat((tech.currentPrice - 0.0010).toFixed(4))} - ${parseFloat((tech.currentPrice + 0.0010).toFixed(4))} (Immediate 5-day breakdown execution)`;
      entryType = 'LOCAL_BREAKOUT_CONFIRMATION';
      action = 'SELL EUR/USD (Short on 5-Day Breakdown Confirmation)';
    } else {
      const microOffset = Math.min(0.0025, tech.atrPips * 0.0001 * 0.4);
      entryMid = parseFloat((tech.currentPrice + microOffset).toFixed(4));
      entryZone = `${tech.currentPrice} - ${entryMid} (Micro 2-day pullback into resistance)`;
      action = 'SELL EUR/USD (Short on Micro Pullback)';
    }

    const stopLossPrice = trueStopLossPrice;
    const stopDistancePips = Math.round((stopLossPrice - entryMid) * 10000);

    // Multi-Week Asymmetric Targets:
    // TP1 = 2.0R (~100 to 130 pips) -> de-risk and lock profits
    // TP2 = 4.0R (~200 to 260 pips) -> capture full multi-week swing expansion
    const target1Pips = Math.round(stopDistancePips * 2.0);
    const target1Price = parseFloat((entryMid - (target1Pips * 0.0001)).toFixed(4));

    const target2Pips = Math.round(stopDistancePips * 4.0);
    const target2Price = parseFloat((entryMid - (target2Pips * 0.0001)).toFixed(4));

    // Position Sizing: Dollar risk remains locked at exactly $500 (1%)
    const baseLots = parseFloat((dollarRisk / (stopDistancePips * pipValue)).toFixed(2));
    const effectiveLots = parseFloat((baseLots * sizingMult).toFixed(2));

    return {
      regime: 'BEARISH',
      action,
      conviction: finalScore <= -50 ? 'STRONG' : 'MODERATE',
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: false,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      entryType,
      entryZone,
      entryMid,
      stopLossPrice,
      stopDistancePips,
      target1Price,
      target1Pips,
      target1RR: '1 : 2.0',
      target2Price,
      target2Pips,
      target2RR: '1 : 4.0',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: '10 to 25 trading days (Multi-Week Swing Leg)',
      sizing: {
        accountEquity: equity,
        riskPercentage: riskPct * 100,
        dollarRisk,
        stopDistancePips,
        pipValuePerLot: pipValue,
        sizingMultiplier: sizingMult,
        effectiveLots,
        recommendedLots: baseLots,
        miniLots: Math.round(effectiveLots * 10)
      }
    };
  }

  // ==========================================================================
  // 2. BULLISH REGIME (Score >= +Threshold) -> EUR Advantage / USD Weakness
  // ==========================================================================
  if (finalScore >= config.convictionThreshold) {
    const isExhausted = tech.rsiExhaustionState === 'OVERBOUGHT_EXHAUSTION';
    const isBreakout = tech.breakoutState === 'BULLISH_BREAKOUT_5D';

    // True structural stop loss is strictly placed OUTSIDE the 5-day swing structure
    // Never clamped above the 5-day low!
    const trueStopLossPrice = parseFloat((tech.localSwingLow5d - (tech.atrPips * 0.0001 * 0.35)).toFixed(4));
    const distFromCurrent = Math.round((tech.currentPrice - trueStopLossPrice) * 10000);

    let entryMid: number;
    let entryZone: string;
    let entryType: 'LOCAL_BREAKOUT_CONFIRMATION' | 'MICRO_PULLBACK_RETEST' = 'MICRO_PULLBACK_RETEST';
    let action = 'BUY EUR/USD (Long on Local Invalidation)';

    if (distFromCurrent > 80 || isExhausted) {
      const targetRiskPips = Math.min(65, Math.max(50, Math.round(tech.atrPips * 1.1)));
      entryMid = parseFloat((trueStopLossPrice + (targetRiskPips * 0.0001)).toFixed(4));
      entryZone = `${parseFloat((entryMid - 0.0015).toFixed(4))} - ${parseFloat((entryMid + 0.0015).toFixed(4))} (Limit entry on pullback closer to 5d support)`;
      action = 'BUY EUR/USD (Limit Order on Retracement to Value)';
      entryType = 'MICRO_PULLBACK_RETEST';
    } else if (isBreakout && !isExhausted) {
      entryMid = tech.currentPrice;
      entryZone = `${parseFloat((tech.currentPrice - 0.0010).toFixed(4))} - ${parseFloat((tech.currentPrice + 0.0010).toFixed(4))} (Immediate 5-day breakout execution)`;
      entryType = 'LOCAL_BREAKOUT_CONFIRMATION';
      action = 'BUY EUR/USD (Long on 5-Day Breakout Confirmation)';
    } else {
      const microOffset = Math.min(0.0025, tech.atrPips * 0.0001 * 0.4);
      entryMid = parseFloat((tech.currentPrice - microOffset).toFixed(4));
      entryZone = `${entryMid} - ${tech.currentPrice} (Micro 2-day dip into support)`;
      action = 'BUY EUR/USD (Long on Micro Dip)';
    }

    const stopLossPrice = trueStopLossPrice;
    const stopDistancePips = Math.round((entryMid - stopLossPrice) * 10000);

    const target1Pips = Math.round(stopDistancePips * 2.0);
    const target1Price = parseFloat((entryMid + (target1Pips * 0.0001)).toFixed(4));

    const target2Pips = Math.round(stopDistancePips * 4.0);
    const target2Price = parseFloat((entryMid + (target2Pips * 0.0001)).toFixed(4));

    const baseLots = parseFloat((dollarRisk / (stopDistancePips * pipValue)).toFixed(2));
    const effectiveLots = parseFloat((baseLots * sizingMult).toFixed(2));

    return {
      regime: 'BULLISH',
      action,
      conviction: finalScore >= 50 ? 'STRONG' : 'MODERATE',
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: false,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      entryType,
      entryZone,
      entryMid,
      stopLossPrice,
      stopDistancePips,
      target1Price,
      target1Pips,
      target1RR: '1 : 2.0',
      target2Price,
      target2Pips,
      target2RR: '1 : 4.0',
      dailyAtrPips: tech.atrPips,
      holdingHorizon: '10 to 25 trading days (Multi-Week Swing Leg)',
      sizing: {
        accountEquity: equity,
        riskPercentage: riskPct * 100,
        dollarRisk,
        stopDistancePips,
        pipValuePerLot: pipValue,
        sizingMultiplier: sizingMult,
        effectiveLots,
        recommendedLots: baseLots,
        miniLots: Math.round(effectiveLots * 10)
      }
    };
  }

  // ==========================================================================
  // 3. NEUTRAL / RANGEBOUND REGIME
  // ==========================================================================
  return {
    regime: 'NEUTRAL_RANGE',
    action: 'STAND ASIDE / CAPITAL PRESERVATION',
    conviction: 'STAND_ASIDE',
    rateRegimeFlag: rateRegime,
    positioningRegimeFlag: posRegime,
    vetoTriggered: false,
    eventRiskActive: news?.eventRiskActive ?? false,
    eventRiskReason: news?.eventRiskReason,
    entryType: 'STAND_ASIDE',
    entryZone: `Local 5d Range: [Floor: ${tech.localSwingLow5d} | Ceiling: ${tech.localSwingHigh5d}]`,
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
    holdingHorizon: 'Wait for macro yield divergence or structural breakout',
    sizing: {
      accountEquity: equity,
      riskPercentage: 0,
      dollarRisk: 0,
      stopDistancePips: 0,
      pipValuePerLot: pipValue,
      sizingMultiplier: 1.0,
      effectiveLots: 0,
      recommendedLots: 0,
      miniLots: 0
    }
  };
}
