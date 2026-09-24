import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the latest active signal, regime, and trade plan
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
      .withIndex("by_timestamp")
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
 * Get macro indicator time series for charting
 */
export const getMacroIndicators = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 48;
    return await ctx.db
      .query("macro_indicators")
      .withIndex("by_timestamp")
      .order("desc")
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
