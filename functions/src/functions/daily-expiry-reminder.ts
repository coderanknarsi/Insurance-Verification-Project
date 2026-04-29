import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { sendReminderEmail, sendDealerLapseAlertEmail } from "../services/email";
import { sendSms, expiryReminderSmsText, isWithinSendingHours } from "../services/telnyx";
import {
  getPolicyVerificationState,
  VerificationState,
} from "../services/verification-eligibility";
import { CadenceMode, shouldRemindAt } from "../services/expiry-cadence";
import { getLenderAlertEmail } from "../services/lender-email";
import { db } from "../config/firebase";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
  NotificationChannel,
} from "../types/notification";
import { SmsConsentStatus } from "../types/borrower";
import { logger } from "firebase-functions/v2";
import { DEMO_ORG_ID } from "../constants";

/**
 * Runs daily at 9 AM CT. For each org with reminders enabled, classifies
 * every policy via `getPolicyVerificationState` and applies the right
 * cadence:
 *
 *   PENDING_UPLOAD     → skipped here (intake-chase handles it)
 *   INSURED_SUPPORTED  → STANDARD cadence (org's reminderDaysBeforeExpiry)
 *   INSURED_UNSUPPORTED→ BUMPED cadence (30/14/7/3/1/0)
 *   INSURED_NO_CREDS   → BUMPED cadence + dealer alert at day 0
 */
