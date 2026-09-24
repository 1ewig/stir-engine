import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Full historical audit logs for every execution
  audit_reports: defineTable({
    timestamp: v.string(),
    status: v.string(), // 'SUCCESS' | 'CRITICAL_DATA_FAILURE'
    compositeScore: v.number(),
    verdict: v.string(),
    weightsApplied: v.object({
      macro: v.number(),
      positioning: v.number(),
      news: v.optional(v.number()),
      technical: v.number()
    }),
    sourceHealth: v.array(
      v.object({
        source: v.string(),
        status: v.string(),
        latencyMs: v.number(),
        details: v.optional(v.string())
      })
    ),
    layers: v.object({
      macro: v.optional(v.any()),
      positioning: v.optional(v.any()),
      news: v.optional(v.any()),
      technical: v.optional(v.any())
    }),
    tradePlan: v.optional(v.any()),
    abortReason: v.optional(v.string())
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_status", ["status"]),

  // Fast single-document current market regime & execution state
  latest_signal: defineTable({
    key: v.string(), // constant "current" for singleton lookup
    timestamp: v.string(),
    compositeScore: v.number(),
    verdict: v.string(),
    regime: v.string(),
    conviction: v.string(),
    action: v.string(),
    vetoTriggered: v.boolean(),
    vetoReason: v.optional(v.string()),
    eventRiskActive: v.boolean(),
    eventRiskReason: v.optional(v.string()),
    entryType: v.string(),
    entryZone: v.string(),
    entryMid: v.number(),
    stopLossPrice: v.number(),
    stopDistancePips: v.number(),
    target1Price: v.number(),
    target1Pips: v.number(),
    target1RR: v.string(),
    target2Price: v.number(),
    target2Pips: v.number(),
    target2RR: v.string(),
    dailyAtrPips: v.number(),
    holdingHorizon: v.string(),
    effectiveLots: v.number(),
    dollarRisk: v.number(),
    rateRegimeFlag: v.string(),
    positioningRegimeFlag: v.string(),
    reportId: v.optional(v.id("audit_reports"))
  }).index("by_key", ["key"]),

  // Real-time macro indicator snapshots for quick charting
  macro_indicators: defineTable({
    timestamp: v.string(),
    spread2y: v.number(),
    spread2yFastDelta3d: v.number(),
    spread2yMedDelta10d: v.number(),
    spread2yZScore: v.number(),
    spread10y: v.number(),
    us10yTips: v.number(),
    dutchTtfGas: v.number(),
    brent: v.number(),
    vix: v.number(),
    fedRate: v.number(),
    ecbRate: v.number(),
    rateDifferential: v.number(),
    cotIndex52w: v.number(),
    cotNet4wChange: v.number(),
    cotRegime: v.string()
  }).index("by_timestamp", ["timestamp"]),

  // Upcoming Economic Calendar releases cached for UI & event risk
  calendar_events: defineTable({
    title: v.string(),
    country: v.string(),
    impact: v.string(),
    date: v.string(),
    forecast: v.optional(v.string()),
    previous: v.optional(v.string()),
    hoursUntil: v.number(),
    updatedAt: v.string()
  }).index("by_hoursUntil", ["hoursUntil"]),

  // Live macroeconomic news stream & sentiment scoring
  news_stream: defineTable({
    title: v.string(),
    source: v.string(),
    url: v.string(),
    sentiment: v.string(),
    score: v.number(),
    snippet: v.string(),
    date: v.optional(v.string()),
    updatedAt: v.string()
  }).index("by_updatedAt", ["updatedAt"])
});
