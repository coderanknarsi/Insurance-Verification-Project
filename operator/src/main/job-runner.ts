// Phase 3+: subscribes to Firestore for runs with mode = "manual-operator"
// that this machine should pick up. Drives each VIN through the right
// carrier adapter, posts results back to Firebase.

import { logger } from "../shared/logger";

export async function startJobRunner(): Promise<void> {
  logger.info("Job runner not implemented (Phase 3)");
}

export async function stopJobRunner(): Promise<void> {
  logger.info("Job runner stop not implemented (Phase 3)");
}