export const dailyExpiryReminder = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "America/Chicago",
    retryCount: 1,
  },
  async () => {
    const orgsSnap = await collections.organizations.get();
    let totalSent = 0;
    let totalFailed = 0;

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;
      const org = orgDoc.data();
      const rules = org.settings?.complianceRules;
      if (!rules || rules.notificationsPaused) continue;

      const orgReminderDays = rules.reminderDaysBeforeExpiry ?? 10;
      const orgTimezone: string | undefined = rules.timezone;
      const now = new Date();
      const todayMs = now.getTime();

      // Pre-load active master creds once per org (set of carrier ids)
      const credsSnap = await db
        .collection("organizations")
        .doc(orgDoc.id)
        .collection("carrierCredentials")
        .where("active", "==", true)
        .get();
      const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

      const policiesSnap = await collections.policies
        .where("organizationId", "==", orgDoc.id)
        .get();

      for (const policyDoc of policiesSnap.docs) {
        const policy = policyDoc.data();
        const endDate = policy.coveragePeriod?.endDate;
        if (!endDate) continue;

        const expiryDate = new Date(endDate);
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - todayMs) / (1000 * 60 * 60 * 24),
        );

        const state = getPolicyVerificationState(
          policy as never,
          orgDoc.id,
          activeCarriers,
        );

        if (state === VerificationState.PENDING_UPLOAD) continue;

        const mode =
          state === VerificationState.INSURED_SUPPORTED
            ? CadenceMode.STANDARD
            : CadenceMode.BUMPED;

        if (!shouldRemindAt(daysUntilExpiry, mode, orgReminderDays)) continue;

        // Recent-reminder dedupe — for STANDARD any send within last 3 days
        // blocks; for BUMPED we de-dupe per-day (last 20h) so each scheduled
        // bump fires once but doesn't double-send within a day.
        const dedupeWindowMs =
          mode === CadenceMode.BUMPED
            ? 20 * 60 * 60 * 1000
            : 3 * 24 * 60 * 60 * 1000;
        const recentReminder = await collections.notifications
          .where("borrowerId", "==", policy.borrowerId)
          .where("organizationId", "==", orgDoc.id)
          .where("trigger", "==", NotificationTrigger.EXPIRING_SOON)
          .where("status", "==", NotificationStatus.SENT)
          .where(
            "createdAt",
            ">=",
            Timestamp.fromDate(new Date(todayMs - dedupeWindowMs)),
          )
          .limit(1)
          .get();
        if (!recentReminder.empty) continue;

        const borrowerSnap = await collections.borrowers
          .doc(policy.borrowerId)
          .get();
        if (!borrowerSnap.exists) continue;
        const borrower = borrowerSnap.data()!;
        if (!borrower.email) continue;

        const vehicleSnap = await collections.vehicles
          .doc(policy.vehicleId)
          .get();
        const vehicle = vehicleSnap.exists ? vehicleSnap.data()! : null;
        const vehicleLabel = vehicle
          ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          : "your vehicle";

        const verificationUrl = "https://app.autolientracker.com";

        const emailResult = await sendReminderEmail({
          to: borrower.email,
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          vehicleLabel,
          dealershipName: org.name,
          daysUntilExpiry: Math.max(daysUntilExpiry, 0),
          verificationUrl,
        });

        await collections.notifications.doc().set({
          borrowerId: policy.borrowerId,
          organizationId: orgDoc.id,
          type: NotificationType.EMAIL,
          channel: NotificationChannel.EMAIL,
          trigger: NotificationTrigger.EXPIRING_SOON,
          status: emailResult.success
            ? NotificationStatus.SENT
            : NotificationStatus.FAILED,
          ...(emailResult.success && { sentAt: Timestamp.now() }),
          content: `Expiry reminder (${mode}, ${daysUntilExpiry}d) ${
            emailResult.success ? "sent" : "failed"
          } to ${borrower.email}`,
          createdAt: Timestamp.now(),
        });

        if (emailResult.success) totalSent++;
        else {
          totalFailed++;
          logger.warn(
            `Reminder email failed for ${borrower.email}: ${emailResult.error}`,
          );
        }

        // ─── Day-0 dealer alert for BUMPED policies ─────────────
        if (mode === CadenceMode.BUMPED && daysUntilExpiry <= 0) {
          const dealerEmail = await getLenderAlertEmail(orgDoc.id);
          if (dealerEmail) {
            const reason: "unsupported_carrier" | "no_credentials" =
              state === VerificationState.INSURED_UNSUPPORTED
                ? "unsupported_carrier"
                : "no_credentials";
            const dealerResult = await sendDealerLapseAlertEmail({
              to: dealerEmail,
              borrowerName: `${borrower.firstName} ${borrower.lastName}`,
              vehicleLabel,
              insuranceProvider: policy.insuranceProvider ?? "Unknown",
              reason,
              dashboardUrl: verificationUrl,
            });
            await collections.notifications.doc().set({
              borrowerId: policy.borrowerId,
              organizationId: orgDoc.id,
              type: NotificationType.EMAIL,
              channel: NotificationChannel.EMAIL,
              trigger: NotificationTrigger.EXPIRING_SOON,
              status: dealerResult.success
                ? NotificationStatus.SENT
                : NotificationStatus.FAILED,
              ...(dealerResult.success && { sentAt: Timestamp.now() }),
              content: `Dealer lapse alert (${reason}) ${
                dealerResult.success ? "sent" : "failed"
              } to ${dealerEmail}`,
              createdAt: Timestamp.now(),
            });
            if (dealerResult.success) totalSent++;
            else totalFailed++;
          }
        }

        // ─── SMS for urgent expiries (≤3 days) ──────────────────
        const canSendSms =
          borrower.phone &&
          borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN &&
          daysUntilExpiry <= 3 &&
          isWithinSendingHours(orgTimezone);

        if (canSendSms) {
          const smsText = expiryReminderSmsText(
            `${borrower.firstName} ${borrower.lastName}`,
            vehicleLabel,
            org.name,
            Math.max(daysUntilExpiry, 0),
            verificationUrl,
          );

          const smsResult = await sendSms(borrower.phone!, smsText);

          await collections.notifications.doc().set({
            borrowerId: policy.borrowerId,
            organizationId: orgDoc.id,
            type: NotificationType.SMS,
            channel: NotificationChannel.SMS,
            trigger: NotificationTrigger.EXPIRING_SOON,
            status: smsResult.success
              ? NotificationStatus.SENT
              : NotificationStatus.FAILED,
            ...(smsResult.success && { sentAt: Timestamp.now() }),
            content: `SMS expiry reminder (${daysUntilExpiry}d) ${
              smsResult.success ? "sent" : "failed"
            } to ${borrower.phone}`,
            ...(smsResult.messageSid && { messageSid: smsResult.messageSid }),
            ...(smsResult.errorCode && { errorCode: smsResult.errorCode }),
            ...(smsResult.segments && { segments: smsResult.segments }),
            createdAt: Timestamp.now(),
          });

          if (smsResult.success) totalSent++;
          else {
            totalFailed++;
            logger.warn(
              `SMS reminder failed for ${borrower.phone}: ${smsResult.error}`,
            );
          }
        }
      }
    }

    logger.info(
      `Daily expiry reminder complete: ${totalSent} sent, ${totalFailed} failed`,
    );
  },
);
