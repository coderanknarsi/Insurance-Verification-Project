/**
 * Reminder cadence selection.
 *
 * STANDARD: borrower has a verifiable insured policy — we lean on the org's
 * configured `reminderDaysBeforeExpiry` (single threshold + recent-reminder
 * dedupe) and let the weekly carrier sweep do the heavy lifting.
 *
 * BUMPED: we have NO automated visibility into this policy (carrier outside
 * supported set, or supported but org has no master credentials). We email
 * the borrower at fixed days-out so the dealer doesn't get blindsided.
 */
export enum CadenceMode {
  STANDARD = "STANDARD",
  BUMPED = "BUMPED",
}

/** Days-before-expiry on which BUMPED-mode borrowers receive a reminder. */
export const BUMPED_DAYS: ReadonlySet<number> = new Set([30, 14, 7, 3, 1, 0]);

/**
 * Should we send an expiry reminder for this policy today?
 *
 * @param daysUntilExpiry Calendar days until policy end date (today=0, yesterday=-1).
 * @param mode CadenceMode for this policy.
 * @param orgReminderDays The org's configured `reminderDaysBeforeExpiry` (STANDARD only).
 */
export function shouldRemindAt(
  daysUntilExpiry: number,
  mode: CadenceMode,
  orgReminderDays: number,
): boolean {
  if (daysUntilExpiry < 0) return false;
  if (mode === CadenceMode.BUMPED) return BUMPED_DAYS.has(daysUntilExpiry);
  // STANDARD: any day within the warning window — caller already de-dupes
  // against recent reminders to avoid spamming.
  return daysUntilExpiry <= orgReminderDays;
}
