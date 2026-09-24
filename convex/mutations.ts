import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Persist a complete SystemAuditReport into Convex with millisecond precision
 */
export const saveAuditReport = internalMutation({
  args: {
    report: v.any()
  },
  handler: async (ctx, args) => {
    const r = args.report;
    const now = r.timestamp || new Date().toISOString();
    const nowMs = new Date(now).getTime() || Date.now();

    // 1. Insert into audit_reports table
    const reportId = await ctx.db.insert("audit_reports", {
      timestamp: now,
      timestampMs: nowMs,
      status: r.status,
      compositeScore: r.compositeScore,
      verdict: r.verdict,
      weightsApplied: r.weightsApplied,
      sourceHealth: r.sourceHealth,
      layers: {
        macro: r.layers?.macro,
        positioning: r.layers?.positioning,
        news: r.layers?.news,
        technical: r.layers?.technical
      },
      tradePlan: r.tradePlan,
      abortReason: r.abortReason
    });

    // 2. Update singleton latest_signal table
    const existingSignal = await ctx.db
      .query("latest_signal")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();

    const outlook = r.regimeOutlook || r.tradePlan || {};
    const ref = outlook.referenceLevels || {};
    const signalData = {
      key: "current",
      timestamp: now,
      timestampMs: nowMs,
      compositeScore: r.compositeScore,
      verdict: r.verdict,
      regime: outlook.regime || "NEUTRAL_RANGE",
      directionalBias: outlook.directionalBias || "NEUTRAL_PARITY",
      conviction: outlook.conviction || "STAND_ASIDE",
      action: outlook.action || r.verdict,
      vetoTriggered: outlook.vetoTriggered ?? false,
      vetoReason: outlook.vetoReason,
      eventRiskActive: outlook.eventRiskActive ?? false,
      eventRiskReason: outlook.eventRiskReason,

      // Cross-Pillar Narrative Synthesis
      executiveThesis: outlook.executiveThesis || "",
      macroPillarSummary: outlook.macroPillarSummary || "",
      positioningPillarSummary: outlook.positioningPillarSummary || "",
      newsPillarSummary: outlook.newsPillarSummary || "",
      conflictDiagnosis: outlook.conflictDiagnosis,

      // Structural Reference Framework (No signals)
      currentPrice: ref.currentPrice ?? 0,
      localResistance5d: ref.localResistance5d ?? 0,
      localSupport5d: ref.localSupport5d ?? 0,
      rangeHigh20d: ref.rangeHigh20d ?? 0,
      rangeLow20d: ref.rangeLow20d ?? 0,
      channelMid: ref.channelMid ?? 0,
      dailyAtrPips: ref.dailyAtrPips ?? 0,
      volatilityState: ref.volatilityState || "NORMAL",

      // Conditional Scenarios & Invalidation
      thesisConfirmationTriggers: outlook.thesisConfirmationTriggers || [],
      thesisInvalidationTriggers: outlook.thesisInvalidationTriggers || [],
      tacticalPlaybook: outlook.tacticalPlaybook || "",

      rateRegimeFlag: outlook.rateRegimeFlag || "STABLE_SPREAD",
      positioningRegimeFlag: outlook.positioningRegimeFlag || "NEUTRAL",
      reportId
    };

    if (existingSignal) {
      await ctx.db.patch(existingSignal._id, signalData);
    } else {
      await ctx.db.insert("latest_signal", signalData);
    }

    // 3. Save macro indicator time-series point if available
    const macro = r.layers?.macro;
    const pos = r.layers?.positioning;
    if (macro && pos) {
      await ctx.db.insert("macro_indicators", {
        timestamp: now,
        timestampMs: nowMs,
        spread2y: macro.yieldSpreads?.spread2y ?? 0,
        spread2yFastDelta3d: macro.yieldSpreads?.spread2yFastDelta3d ?? 0,
        spread2yMedDelta10d: macro.yieldSpreads?.spread2yMedDelta10d ?? 0,
        spread2yZScore: macro.yieldSpreads?.spread2yZScore ?? 0,
        spread10y: macro.yieldSpreads?.spread10y ?? 0,
        us10yTips: macro.realYields?.us10yTips ?? 0,
        dutchTtfGas: macro.energy?.dutchTtfGas ?? 0,
        brent: macro.energy?.brent ?? 0,
        vix: macro.rawMetrics?.vix ?? 0,
        fedRate: macro.rateMetrics?.liveFedRate ?? 0,
        ecbRate: macro.rateMetrics?.liveEcbRate ?? 0,
        rateDifferential: macro.rateMetrics?.currentRateDifferential ?? 0,
        cotIndex52w: pos.metrics?.cotIndex52w ?? 50,
        cotNet4wChange: pos.metrics?.netPosition4wChange ?? 0,
        cotRegime: pos.metrics?.regime ?? "NEUTRAL"
      });
    }

    // 4. Update economic calendar events
    const calendarEvents = r.layers?.news?.calendarEvents;
    if (Array.isArray(calendarEvents) && calendarEvents.length > 0) {
      // Clear old cached calendar events
      const oldEvents = await ctx.db.query("calendar_events").collect();
      for (const ev of oldEvents) {
        await ctx.db.delete(ev._id);
      }
      for (const ev of calendarEvents.slice(0, 20)) {
        await ctx.db.insert("calendar_events", {
          title: ev.title,
          country: ev.country,
          impact: ev.impact,
          date: ev.date,
          forecast: ev.forecast,
          previous: ev.previous,
          hoursUntil: ev.hoursUntil,
          updatedAt: now
        });
      }
    }

    // 5. Update news stream
    const headlines = r.layers?.news?.headlines;
    if (Array.isArray(headlines) && headlines.length > 0) {
      const oldNews = await ctx.db.query("news_stream").collect();
      for (const item of oldNews) {
        await ctx.db.delete(item._id);
      }
      for (const item of headlines.slice(0, 10)) {
        await ctx.db.insert("news_stream", {
          title: item.title,
          source: item.source,
          url: item.url,
          sentiment: item.sentiment,
          score: item.score,
          snippet: item.snippet,
          date: item.date,
          updatedAt: now
        });
      }
    }

    return { reportId };
  }
});

/**
 * Storage Hygiene: Prune full serialized audit reports older than maxAgeDays (default: 90 days).
 * Keeps macro_indicators, latest_signal, and calendar tables indefinitely.
 */
export const pruneOldAuditReports = internalMutation({
  args: {
    maxAgeDays: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const maxAgeDays = args.maxAgeDays ?? 90;
    const cutoffMs = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    const staleAudits = await ctx.db
      .query("audit_reports")
      .withIndex("by_timestampMs", (q) => q.lt("timestampMs", cutoffMs))
      .take(100);

    for (const audit of staleAudits) {
      await ctx.db.delete(audit._id);
    }

    if (staleAudits.length > 0) {
      console.log(`[Storage Hygiene] Pruned ${staleAudits.length} audit records older than ${maxAgeDays} days.`);
    }

    return { prunedCount: staleAudits.length };
  }
});
