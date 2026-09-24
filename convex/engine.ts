"use node";

import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { executeFullSystem, DEFAULT_CONFIG } from "../src/index";

/**
 * Hourly Cron Action: Executes the full institutional swing trading engine
 * and saves all reports, signals, indicators, and calendar data into Convex.
 */
export const runHourly = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log(`[Convex Cron] Starting hourly STIR engine run at ${new Date().toISOString()}`);
    const report = await executeFullSystem(DEFAULT_CONFIG);

    await ctx.runMutation(internal.mutations.saveAuditReport, {
      report
    });

    console.log(`[Convex Cron] Hourly run completed successfully. Verdict: ${report.verdict}`);
    return {
      success: true,
      timestamp: report.timestamp,
      compositeScore: report.compositeScore,
      verdict: report.verdict
    };
  }
});

/**
 * On-Demand Action: Allows triggering the engine immediately from a frontend UI, CLI, or webhook
 */
export const runNow = action({
  args: {
    pureMacro: v.optional(v.boolean()),
    withTech: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    console.log(`[Convex Action] Starting on-demand STIR engine run...`);

    const config = { ...DEFAULT_CONFIG };
    if (args.pureMacro) {
      config.layerWeights = {
        macro: 0.75,
        positioning: 0.0,
        news: 0.25,
        technical: 0.0
      };
    } else if (args.withTech) {
      config.layerWeights = {
        macro: 0.40,
        positioning: 0.25,
        news: 0.15,
        technical: 0.20
      };
    }

    const report = await executeFullSystem(config);

    await ctx.runMutation(internal.mutations.saveAuditReport, {
      report
    });

    console.log(`[Convex Action] On-demand run completed. Composite Score: ${report.compositeScore}`);
    return report;
  }
});
