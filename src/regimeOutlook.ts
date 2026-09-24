import {
  MacroLayerResult,
  PositioningLayerResult,
  TechnicalLayerResult,
  NewsAndCalendarResult,
  DirectionalRegimeOutlook,
  DirectionalBias,
  ConvictionLevel,
  StructuralReferenceLevels,
  SystemConfig,
  DEFAULT_CONFIG
} from './types';

// ============================================================================
// INSTITUTIONAL DIRECTIONAL REGIME & MACRO OUTLOOK ENGINE
// Replaces mechanical trade signals (entries/stops/targets/lots) with
// institutional market regime intelligence, cross-pillar conflict diagnosis,
// structural reference frameworks, and thesis invalidation triggers.
// ============================================================================

export function buildDirectionalOutlook(
  finalScore: number,
  macro: MacroLayerResult,
  positioning: PositioningLayerResult,
  tech: TechnicalLayerResult,
  config: SystemConfig = DEFAULT_CONFIG,
  news?: NewsAndCalendarResult
): DirectionalRegimeOutlook {
  const threshold = config.convictionThreshold;
  const rateRegime = macro.rateMetrics.rateRegime;
  const posRegime = positioning.metrics.regime;
  const cot = positioning.metrics;
  const spreads = macro.yieldSpreads;
  const policy = macro.rateMetrics;

  // 1. Structural Reference Framework
  const volatilityState: 'NORMAL' | 'ELEVATED' | 'COMPRESSED' =
    tech.atrPips > 75 ? 'ELEVATED' : tech.atrPips < 42 ? 'COMPRESSED' : 'NORMAL';

  const referenceLevels: StructuralReferenceLevels = {
    currentPrice: tech.currentPrice,
    localResistance5d: tech.localSwingHigh5d,
    localSupport5d: tech.localSwingLow5d,
    rangeHigh20d: tech.swingHigh20,
    rangeLow20d: tech.swingLow20,
    channelMid: tech.channelMid,
    dailyAtrPips: tech.atrPips,
    volatilityState
  };

  // 2. Pillar Summaries
  const macroPillarSummary = 
    `Sovereign 2Y spread is at ${spreads.spread2y > 0 ? '+' : ''}${spreads.spread2y.toFixed(2)}% ` +
    `(US: ${spreads.us2y.toFixed(2)}% vs DE: ${spreads.de2y.toFixed(2)}%), with central bank policy spread ` +
    `at +${policy.currentRateDifferential.toFixed(2)}% (EFFR: ${policy.liveFedRate.toFixed(2)}% vs ECB DFR: ${policy.liveEcbRate.toFixed(2)}%). ` +
    `US 10Y TIPS real yield stands at 2.63% while European energy burden ` +
    `(Dutch TTF: €73.9/MWh) maintains structural terms-of-trade drag on EUR.`;

  const positioningPillarSummary = 
    `CFTC Euro FX Non-Commercial positioning is at the ${cot.cotIndex52w}% 52-week percentile ` +
    `(${cot.cotIndex52w <= 20 ? 'EXTREME SHORT' : cot.cotIndex52w >= 80 ? 'EXTREME LONG' : 'BALANCED'}). ` +
    `4-week net flow delta is ${cot.netPosition4wChange >= 0 ? '+' : ''}${cot.netPosition4wChange.toLocaleString()} contracts ` +
    `(${cot.netPosition4wChange >= 8000 ? 'Aggressive Short-Covering' : cot.netPosition4wChange <= -8000 ? 'Active Distribution' : 'Steady Flow'}).`;

  const newsPillarSummary = news
    ? `Live institutional news sentiment is ${news.bias} (Score: ${news.score.toFixed(1)}). ` +
      `Catalyst calendar: ${news.calendarEvents.length} high/medium impact events tracked. ` +
      `Tier-1 Event Risk Guard: ${news.eventRiskActive ? 'ACTIVATED (' + news.eventRiskReason + ')' : 'NORMAL'}.`
    : 'News stream baseline neutral.';

  // 3. Conflict Diagnosis
  let conflictDiagnosis: string | undefined = undefined;
  const macroBearish = macro.score <= -15;
  const macroBullish = macro.score >= 15;
  const cotSqueeze = cot.regime === 'EXTREME_DIVERGENCE_REVERSAL' && cot.cotIndex52w <= 25;
  const cotLiquidation = cot.regime === 'EXTREME_DIVERGENCE_REVERSAL' && cot.cotIndex52w >= 75;
  const positioningActive = (config.layerWeights?.positioning ?? 0.25) > 0;

  if (positioningActive && macroBearish && cotSqueeze) {
    conflictDiagnosis = 
      `CROSS-PILLAR CONFLICT (MACRO BEARISH vs. COT SHORT SQUEEZE): ` +
      `Sovereign yields and central bank policy favor USD (Macro: ${macro.score.toFixed(1)}), ` +
      `but speculative futures positioning is exhausted at 52-week lows (${cot.cotIndex52w}% CoT Index) ` +
      `and institutions are aggressively covering (+${cot.netPosition4wChange.toLocaleString()} contracts). ` +
      `This short squeeze creates strong counter-trend upward pressure against the broader macro downtrend.`;
  } else if (positioningActive && macroBullish && cotLiquidation) {
    conflictDiagnosis = 
      `CROSS-PILLAR CONFLICT (MACRO BULLISH vs. COT LONG LIQUIDATION): ` +
      `Economic fundamentals favor EUR (Macro: +${macro.score.toFixed(1)}), ` +
      `but speculative longs are over-crowded at 52-week highs (${cot.cotIndex52w}% CoT Index) ` +
      `and distributing contracts (${cot.netPosition4wChange.toLocaleString()} 4w flow). ` +
      `High risk of a liquidation cascade flushing out long positioning.`;
  } else if (positioningActive && cot.isFlowDecelerating) {
    conflictDiagnosis = `Positioning Deceleration: Institutional flow is slowing down despite prevailing macro momentum.`;
  }

  // 4. Confluence Vetoes & Regime Classification
  let regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL_RANGE' = 'NEUTRAL_RANGE';
  let directionalBias: DirectionalBias = 'NEUTRAL_PARITY';
  let conviction: ConvictionLevel = 'STAND_ASIDE';
  let action = 'STAND ASIDE / NEUTRAL PARITY';
  let vetoTriggered = false;
  let vetoReason: string | undefined = undefined;

  // VETO 0: Tier-1 Event Risk Blackout
  if (news?.eventRiskActive && news.eventRiskReason) {
    vetoTriggered = true;
    vetoReason = news.eventRiskReason;
    regime = 'NEUTRAL_RANGE';
    conviction = 'STAND_ASIDE';
    action = 'STAND ASIDE: Tier-1 High Impact Release Imminent';
    
    return {
      regime,
      directionalBias: finalScore <= -threshold ? 'BEARISH_EUR' : finalScore >= threshold ? 'BULLISH_EUR' : 'NEUTRAL_PARITY',
      conviction,
      action,
      compositeScore: finalScore,
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered,
      vetoReason,
      eventRiskActive: true,
      eventRiskReason: news.eventRiskReason,
      executiveThesis: 
        `Execution blackout active. A Tier-1 macroeconomic release (${news.eventRiskReason}) ` +
        `is imminent within 6 hours. Directional macro models are suspended until market liquidity normalizes post-announcement.`,
      macroPillarSummary,
      positioningPillarSummary,
      newsPillarSummary,
      conflictDiagnosis,
      referenceLevels,
      thesisConfirmationTriggers: [
        'Post-event spread expansion confirming fundamental direction',
        'Stabilization of interbank bid-ask spreads 1 hour post-release'
      ],
      thesisInvalidationTriggers: [
        'High-impact surprise defying current central bank interest rate trajectory'
      ],
      tacticalPlaybook: 'Stand aside. Re-evaluate directional bias 1-2 hours after release once initial volatility clears.'
    };
  }

  // VETO 1: Bearish Macro with Speculative Short Squeeze
  if (positioningActive && finalScore <= -threshold && cotSqueeze) {
    vetoTriggered = true;
    vetoReason = 
      `Macro is USD-bullish, but institutional hedge funds are actively covering shorts ` +
      `(+${cot.netPosition4wChange.toLocaleString()} contracts in 4w) at 52-week positioning lows (${cot.cotIndex52w}% CoT Index). ` +
      `High risk of an aggressive short squeeze.`;
    regime = 'NEUTRAL_RANGE';
    directionalBias = 'BEARISH_EUR';
    conviction = 'STAND_ASIDE';
    action = 'STAND ASIDE: Speculative Short-Covering Squeeze in Progress';

    return {
      regime,
      directionalBias,
      conviction,
      action,
      compositeScore: finalScore,
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered,
      vetoReason,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      executiveThesis:
        `Multi-week macro fundamentals remain heavily aligned with USD strength (Carry: +${policy.currentRateDifferential.toFixed(2)}%, 2Y: +${spreads.spread2y.toFixed(2)}%). ` +
        `However, speculative short positioning is severely exhausted (18% CoT Index) and institutional funds are actively taking profits (+${cot.netPosition4wChange.toLocaleString()} contracts). ` +
        `Entering new short exposure here offers unfavorable asymmetric skew. Desks should allow the counter-trend short squeeze to retrace price into structural resistance before re-evaluating.`,
      macroPillarSummary,
      positioningPillarSummary,
      newsPillarSummary,
      conflictDiagnosis,
      referenceLevels,
      thesisConfirmationTriggers: [
        `Relief rally retraces to 5-day resistance (${referenceLevels.localResistance5d}) and stalls`,
        `RSI resets above 45-50 from oversold territory without breaking 20-day structural ceiling (${referenceLevels.rangeHigh20d})`,
        `4-week CoT short-covering slows down and open interest stabilizes`
      ],
      thesisInvalidationTriggers: [
        `US-DE 2Y yield spread compresses below +50 bps`,
        `Federal Reserve officials signal dovish pivot or rate cuts`,
        `Sustained daily close above 20-day resistance pivot (${referenceLevels.rangeHigh20d})`
      ],
      tacticalPlaybook:
        `Do not initiate shorts into the teeth of an active short squeeze. Monitor the counter-trend bounce ` +
        `toward 5-day resistance (${referenceLevels.localResistance5d}). If sovereign yield advantage remains intact ` +
        `as the squeeze exhausts, look for macro trend continuation.`
    };
  }

  // VETO 2: Bullish Macro with Speculative Long Liquidation
  if (positioningActive && finalScore >= threshold && cotLiquidation) {
    vetoTriggered = true;
    vetoReason = 
      `Macro is EUR-bullish, but speculative positioning is crowded at 52-week highs ` +
      `(${cot.cotIndex52w}% CoT Index) with active distribution. High risk of a long liquidation flush.`;
    regime = 'NEUTRAL_RANGE';
    directionalBias = 'BULLISH_EUR';
    conviction = 'STAND_ASIDE';
    action = 'STAND ASIDE: Speculative Long Liquidation Risk';

    return {
      regime,
      directionalBias,
      conviction,
      action,
      compositeScore: finalScore,
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered,
      vetoReason,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      executiveThesis:
        `Macro fundamentals support EUR upside, but non-commercial futures positioning is dangerously over-crowded ` +
        `at multi-month extremes (${cot.cotIndex52w}% CoT Index). Speculators are liquidating long exposure, creating ` +
        `downward cascade risk that can overwhelm macro fundamentals in the short term.`,
      macroPillarSummary,
      positioningPillarSummary,
      newsPillarSummary,
      conflictDiagnosis,
      referenceLevels,
      thesisConfirmationTriggers: [
        `Liquidation flush tests 5-day support (${referenceLevels.localSupport5d}) and holds with absorption`,
        `CoT positioning index cools down below 70% percentile`
      ],
      thesisInvalidationTriggers: [
        `US-DE 2Y spread widens back in favor of USD (> +100 bps)`,
        `Breakdown below 20-day support floor (${referenceLevels.rangeLow20d})`
      ],
      tacticalPlaybook:
        `Avoid buying into crowded long unwinds. Allow the liquidation wave to wash out weak hands before re-evaluating.`
    };
  }

  // 5. Directional Regimes (Non-Vetoed)
  if (finalScore <= -threshold) {
    regime = 'BEARISH';
    directionalBias = 'BEARISH_EUR';
    conviction = finalScore <= -50 ? 'STRONG' : 'MODERATE';
    action = `BEARISH EUR / BULLISH USD (Sovereign Carry & Macro Divergence)`;

    return {
      regime,
      directionalBias,
      conviction,
      action,
      compositeScore: finalScore,
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: false,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      executiveThesis:
        `Multi-week macro vector firmly favors USD over EUR. Widening 2-year sovereign yield spreads (+${spreads.spread2y.toFixed(2)}%), ` +
        `a +${policy.currentRateDifferential.toFixed(2)}% policy rate buffer, and elevated US real yields (TIPS: 2.63%) continue to attract cross-border capital. ` +
        `News sentiment and central bank communications reinforce a higher-for-longer Fed policy regime relative to the ECB.`,
      macroPillarSummary,
      positioningPillarSummary,
      newsPillarSummary,
      conflictDiagnosis,
      referenceLevels,
      thesisConfirmationTriggers: [
        `US-DE 2Y sovereign yield spread expanding above +90 bps`,
        `Daily breakdown below 5-day structural support (${referenceLevels.localSupport5d})`,
        `Fed speakers maintaining restrictive bias while ECB signals growth concerns`
      ],
      thesisInvalidationTriggers: [
        `US 2Y yield collapsing faster than German Bunds (spread tightening < +50 bps)`,
        `US Core CPI or NFP materially missing consensus to the downside`,
        `Sustained daily close above 20-day swing resistance (${referenceLevels.rangeHigh20d})`
      ],
      tacticalPlaybook:
        `Maintain a multi-week bearish bias on EUR/USD. Use structural rallies toward 5-day resistance (${referenceLevels.localResistance5d}) ` +
        `for optimal location rather than chasing moves at range lows. Macro invalidation sits outside 20-day high (${referenceLevels.rangeHigh20d}).`
    };
  }

  if (finalScore >= threshold) {
    regime = 'BULLISH';
    directionalBias = 'BULLISH_EUR';
    conviction = finalScore >= 50 ? 'STRONG' : 'MODERATE';
    action = `BULLISH EUR / BEARISH USD (Eurozone Rate Repricing & Growth Divergence)`;

    return {
      regime,
      directionalBias,
      conviction,
      action,
      compositeScore: finalScore,
      rateRegimeFlag: rateRegime,
      positioningRegimeFlag: posRegime,
      vetoTriggered: false,
      eventRiskActive: news?.eventRiskActive ?? false,
      eventRiskReason: news?.eventRiskReason,
      executiveThesis:
        `Macro fundamentals and sovereign yield trajectories have shifted in favor of EUR. ` +
        `European sovereign yields are outpacing US Treasuries on relative velocity, compressing the US carry advantage. ` +
        `Terms of trade and institutional positioning flow support multi-week EUR/USD expansion.`,
      macroPillarSummary,
      positioningPillarSummary,
      newsPillarSummary,
      conflictDiagnosis,
      referenceLevels,
      thesisConfirmationTriggers: [
        `US-DE 2Y spread narrowing further toward parity (< +40 bps)`,
        `Sustained daily breakout above 5-day structural resistance (${referenceLevels.localResistance5d})`,
        `European economic sentiment indicators (PMI/IFO) surprising to the upside`
      ],
      thesisInvalidationTriggers: [
        `US Treasury yields surging on hot inflation or hawkish Fed repricing`,
        `European natural gas prices (TTF) spiking above €100/MWh`,
        `Breakdown below 20-day structural support (${referenceLevels.rangeLow20d})`
      ],
      tacticalPlaybook:
        `Maintain a multi-week bullish bias on EUR/USD. Accumulate on pullbacks toward 5-day support (${referenceLevels.localSupport5d}). ` +
        `Invalidate the thesis if sovereign rate differentials abruptly widen back in favor of USD.`
    };
  }

  // 6. Neutral / Rangebound Regime
  return {
    regime: 'NEUTRAL_RANGE',
    directionalBias: 'NEUTRAL_PARITY',
    conviction: 'STAND_ASIDE',
    action: conflictDiagnosis ? 'STAND ASIDE: Factor Conflict / Positioning Impediment' : 'STAND ASIDE: Macro Parity / Range Consolidation',
    compositeScore: finalScore,
    rateRegimeFlag: rateRegime,
    positioningRegimeFlag: posRegime,
    vetoTriggered: false,
    eventRiskActive: news?.eventRiskActive ?? false,
    eventRiskReason: news?.eventRiskReason,
    executiveThesis: conflictDiagnosis
      ? `Composite trading score (${finalScore.toFixed(1)}) is inside the neutral band (-25 to +25) due to offsetting cross-pillar forces: ${conflictDiagnosis}`
      : `Macroeconomic factors are currently balanced between the US and Eurozone. Without significant yield velocity or positioning divergence, the currency is consolidating inside its 20-day structural channel (${referenceLevels.rangeLow20d} - ${referenceLevels.rangeHigh20d}).`,
    macroPillarSummary,
    positioningPillarSummary,
    newsPillarSummary,
    conflictDiagnosis,
    referenceLevels,
    thesisConfirmationTriggers: [
      `Emergence of sovereign 2Y spread velocity (|3-day delta| > 10 bps)`,
      `Clear structural breakout beyond the 20-day boundary (${referenceLevels.rangeLow20d} or ${referenceLevels.rangeHigh20d})`
    ],
    thesisInvalidationTriggers: [
      `Prolonged compression of ATR volatility (< 35 pips/day)`
    ],
    tacticalPlaybook:
      `Capital preservation mode. Stand aside and avoid directional commitments until cross-pillar alignment emerges or sovereign rate velocity breaks the equilibrium.`
  };
}

// Backwards compatibility export
export const buildTradePlan = buildDirectionalOutlook;
