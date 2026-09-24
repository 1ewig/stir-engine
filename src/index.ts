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
import { buildDirectionalOutlook } from './regimeOutlook';

// Re-export all submodules for comprehensive module access
export * from './types';
export * from './dataProvider';
export * from './layers/macro';
export * from './layers/positioning';
export * from './layers/technical';
export * from './layers/news';
export * from './regimeOutlook';
export * from './tradePlan';
export * from './ai';

// ============================================================================
// MASTER EXECUTION & STRUCTURED AUDIT TRAIL
// ============================================================================

export async function executeFullSystem(config: SystemConfig = DEFAULT_CONFIG): Promise<SystemAuditReport> {
  console.log("================================================================================");
  console.log("   EUR/USD 4-PILLAR INSTITUTIONAL QUANTITATIVE ENGINE (DATA-DRIVEN TS)          ");
  console.log("   Calibrated for 2-Week to 1-Month Legs (Macro / CoT / News & Events / Tech)   ");
  console.log("================================================================================\n");

  // Reset health logs for the new execution cycle
  dataProvider.healthLogs = [];

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
    try {
      fs.writeFileSync(path.join(process.cwd(), 'audit_report.json'), JSON.stringify(failureReport, null, 2));
    } catch {
      // Ignore file writing errors in read-only environments
    }
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

  const outlook = buildDirectionalOutlook(finalScore, macro, positioning, tech, config, news);

  // Render Table Breakdown
  console.log("\n--------------------------------------------------------------------------------");
  console.log("                  DYNAMIC MULTI-CATEGORY SCORING MATRIX                         ");
  console.log("--------------------------------------------------------------------------------");
  console.table({
    "1. Macro Fundamentals & Yields": {
      "Score (-100 to +100)": macro.score,
      "Weight": `${(w.macro * 100).toFixed(0)}%`,
      "Weighted Pts": (macro.score * w.macro).toFixed(1),
      "Continuous Metric": `2Y: +${macro.yieldSpreads.spread2y.toFixed(2)}% (z: ${macro.yieldSpreads.spread2yZScore.toFixed(1)}) | Policy: +${macro.rateMetrics.currentRateDifferential.toFixed(2)}% | TIPS: ${macro.realYields?.us10yTips.toFixed(2)}% (z: ${macro.realYields?.rollingZScore ?? 'N/A'})`
    },
    "2. Institutional Positioning & Flow": {
      "Score (-100 to +100)": positioning.score,
      "Weight": `${(w.positioning * 100).toFixed(0)}%`,
      "Weighted Pts": (positioning.score * w.positioning).toFixed(1),
      "Continuous Metric": `Index: ${positioning.metrics.cotIndex52w}% (${positioning.metrics.regime}) | 4w Net: ${positioning.metrics.netPosition4wChange >= 0 ? '+' : ''}${positioning.metrics.netPosition4wChange.toLocaleString()} | Sizing: ${positioning.metrics.sizingMultiplier}x`
    },
    "3. News Sentiment & Catalyst Calendar": {
      "Score (-100 to +100)": news.score,
      "Weight": `${(newsWeight * 100).toFixed(0)}%`,
      "Weighted Pts": (news.score * newsWeight).toFixed(1),
      "Continuous Metric": `Bias: ${news.bias} | Event Risk: ${news.eventRiskActive ? 'TRIGGERED' : 'NORMAL'} | Headlines: ${news.headlines.length}`
    },
    "4. Market Structure & Trade Geometry": {
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
  console.log(`>>> DIRECTIONAL BIAS:        ${outlook.directionalBias} [Conviction: ${outlook.conviction} | Rates: ${outlook.rateRegimeFlag} | CoT: ${outlook.positioningRegimeFlag}] <<<`);
  console.log(`>>> REGIME DIRECTIVE:        ${outlook.action} <<<\n`);

  console.log("================================================================================");
  console.log("             EXECUTIVE MACRO REGIME & DIRECTIONAL OUTLOOK                       ");
  console.log("================================================================================");
  console.log(`• Directional Vector:   ${outlook.directionalBias}`);
  console.log(`• Conviction Tier:      ${outlook.conviction}`);
  console.log(`• Regime Directive:     ${outlook.action}`);
  if (outlook.conflictDiagnosis) {
    console.log(`\n[Cross-Pillar Conflict Diagnosis]`);
    console.log(`  ${outlook.conflictDiagnosis}`);
  }
  console.log(`\n[Executive Thesis]`);
  console.log(`  ${outlook.executiveThesis}`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("                 STRUCTURAL REFERENCE FRAMEWORK (NO SIGNALS)                    ");
  console.log("--------------------------------------------------------------------------------");
  console.log(`• Current Spot Price:   ${outlook.referenceLevels.currentPrice.toFixed(4)}`);
  console.log(`• 5-Day Structural Range: Floor: ${outlook.referenceLevels.localSupport5d.toFixed(4)} | Ceiling: ${outlook.referenceLevels.localResistance5d.toFixed(4)}`);
  console.log(`• 20-Day Swing Channel:  Floor: ${outlook.referenceLevels.rangeLow20d.toFixed(4)} | Mid: ${outlook.referenceLevels.channelMid.toFixed(4)} | Ceiling: ${outlook.referenceLevels.rangeHigh20d.toFixed(4)}`);
  console.log(`• Daily Volatility:      ${outlook.referenceLevels.dailyAtrPips} pips / day (Wilder Smoothed ATR) [Regime: ${outlook.referenceLevels.volatilityState}]`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("                 CONDITIONAL THESIS TRIGGERS & INVALIDATION                     ");
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ Confirmation Triggers (Trend Continuation):");
  outlook.thesisConfirmationTriggers.forEach(t => console.log(`  • ${t}`));
  console.log("▶ Invalidation Triggers (Thesis Violation):");
  outlook.thesisInvalidationTriggers.forEach(t => console.log(`  • ${t}`));
  console.log(`\n▶ Tactical Desk Playbook:`);
  console.log(`  ${outlook.tacticalPlaybook}`);
  console.log("================================================================================\n");

  // Generate Structured Audit Report
  const auditReport: SystemAuditReport = {
    timestamp: new Date().toISOString(),
    config,
    status: 'SUCCESS',
    sourceHealth: dataProvider.healthLogs,
    compositeScore: finalScore,
    verdict: outlook.action,
    weightsApplied: config.layerWeights,
    layers: {
      macro,
      positioning,
      news,
      technical: tech
    },
    regimeOutlook: outlook,
    tradePlan: outlook
  };

  try {
    const auditPath = path.join(process.cwd(), 'audit_report.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2), 'utf-8');
    console.log(`[Audit Trail] Persisted structured execution report to: ${auditPath}\n`);
  } catch {
    // Ignore file writing in serverless/cloud environments
  }

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

