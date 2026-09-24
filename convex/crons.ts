import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run the institutional swing trading engine every hour on the hour (00 UTC)
crons.hourly(
  "hourly-stir-engine-run",
  { minuteUTC: 0 },
  internal.engine.runHourly
);

export default crons;
