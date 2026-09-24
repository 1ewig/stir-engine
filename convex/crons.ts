import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 1. Run the institutional swing trading engine every hour on the hour (:00 UTC)
crons.hourly(
  "hourly-stir-engine-run",
  { minuteUTC: 0 },
  internal.engine.runHourly
);

// 2. Storage Hygiene: Prune full serialized audit reports older than 90 days (every Sunday at 02:00 UTC)
// Keeps macro_indicators, latest_signal, and calendar tables indefinitely
crons.weekly(
  "prune-old-audit-reports-weekly",
  { dayOfWeek: "sunday", hourUTC: 2, minuteUTC: 0 },
  internal.mutations.pruneOldAuditReports,
  { maxAgeDays: 90 }
);

export default crons;
