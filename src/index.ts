import fs from 'fs';
import path from 'path';
import {
  SystemConfig,
  DEFAULT_CONFIG,
  SystemAuditReport
} from './types';
import { dataProvider } from './dataProvider';
import { runMacroEngine } from './layers/macro';
import { runPositioningEngine } from './layers/positioning';
import { runTechnicalEngine } from './layers/technical';
import { runNewsAndCalendarEngine } from './layers/news';
import { buildTradePlan } from './tradePlan';

// Re-export all submodules for comprehensive module access
export * from './types';
export * from './dataProvider';
export * from './layers/macro';
export * from './layers/positioning';
export * from './layers/technical';
export * from './layers/news';
export * from './tradePlan';

// ============================================================================
// MASTER EXECUTION & STRUCTURED AUDIT TRAIL
// ============================================================================

export async function executeFullSystem(config: SystemConfig = DEFAULT_CONFIG): Promise<SystemAuditReport> {
  console.log("================================================================================");
  console.log("   EUR/USD INSTITUTIONAL 4-LAYER SWING TRADING ENGINE (DATA-DRIVEN TS)          ");
  console.log("   Calibrated for 2-Week to 1-Month Legs (Macro / CoT / News & Events / Tech)   ");
  console.log("================================================================================\n");

  const [macro, positioning, tech, news] = await Promise.all([
    runMacroEngine(),
    runPositioningEngine(),
    runTechnicalEngine(),
    runNewsAndCalendarEngine()
  ]);

  // Robustness Health Check: If critical sources fail (> 2 failures), abort
  const failedSources = dataProvider.healthLogs.filter((h: any) => h.status === 'FAILED');
  if (failedSources.length > 2) {
    console.error(`\n[CRITICAL FAILURE] ${failedSources.length} primary data sources failed. Aborting execution.`);
    const failureReport: SystemAuditReport = {
      timestamp: new Date().toISOString(),
      config,
      status: 'CRITICAL_DATA_FAILURE',
      sourceHealth: dataProvider.healthLogs,
      compositeScore: 0,
      verdict: 'ABORT_INSUFFICIENT_DATA',
      weightsApplied: config.layerWeights,
      layers: {},
      abortReason: `Data sources failed: ${failedSources.map((s: any) => s.source).join(', ')}`
    };
    fs.writeFileSync(path.join(process.cwd(), 'audit_report.json'), JSON.stringify(failureReport, null, 2));
    return failureReport;
  }

  // Composite Weighted Score
  const w = config.layerWeights;
  const newsWeight = w.news ?? 0.15;
  const composite = (macro.score * w.macro) +
                    (positioning.score * w.positioning) +
                    (news.score * newsWeight) +
                    (tech.score * w.technical);
  const finalScore = parseFloat(composite.toFixed(1));

  const plan = buildTradePlan(finalScore, macro, positioning, tech, config, news);

  // Render Table Breakdown
  console.log("\n--------------------------------------------------------------------------------");
  console.log("                    DYNAMIC MULTI-LAYER SCORING MATRIX                         ");
  console.log("--------------------------------------------------------------------------------");
  console.table({
    "Layer 1: Sovereign Yields, Real Rates & Energy": {
      "Score (-100 to +100)": macro.score,
      "Weight": `${(w.macro * 100).toFixed(0)}%`,
      "Weighted Pts": (macro.score * w.macro).toFixed(1),
      "Continuous Metric": `2Y: +${macro.yieldSpreads.spread2y.toFixed(2)}% (z: ${macro.yieldSpreads.spread2yZScore.toFixed(1)}) | Policy: +${macro.rateMetrics.currentRateDifferential.toFixed(2)}% | TIPS: ${macro.realYields?.us10yTips.toFixed(2)}% (z: ${macro.realYields?.rollingZScore ?? 'N/A'})`
    },
    "Layer 2: CFTC CoT Flow Divergence": {
      "Score (-100 to +100)": positioning.score,
      "Weight": `${(w.positioning * 100).toFixed(0)}%`,
      "Weighted Pts": (positioning.score * w.positioning).toFixed(1),
      "Continuous Metric": `Index: ${positioning.metrics.cotIndex52w}% (${positioning.metrics.regime}) | 4w Net: ${positioning.metrics.netPosition4wChange >= 0 ? '+' : ''}${positioning.metrics.netPosition4wChange.toLocaleString()} | Sizing: ${positioning.metrics.sizingMultiplier}x`
    },
    "Layer 3: News Flow & Economic Calendar": {
      "Score (-100 to +100)": news.score,
      "Weight": `${(newsWeight * 100).toFixed(0)}%`,
      "Weighted Pts": (news.score * newsWeight).toFixed(1),
      "Continuous Metric": `Bias: ${news.bias} | Event Risk: ${news.eventRiskActive ? 'TRIGGERED' : 'NORMAL'} | Headlines: ${news.headlines.length}`
    },
    "Layer 4: Local Structure & Technicals": {
      "Score (-100 to +100)": tech.score,
      "Weight": `${(w.technical * 100).toFixed(0)}%`,
      "Weighted Pts": (tech.score * w.technical).toFixed(1),
      "Continuous Metric": `Trend: ${tech.weeklyTrend} | 5d Breakout: ${tech.breakoutState} | RSI: ${tech.rsiWilder} (${tech.rsiExhaustionState})`
    }
  });

  // Display top news headlines
  if (news.headlines.length > 0) {
    console.log("--------------------------------------------------------------------------------");
    console.log("                    LIVE NEWS FLOW (VIA TINYFISH SDK)                           ");
    console.log("--------------------------------------------------------------------------------");
    news.headlines.slice(0, 4).forEach((h, i) => {
      console.log(`[${i + 1}] (${h.sentiment}) ${h.title} [${h.source}]`);
    });
  }

  // Display upcoming economic calendar releases
  if (news.calendarEvents.length > 0) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("               HIGH & MEDIUM IMPACT ECONOMIC CALENDAR EVENTS                    ");
    console.log("--------------------------------------------------------------------------------");
    const upcoming = news.calendarEvents.filter(e => e.hoursUntil >= -2).slice(0, 5);
    upcoming.forEach(e => {
      const timing = e.hoursUntil < 0 ? `${Math.abs(e.hoursUntil)}h ago` : `in ${e.hoursUntil}h`;
      console.log(`• [${e.country}] (${e.impact}) ${timing} -> ${e.title} (F: ${e.forecast || 'N/A'} | P: ${e.previous || 'N/A'})`);
    });
  }

  console.log(`\n>>> COMPOSITE TRADING SCORE: ${finalScore} / 100 (Negative = USD Advantage, Positive = EUR Advantage) <<<`);
  console.log(`>>> REGIME & VERDICT:        ${plan.action} [Conviction: ${plan.conviction} | Rates: ${plan.rateRegimeFlag} | CoT: ${plan.positioningRegimeFlag}] <<<\n`);

  if (plan.vetoTriggered) {
    console.log("================================================================================");
    console.log("             INSTITUTIONAL CONFLUENCE VETO ACTIVATED                            ");
    console.log("================================================================================");
    console.log(`• Status:            ${plan.action}`);
    console.log(`• Veto Diagnosis:    ${plan.vetoReason}`);
    console.log(`• Local Boundaries:  ${plan.entryZone}`);
    console.log("• Capital Directive: Capital preservation. Stand aside until divergence / event risk clears.");
    console.log("================================================================================\n");
  } else if (plan.regime !== 'NEUTRAL_RANGE') {
    console.log("================================================================================");
    console.log(`            ACTIONABLE ${plan.regime} ASYMMETRIC SWING EXECUTION PLAN            `);
    console.log("================================================================================");
    console.log(`• Action:            ${plan.action}`);
    console.log(`• Holding Horizon:   ${plan.holdingHorizon}`);
    console.log(`• Entry Strategy:    ${plan.entryType}`);
    console.log(`• Execution Zone:    ${plan.entryZone}`);
    console.log(`• Structural Stop:   ${plan.stopLossPrice} (${plan.stopDistancePips} pips risk strictly outside 5d structure)`);
    console.log(`• Take Profit 1:     ${plan.target1Price} (+${plan.target1Pips} pips | R:R ${plan.target1RR})`);
    console.log(`• Take Profit 2:     ${plan.target2Price} (+${plan.target2Pips} pips | R:R ${plan.target2RR})`);
    console.log(`• Daily Volatility:  ${plan.dailyAtrPips} pips / day (Wilder Smoothed ATR)`);
    console.log(`• Risk Allocation:   $${plan.sizing.dollarRisk.toFixed(2)} (${plan.sizing.riskPercentage}% on $${plan.sizing.accountEquity.toLocaleString()})`);
    console.log(`• Position Size:     ${plan.sizing.effectiveLots} Standard Lots (${plan.sizing.miniLots} Mini Lots) [Multiplier: ${plan.sizing.sizingMultiplier}x]`);
    console.log("================================================================================\n");
  } else {
    console.log("================================================================================");
    console.log("               NEUTRAL / RANGEBOUND REGIME DETECTED                             ");
    console.log("================================================================================");
    console.log("• Market is currently consolidating without sufficient directional divergence.");
    console.log(`• Support Floor:     ${tech.swingLow20}`);
    console.log(`• Resistance Ceiling:${tech.swingHigh20}`);
    console.log("• Action:            Stand aside. Capital preservation mode.");
    console.log("================================================================================\n");
  }

  // Generate Structured Audit Report
  const auditReport: SystemAuditReport = {
    timestamp: new Date().toISOString(),
    config,
    status: 'SUCCESS',
    sourceHealth: dataProvider.healthLogs,
    compositeScore: finalScore,
    verdict: plan.action,
    weightsApplied: config.layerWeights,
    layers: {
      macro,
      positioning,
      news,
      technical: tech
    },
    tradePlan: plan
  };

  const auditPath = path.join(process.cwd(), 'audit_report.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2), 'utf-8');
  console.log(`[Audit Trail] Persisted structured execution report to: ${auditPath}\n`);

  return auditReport;
}

