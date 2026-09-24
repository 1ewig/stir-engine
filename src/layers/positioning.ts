import {
  CotPositioningMetrics,
  PositioningLayerResult
} from '../types';
import {
  fetchCftcEuroPositioning,
  tanhNormalize
} from '../dataProvider';

// ============================================================================
// LAYER 2: INSTITUTIONAL FLOW & DIVERGENCE ENGINE (25% Weight)
// Eliminates knife-edge cliff; detects true divergence vs trend continuation
// ============================================================================

export async function runPositioningEngine(): Promise<PositioningLayerResult> {
  console.log("Analyzing Pillar 2: Institutional Positioning & Flow (CFTC CoT Futures & Squeeze Risk)...");

  const rawRecords = await fetchCftcEuroPositioning();

  // Baseline fallback
  let reportDate = new Date().toISOString().split('T')[0];
  let nonCommLong = 205000;
  let nonCommShort = 225000;
  let openInterest = 750000;
  let netPosition = nonCommLong - nonCommShort; // -20,000
  let net4wAgo = -10000;
  let minNet52w = -85000;
  let maxNet52w = +140000;

  if (Array.isArray(rawRecords) && rawRecords.length > 0) {
    const latest = rawRecords[0];
    reportDate = latest.report_date_as_yyyy_mm_dd?.split('T')[0] || reportDate;
    nonCommLong = parseInt(latest.noncomm_positions_long_all) || nonCommLong;
    nonCommShort = parseInt(latest.noncomm_positions_short_all) || nonCommShort;
    openInterest = parseInt(latest.open_interest_all) || openInterest;
    netPosition = nonCommLong - nonCommShort;

    const netSeries: number[] = [];
    for (const r of rawRecords) {
      const l = parseInt(r.noncomm_positions_long_all);
      const s = parseInt(r.noncomm_positions_short_all);
      if (!isNaN(l) && !isNaN(s)) {
        netSeries.push(l - s);
      }
    }

    if (netSeries.length >= 4) {
      net4wAgo = netSeries[3];
    } else {
      net4wAgo = netPosition;
    }

    if (netSeries.length >= 10) {
      minNet52w = Math.min(...netSeries);
      maxNet52w = Math.max(...netSeries);
    }
  }

  const netPosition4wChange = netPosition - net4wAgo;
  const netPctOfOpenInterest = openInterest > 0 ? parseFloat(((netPosition / openInterest) * 100).toFixed(1)) : 0;

  // 52-Week CoT Index (0 to 100 percentile)
  const range = maxNet52w - minNet52w;
  const cotIndex52w = range > 0
    ? parseFloat(Math.max(0, Math.min(100, ((netPosition - minNet52w) / range) * 100)).toFixed(1))
    : 50.0;

  const isCrowdedLong = cotIndex52w >= 80.0;
  const isCrowdedShort = cotIndex52w <= 20.0;

  let regime: 'EXTREME_DIVERGENCE_REVERSAL' | 'BULLISH_FLOW_ACCELERATION' | 'BEARISH_FLOW_ACCELERATION' | 'TREND_CONTINUATION_CROWDED' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  let sizingMultiplier = 1.0;
  let isFlowDecelerating = false;
  let rationale = "";

  // 1. CROWDED LONG ZONE (Index >= 80%)
  if (isCrowdedLong) {
    if (netPosition4wChange <= -8000) {
      // True Bearish Divergence: Speculators are heavily long, BUT smart money is actively dumping contracts
      isFlowDecelerating = true;
      regime = 'EXTREME_DIVERGENCE_REVERSAL';
      score = -50.0;
      sizingMultiplier = 1.0;
      rationale = `Bearish Positioning Divergence: CoT Index is elevated (${cotIndex52w}%), and 4-week net flow is distributing (${netPosition4wChange.toLocaleString()} contracts). Vulnerable to liquidation.`;
    } else {
      // Trend Continuation with Crowded Positioning: DO NOT FADE!
      // Stay mildly aligned with the prevailing bull trend, but apply a 30% risk haircut
      regime = 'TREND_CONTINUATION_CROWDED';
      score = +20.0;
      sizingMultiplier = 0.70;
      rationale = `Bullish Trend Continuation (Crowded): CoT Index is high (${cotIndex52w}%), but institutional flow remains supportive. Position sizing haircut (0.70x) applied to protect against sudden unwinds.`;
    }
  }
  // 2. CROWDED SHORT ZONE (Index <= 20%)
  else if (isCrowdedShort) {
    if (netPosition4wChange >= +8000) {
      // True Bullish Short Squeeze Divergence: Speculators are heavily short, BUT smart money is actively covering
      isFlowDecelerating = true;
      regime = 'EXTREME_DIVERGENCE_REVERSAL';
      score = +50.0;
      sizingMultiplier = 1.0;
      rationale = `Bullish Short Squeeze Divergence: CoT Index is depressed (${cotIndex52w}%), and 4-week net flow is accumulating (+${netPosition4wChange.toLocaleString()} contracts). Elevated probability of short squeeze rally.`;
    } else {
      // Trend Continuation with Crowded Short: DO NOT FADE!
      // Stay mildly aligned with the prevailing bear trend, but apply a 30% risk haircut
      regime = 'TREND_CONTINUATION_CROWDED';
      score = -20.0;
      sizingMultiplier = 0.70;
      rationale = `Bearish Trend Continuation (Crowded): CoT Index is low (${cotIndex52w}%), but short distribution continues. Position sizing haircut (0.70x) applied.`;
    }
  }
  // 3. UNCONGESTED RUNWAY ZONE (20% < Index < 80%)
  else {
    // Smooth continuous flow velocity without knife-edge cliffs
    const flowNormalized = tanhNormalize(netPosition4wChange / 22000);
    score = parseFloat((flowNormalized * 55).toFixed(1));
    sizingMultiplier = 1.0;

    if (netPosition4wChange >= 12000) {
      regime = 'BULLISH_FLOW_ACCELERATION';
      rationale = `Institutional Flow Acceleration: Non-commercial net accumulation (+${netPosition4wChange.toLocaleString()} contracts in 4w) with ample positioning runway (${cotIndex52w}% CoT Index).`;
    } else if (netPosition4wChange <= -12000) {
      regime = 'BEARISH_FLOW_ACCELERATION';
      rationale = `Institutional Flow Acceleration: Non-commercial net distribution (${netPosition4wChange.toLocaleString()} contracts in 4w) with ample positioning runway (${cotIndex52w}% CoT Index).`;
    } else {
      regime = 'NEUTRAL';
      rationale = `Positioning is balanced (${cotIndex52w}th percentile) with neutral 4-week net flow (${netPosition4wChange >= 0 ? '+' : ''}${netPosition4wChange.toLocaleString()} contracts).`;
    }
  }

  score = Math.max(-100, Math.min(100, parseFloat(score.toFixed(1))));

  const metrics: CotPositioningMetrics = {
    reportDate,
    nonCommercialLong: nonCommLong,
    nonCommercialShort: nonCommShort,
    netPosition,
    netPosition4wChange,
    openInterest,
    netPctOfOpenInterest,
    cotIndex52w,
    minNet52w,
    maxNet52w,
    isCrowdedLong,
    isCrowdedShort,
    isFlowDecelerating,
    sizingMultiplier,
    regime
  };

  return {
    score,
    status: regime,
    metrics,
    rationale
  };
}
