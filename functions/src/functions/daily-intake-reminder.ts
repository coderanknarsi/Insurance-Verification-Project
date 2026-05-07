import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { createIntakeTokenAndNotify } from "../services/intake-token";
import {
  NotificationTrigger,
  NotificationStatus,
} from "../types/notification";
import { SmsConsentStatus } from "../types/borrower";
import { DEMO_ORG_ID } from "../constants";

/**
 * Daily intake reminder.
 *
 * For every borrower with an `awaitingCredentials` policy, look at the
 * most recent INTAKE_REQUESTED / INTAKE_REMINDER notification and decide
 * whether to nudge again. Cadence:
 *
 *   Day 0  → INTAKE_REQUESTED (sent on import / single-add)
 *   Day +2 → INTAKE_REMINDER #1
 *   Day +5 → INTAKE_REMINDER #2
 *   Day +8 → escalate: create staffTask, mark borrower needsHelp.
 *
 * Quiet hours, opt-out, and email fallback are handled by
 * `createIntakeTokenAndNotify`. Borrowers already flagged `needsHelp` are
 * skipped (staff will reach out manually).
 *
 * Runs at 9:30 AM CT (between expiry reminders at 9 AM and lapse auto-request at 10 AM).
 */

const REMINDER_1_AGE_DAYS = 2;
const REMINDER_2_AGE_DAYS = 3; // i.e. 5 days from initial = 3 days from reminder #1
const ESCALATE_AGE_DAYS = 3; // 3 days from reminder #2 = 8 days from initial
const MAX_REMINDERS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export const dailyIntakeReminder = onSchedule(
  {
    schedule: "30 9 * * *",
    timeZone: "America/Chicago",
    retryCount: 1,
  },
  async () => {
    const now = Timestamp.now();
    let totalReminders = 0;
    let totalEscalated = 0;
    let totalSkipped = 0;

    const orgsSnap = await collections.organizations.get();
    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;
      const org = orgDoc.data();
      const orgTimezone =
        (org as { settings?: { complianceRules?: { timezone?: string } } })
          .settings?.complianceRules?.timezone;
      const dealershipName = (org as { name?: string }).name || "Your dealership";

      // All policies in this org that are still awaiting borrower credentials
      const policiesSnap = await collections.policies
        .where("organizationId", "==", orgDoc.id)
        .where("awaitingCredentials", "==", true)
        .get();

      if (policiesSnap.empty) continue;

      for (const policyDoc of policiesSnap.docs) {
        const policy = policyDoc.data();
        const borrowerId = (policy as { borrowerId?: string }).borrowerId;
        const vehicleId = (policy as { vehicleId?: string }).vehicleId;
        if (!borrowerId || !vehicleId) continue;

        try {
          // Most recent intake-related notification for this borrower
          const lastNotifSnap = await collections.notifications
            .where("borrowerId", "==", borrowerId)
            .where("trigger", "in", [
              NotificationTrigger.INTAKE_REQUESTED,
              NotificationTrigger.INTAKE_REMINDER,
            ])
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

          if (lastNotifSnap.empty) {
            // Initial intake never went out (probably no contact info or pre-feature borrower).
            // Don't try to start the cadence here; bulk-import / ingest handle that.
            totalSkipped++;
            continue;
          }

          const lastNotif = lastNotifSnap.docs[0].data();
          // Only count successful sends toward cadence; failed deliveries shouldn't block.
          const lastSuccessAt =
            lastNotif.status === NotificationStatus.SENT && lastNotif.sentAt
              ? (lastNotif.sentAt as Timestamp).toMillis()
              : (lastNotif.createdAt as Timestamp).toMillis();
          const ageDays = (now.toMillis() - lastSuccessAt) / DAY_MS;

          // Count successful reminder sends so far
          const reminderSnap = await collections.notifications
            .where("borrowerId", "==", borrowerId)
            .where("trigger", "==", NotificationTrigger.INTAKE_REMINDER)
            .where("status", "==", NotificationStatus.SENT)
            .get();
          const reminderCount = reminderSnap.size;

          // Borrower record (we need contact + needsHelp flag)
          const borrowerSnap = await collections.borrowers.doc(borrowerId).get();
          if (!borrowerSnap.exists) continue;
          const borrower = borrowerSnap.data()!;

          if (borrower.needsHelp) {
            // Already flagged — staff is handling it, don't keep texting.
            totalSkipped++;
            continue;
          }

          // ── Escalate after MAX_REMINDERS ────────────────────────────
          if (reminderCount >= MAX_REMINDERS) {
            if (ageDays < ESCALATE_AGE_DAYS) {
              totalSkipped++;
              continue;
            }

            await collections.borrowers.doc(borrowerId).update({
              needsHelp: true,
              needsHelpAt: now,
              updatedAt: now,
            });

            await db.collection("staffTasks").doc().set({
              organizationId: orgDoc.id,
              borrowerId,
              policyId: policyDoc.id,
              vehicleId,
              type: "INTAKE_NO_RESPONSE",
              status: "OPEN",
              priority: "MEDIUM",
              title: `${borrower.firstName} ${borrower.lastName} hasn't responded to insurance request`,
              description:
                `${MAX_REMINDERS + 1} attempts sent over ~${Math.round(ageDays + (REMINDER_1_AGE_DAYS + REMINDER_2_AGE_DAYS))} days. ` +
                `Recommend a phone call or in-person follow-up.`,
              createdAt: now,
              updatedAt: now,
            });

            totalEscalated++;
            continue;
          }

          // ── Send reminder ────────────────────────────────────────────
          const requiredAge =
            reminderCount === 0 ? REMINDER_1_AGE_DAYS : REMINDER_2_AGE_DAYS;
          if (ageDays < requiredAge) {
            totalSkipped++;
            continue;
          }

          const hasContact = !!(borrower.email || borrower.phone);
          if (!hasContact) {
            totalSkipped++;
            continue;
          }

          const vehicleSnap = await collections.vehicles.doc(vehicleId).get();
          if (!vehicleSnap.exists) continue;
          const vehicle = vehicleSnap.data()!;
          const vehicleLabel =
            [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
            `VIN ${vehicle.vin}`;

          const result = await createIntakeTokenAndNotify({
            organizationId: orgDoc.id,
            borrower: {
              id: borrowerId,
              firstName: borrower.firstName,
              lastName: borrower.lastName,
              email: borrower.email,
              phone: borrower.phone,
              smsConsentStatus: borrower.smsConsentStatus as SmsConsentStatus | undefined,
            },
            vehicleId,
            vehicleLabel,
            policyId: policyDoc.id,
            dealershipName,
            orgTimezone,
            kind: "reminder",
          });

          if (result.delivered) {
            totalReminders++;
          } else {
            totalSkipped++;
          }
        } catch (err) {
          logger.warn("[daily-intake-reminder] failed for policy", {
            organizationId: orgDoc.id,
            policyId: policyDoc.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info("Daily intake reminder complete", {
      reminders: totalReminders,
      escalated: totalEscalated,
      skipped: totalSkipped,
    });
  },
);