// Execute directly when invoked via CLI, but not when imported as a module in tests
const isMain = (import.meta as any).main || (typeof process !== 'undefined' && (
  process.argv[1]?.replace(/\\/g, '/').endsWith('src/index.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('eurusd_full_system.ts')
));

if (isMain) {
  const args = process.argv.slice(2);
  const isPureMacro = args.includes('--pure-macro') || args.includes('--macro-only');
  const isWithTech = args.includes('--with-tech') || args.includes('--enable-tech');

  const customConfig: SystemConfig = { ...DEFAULT_CONFIG };

  if (isPureMacro) {
    console.log("\n[Mode]: Running in PURE MACRO + NEWS mode (Technicals & Positioning: 0%)...");
    customConfig.layerWeights = {
      macro: 0.75,
      positioning: 0.0,
      news: 0.25,
      technical: 0.0
    };
  } else if (isWithTech) {
    console.log("\n[Mode]: Running with TECHNICALS enabled (Macro 40%, Positioning 25%, News 15%, Technicals 20%)...");
    customConfig.layerWeights = {
      macro: 0.40,
      positioning: 0.25,
      news: 0.15,
      technical: 0.20
    };
  }

  executeFullSystem(customConfig).catch((err) => {
    console.error('[Execution Error]:', err);
    process.exit(1);
  });
}

