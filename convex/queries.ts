import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the latest active signal, regime, and directional outlook (singleton O(1) lookup)
 */
export const getLatestSignal = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("latest_signal")
      .withIndex("by_key", (q) => q.eq("key", "current"))
      .first();
  }
});

export const getLatestRegime = getLatestSignal;

/**
 * Get audit history with pagination limit
 */
export const getAuditHistory = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 24;
    return await ctx.db
      .query("audit_reports")
      .withIndex("by_timestampMs")
      .order("desc")
      .take(limit);
  }
});

/**
 * Get a specific audit report by ID
 */
export const getAuditReportById = query({
  args: {
    id: v.id("audit_reports")
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  }
});

/**
 * Get macro indicator time series for recent charting
 */
export const getMacroIndicators = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 48;
    return await ctx.db
      .query("macro_indicators")
      .withIndex("by_timestampMs")
      .order("desc")
      .take(limit);
  }
});

/**
 * Query macro indicator time series by exact millisecond range (e.g. Last 24h, Last 7d, Last 30d)
 * Returns bars in ascending chronological order for direct charting consumption.
 */
export const getMacroIndicatorsRange = query({
  args: {
    fromMs: v.optional(v.number()),
    toMs: v.optional(v.number()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 168; // default: 7 days of hourly data (7 * 24 = 168)
    const fromMs = args.fromMs ?? (Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toMs = args.toMs ?? Date.now();

    return await ctx.db
      .query("macro_indicators")
      .withIndex("by_timestampMs", (q) =>
        q.gte("timestampMs", fromMs).lte("timestampMs", toMs)
      )
      .order("asc")
      .take(limit);
  }
});

/**
 * Get cached upcoming economic calendar events
 */
export const getCalendarEvents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("calendar_events")
      .withIndex("by_hoursUntil")
      .collect();
  }
});

/**
 * Get the latest news stream
 */
export const getNewsStream = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("news_stream")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(10);
  }
});
