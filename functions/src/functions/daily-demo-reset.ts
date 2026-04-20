import { onSchedule } from "firebase-functions/v2/scheduler";
import { clearDemoData, seedDemoData } from "../services/demo-seed";
import { logger } from "firebase-functions/v2";

/**
 * Runs daily at midnight UTC. Wipes all demo org data and re-seeds
 * with fresh sample borrowers, vehicles, and policies.
 */
export const dailyDemoReset = onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: "UTC",
    retryCount: 1,
  },
  async () => {
    logger.info("Starting daily demo data reset");
    await clearDemoData();
    await seedDemoData();
    logger.info("Daily demo data reset complete");
  }
);
