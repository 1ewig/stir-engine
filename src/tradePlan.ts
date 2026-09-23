import {
  MacroLayerResult,
  TechnicalLayerResult,
  TradePlan,
  SystemConfig,
  DEFAULT_CONFIG
} from './types';

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
    const rawStopDistance = Math.round((stopLossPrice - entryMid) * 10000);
    const stopDistancePips = Math.max(15, isFinite(rawStopDistance) && rawStopDistance > 0 ? rawStopDistance : 50);

    const target1Price = parseFloat((entryMid - (stopDistancePips * 0.0001 * 1.5)).toFixed(4));
    const target1Pips = Math.round((entryMid - target1Price) * 10000);

    const target2Price = parseFloat((entryMid - (stopDistancePips * 0.0001 * 2.5)).toFixed(4));
    const target2Pips = Math.round((entryMid - target2Price) * 10000);

    let recommendedLots = 0;
    if (stopDistancePips > 0 && isFinite(stopDistancePips)) {
      const calculatedLots = dollarRisk / (stopDistancePips * pipValue);
      recommendedLots = isFinite(calculatedLots) ? parseFloat(calculatedLots.toFixed(2)) : 0;
    }

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
    const rawStopDistance = Math.round((entryMid - stopLossPrice) * 10000);
    const stopDistancePips = Math.max(15, isFinite(rawStopDistance) && rawStopDistance > 0 ? rawStopDistance : 50);

    const target1Price = parseFloat((entryMid + (stopDistancePips * 0.0001 * 1.5)).toFixed(4));
    const target1Pips = Math.round((target1Price - entryMid) * 10000);

    const target2Price = parseFloat((entryMid + (stopDistancePips * 0.0001 * 2.5)).toFixed(4));
    const target2Pips = Math.round((target2Price - entryMid) * 10000);

    let recommendedLots = 0;
    if (stopDistancePips > 0 && isFinite(stopDistancePips)) {
      const calculatedLots = dollarRisk / (stopDistancePips * pipValue);
      recommendedLots = isFinite(calculatedLots) ? parseFloat(calculatedLots.toFixed(2)) : 0;
    }

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
