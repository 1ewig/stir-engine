import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Persist a complete SystemAuditReport into Convex
 */
export const saveAuditReport = internalMutation({
  args: {
    report: v.any()
  },
  handler: async (ctx, args) => {
    const r = args.report;
    const now = r.timestamp || new Date().toISOString();

    // 1. Insert into audit_reports table
    const reportId = await ctx.db.insert("audit_reports", {
      timestamp: now,
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

    const plan = r.tradePlan || {};
    const signalData = {
      key: "current",
      timestamp: now,
      compositeScore: r.compositeScore,
      verdict: r.verdict,
      regime: plan.regime || "NEUTRAL_RANGE",
      conviction: plan.conviction || "STAND_ASIDE",
      action: plan.action || r.verdict,
      vetoTriggered: plan.vetoTriggered ?? false,
      vetoReason: plan.vetoReason,
      eventRiskActive: plan.eventRiskActive ?? false,
      eventRiskReason: plan.eventRiskReason,
      entryType: plan.entryType || "STAND_ASIDE",
      entryZone: plan.entryZone || "N/A",
      entryMid: plan.entryMid ?? 0,
      stopLossPrice: plan.stopLossPrice ?? 0,
      stopDistancePips: plan.stopDistancePips ?? 0,
      target1Price: plan.target1Price ?? 0,
      target1Pips: plan.target1Pips ?? 0,
      target1RR: plan.target1RR || "N/A",
      target2Price: plan.target2Price ?? 0,
      target2Pips: plan.target2Pips ?? 0,
      target2RR: plan.target2RR || "N/A",
      dailyAtrPips: plan.dailyAtrPips ?? 0,
      holdingHorizon: plan.holdingHorizon || "N/A",
      effectiveLots: plan.sizing?.effectiveLots ?? 0,
      dollarRisk: plan.sizing?.dollarRisk ?? 0,
      rateRegimeFlag: plan.rateRegimeFlag || "STABLE_SPREAD",
      positioningRegimeFlag: plan.positioningRegimeFlag || "NEUTRAL",
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
