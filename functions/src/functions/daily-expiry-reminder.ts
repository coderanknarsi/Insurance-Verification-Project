import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { sendReminderEmail } from "../services/email";
import { sendSms, expiryReminderSmsText, isWithinSendingHours } from "../services/telnyx";
import { NotificationType, NotificationTrigger, NotificationStatus, NotificationChannel } from "../types/notification";
import { SmsConsentStatus } from "../types/borrower";
import { logger } from "firebase-functions/v2";
import { DEMO_ORG_ID } from "../constants";

/**
 * Runs daily at 9 AM CT. For each organization with autoSendReminder enabled,
 * finds policies expiring within `reminderDaysBeforeExpiry` days and sends
 * reminder emails to borrowers who have an email and haven't been reminded
 * for this expiry window already.
 */
export const dailyExpiryReminder = onSchedule(
  {
    schedule: "0 9 * * *",          // 9:00 AM every day
    timeZone: "America/Chicago",
    retryCount: 1,
  },
  async () => {
    // Get all organizations
    const orgsSnap = await collections.organizations.get();
    let totalSent = 0;
    let totalFailed = 0;

    for (const orgDoc of orgsSnap.docs) {
      const org = orgDoc.data();
      const rules = org.settings?.complianceRules;

      // Skip demo org
      if (orgDoc.id === DEMO_ORG_ID) continue;

      // Skip if reminders disabled or no rules
      if (!rules?.autoSendReminder) continue;

      const warningDays = rules.reminderDaysBeforeExpiry ?? 10;
      const orgTimezone: string | undefined = rules.timezone;
      const now = new Date();
      const warningDate = new Date(now);
      warningDate.setDate(warningDate.getDate() + warningDays);

      const todayStr = now.toISOString().split("T")[0];       // YYYY-MM-DD
      const warningStr = warningDate.toISOString().split("T")[0];

      // Find policies expiring between today and warningDate
      const policiesSnap = await collections.policies
        .where("organizationId", "==", orgDoc.id)
        .get();

      for (const policyDoc of policiesSnap.docs) {
        const policy = policyDoc.data();
        const endDate = policy.coveragePeriod?.endDate;
        if (!endDate) continue;

        // Only policies expiring within the warning window (inclusive today through warningDate)
        if (endDate < todayStr || endDate > warningStr) continue;

        // Check if we already sent a reminder for this policy recently (within last 3 days)
        const recentReminder = await collections.notifications
          .where("borrowerId", "==", policy.borrowerId)
          .where("organizationId", "==", orgDoc.id)
          .where("trigger", "==", NotificationTrigger.EXPIRING_SOON)
          .where("status", "==", NotificationStatus.SENT)
          .where("createdAt", ">=", Timestamp.fromDate(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)))
          .limit(1)
          .get();

        if (!recentReminder.empty) continue; // Already reminded recently

        // Get borrower
        const borrowerSnap = await collections.borrowers.doc(policy.borrowerId).get();
        if (!borrowerSnap.exists) continue;
        const borrower = borrowerSnap.data()!;

        // Must have email
        if (!borrower.email) continue;

        // Get vehicle info
        const vehicleSnap = await collections.vehicles.doc(policy.vehicleId).get();
        const vehicle = vehicleSnap.exists ? vehicleSnap.data()! : null;
        const vehicleLabel = vehicle
          ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          : "your vehicle";

        // Calculate days until expiry
        const expiryDate = new Date(endDate);
        const daysUntilExpiry = Math.ceil(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Link to the dealership dashboard for action
        const verificationUrl = "https://app.autolientracker.com";

        // Send the reminder email
        const emailResult = await sendReminderEmail({
          to: borrower.email,
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          vehicleLabel,
          dealershipName: org.name,
          daysUntilExpiry: Math.max(daysUntilExpiry, 0),
          verificationUrl,
        });

        // Log notification
        const notifRef = collections.notifications.doc();
        await notifRef.set({
          borrowerId: policy.borrowerId,
          organizationId: orgDoc.id,
          type: NotificationType.EMAIL,
          channel: NotificationChannel.EMAIL,
          trigger: NotificationTrigger.EXPIRING_SOON,
          status: emailResult.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
          ...(emailResult.success && { sentAt: Timestamp.now() }),
          content: `Expiry reminder (${daysUntilExpiry}d) ${emailResult.success ? "sent" : "failed"} to ${borrower.email}`,
          createdAt: Timestamp.now(),
        });

        if (emailResult.success) {
          totalSent++;
        } else {
          totalFailed++;
          logger.warn(`Reminder email failed for ${borrower.email}: ${emailResult.error}`);
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
            status: smsResult.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
            ...(smsResult.success && { sentAt: Timestamp.now() }),
            content: `SMS expiry reminder (${daysUntilExpiry}d) ${smsResult.success ? "sent" : "failed"} to ${borrower.phone}`,
            ...(smsResult.messageSid && { messageSid: smsResult.messageSid }),
            ...(smsResult.errorCode && { errorCode: smsResult.errorCode }),
            ...(smsResult.segments && { segments: smsResult.segments }),
            createdAt: Timestamp.now(),
          });

          if (smsResult.success) {
            totalSent++;
          } else {
            totalFailed++;
            logger.warn(`SMS reminder failed for ${borrower.phone}: ${smsResult.error}`);
          }
        }
      }
    }

    logger.info(`Daily expiry reminder complete: ${totalSent} sent, ${totalFailed} failed`);
  }
);
