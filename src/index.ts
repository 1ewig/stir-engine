import fs from 'fs';
import path from 'path';
import {
  SystemConfig,
  DEFAULT_CONFIG,
  SystemAuditReport
} from './types';
import { dataProvider } from './dataProvider';
import { runMacroEngine } from './layers/macro';
import { runSurpriseEngine } from './layers/surprise';
import { runTechnicalEngine } from './layers/technical';
import { buildTradePlan } from './tradePlan';

// Re-export all submodules for comprehensive module access
export * from './types';
export * from './dataProvider';
export * from './layers/macro';
export * from './layers/surprise';
export * from './layers/technical';
export * from './tradePlan';

// ============================================================================
// MASTER EXECUTION & STRUCTURED AUDIT TRAIL
// ============================================================================

export async function executeFullSystem(config: SystemConfig = DEFAULT_CONFIG): Promise<SystemAuditReport> {
  console.log("================================================================================");
  console.log("      EUR/USD INSTITUTIONAL 3-LAYER TRADING ENGINE (DATA-DRIVEN TS)            ");
  console.log("================================================================================\n");

  const [macro, surprise, tech] = await Promise.all([
    runMacroEngine(),
    runSurpriseEngine(),
    runTechnicalEngine()
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
  const composite = (macro.score * w.macro) + (surprise.score * w.surprise) + (tech.score * w.technical);
  const finalScore = parseFloat(composite.toFixed(1));

  const plan = buildTradePlan(finalScore, macro, tech, config);

  // Render Table Breakdown
  console.log("\n--------------------------------------------------------------------------------");
  console.log("                    DYNAMIC MULTI-LAYER SCORING MATRIX                         ");
  console.log("--------------------------------------------------------------------------------");
  console.table({
    "Layer 1: Macro Rate & Yields (60%)": {
      "Score (-100 to +100)": macro.score,
      "Weight": `${w.macro * 100}%`,
      "Weighted Pts": (macro.score * w.macro).toFixed(1),
      "Continuous Metric": `Fed: ${macro.rateMetrics.liveFedRate.toFixed(2)}% | ECB: ${macro.rateMetrics.liveEcbRate.toFixed(2)}% | Spread: +${macro.rateMetrics.currentRateDifferential.toFixed(2)}%`
    },
    "Layer 2: Surprise NLP (20%)": {
      "Score (-100 to +100)": surprise.score,
      "Weight": `${w.surprise * 100}%`,
      "Weighted Pts": (surprise.score * w.surprise).toFixed(1),
      "Continuous Metric": `Status: ${surprise.status} | Tokens: [${surprise.tokensDetected.usBullish.slice(0, 3).join(', ')}]`
    },
    "Layer 3: Wilder Technicals (20%)": {
      "Score (-100 to +100)": tech.score,
      "Weight": `${w.technical * 100}%`,
      "Weighted Pts": (tech.score * w.technical).toFixed(1),
      "Continuous Metric": `Price: ${tech.currentPrice} | 20SMA Slope: ${tech.sma20SlopePips} p/d | Wilder RSI: ${tech.rsiWilder}`
    }
  });

  console.log(`\n>>> COMPOSITE TRADING SCORE: ${finalScore} / 100 (Negative = USD Advantage, Positive = EUR Advantage) <<<`);
  console.log(`>>> REGIME & VERDICT:        ${plan.action} [Conviction: ${plan.conviction} | Rate Regime: ${plan.rateRegimeFlag}] <<<\n`);

  if (plan.regime !== 'NEUTRAL_RANGE') {
    console.log("================================================================================");
    console.log(`                  ACTIONABLE ${plan.regime} SWING EXECUTION PLAN                `);
    console.log("================================================================================");
    console.log(`• Action:            ${plan.action}`);
    console.log(`• Entry Strategy:    ${plan.entryType}`);
    console.log(`• Optimal Entry:     ${plan.entryZone}`);
    console.log(`• Invalidation (SL): ${plan.stopLossPrice} (${plan.stopDistancePips} pips risk)`);
    console.log(`• Take Profit 1:     ${plan.target1Price} (+${plan.target1Pips} pips | R:R ${plan.target1RR})`);
    console.log(`• Take Profit 2:     ${plan.target2Price} (+${plan.target2Pips} pips | R:R ${plan.target2RR})`);
    console.log(`• Daily Volatility:  ${plan.dailyAtrPips} pips / day (Wilder Smoothed ATR)`);
    console.log(`• Sizing Formula:    Risk $${plan.sizing.dollarRisk.toFixed(2)} (${plan.sizing.riskPercentage}% on $${plan.sizing.accountEquity.toLocaleString()})`);
    console.log(`• Recommended Size:  ${plan.sizing.recommendedLots} Standard Lots (${plan.sizing.miniLots} Mini Lots)`);
    console.log("================================================================================\n");
  } else {
    console.log("================================================================================");
    console.log("               NEUTRAL / RANGEBOUND REGIME DETECTED                             ");
    console.log("================================================================================");
    console.log("• Market is currently consolidating without sufficient directional divergence.");
    console.log(`• Channel Support:   ${tech.swingLow20}`);
    console.log(`• Channel Resistance:${tech.swingHigh20}`);
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
      surprise,
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
const isMain = import.meta.main || (typeof process !== 'undefined' && (
  process.argv[1]?.replace(/\\/g, '/').endsWith('src/index.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('eurusd_full_system.ts')
));

if (isMain) {
  executeFullSystem().catch((err) => {
    console.error('[Execution Error]:', err);
    process.exit(1);
  });
}
