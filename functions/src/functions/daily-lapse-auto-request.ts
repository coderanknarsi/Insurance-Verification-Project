import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { PolicyStatus, ComplianceIssue } from "../types/policy";
import { SmsConsentStatus } from "../types/borrower";
import { NotificationType, NotificationTrigger, NotificationStatus, NotificationChannel } from "../types/notification";
import { sendIntakeRequestEmail } from "../services/email";
import { sendSms, intakeRequestSmsText, isWithinSendingHours } from "../services/telnyx";
import { logger } from "firebase-functions/v2";
import { DEMO_ORG_ID } from "../constants";

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";
const TOKEN_EXPIRY_DAYS = 7;

/** Statuses that indicate a policy needs new insurance documentation */
const LAPSED_STATUSES = new Set([
  PolicyStatus.CANCELLED,
  PolicyStatus.EXPIRED,
  PolicyStatus.RESCINDED,
]);

/**
 * Runs daily at 10 AM CT (1 hour after expiry reminders).
 * Detects policies that the weekly engine marked as cancelled/expired/lapsed
 * and auto-sends an intake request to the borrower for new insurance info.
 *
 * Only triggers once per lapse event (checks for existing LAPSE_DETECTED
 * notification since the lastVerifiedAt timestamp).
 */
export const dailyLapseAutoRequest = onSchedule(
  {
    schedule: "0 10 * * *",         // 10:00 AM every day
    timeZone: "America/Chicago",
    retryCount: 1,
  },
  async () => {
    const orgsSnap = await collections.organizations.get();
    let totalSent = 0;
    let totalSkipped = 0;

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;

      const org = orgDoc.data();
      const rules = org.settings?.complianceRules;

      // Skip if auto-reminders are disabled for this org
      if (!rules?.autoSendReminder) continue;

      // Find policies with lapsed statuses in this org
      const policiesSnap = await collections.policies
        .where("organizationId", "==", orgDoc.id)
        .where("status", "in", [...LAPSED_STATUSES])
        .get();

      for (const policyDoc of policiesSnap.docs) {
        const policy = policyDoc.data();

        // Skip if already awaiting credentials (we already sent a request)
        if (policy.awaitingCredentials) {
          totalSkipped++;
          continue;
        }

        // Check if we already sent a LAPSE_DETECTED notification for this policy
        // since the last verification (avoid sending duplicate requests)
        const since = policy.lastVerifiedAt ?? policy.updatedAt;
        const recentNotif = await collections.notifications
          .where("borrowerId", "==", policy.borrowerId)
          .where("organizationId", "==", orgDoc.id)
          .where("trigger", "==", NotificationTrigger.LAPSE_DETECTED)
          .where("status", "==", NotificationStatus.SENT)
          .where("createdAt", ">=", since)
          .limit(1)
          .get();

        if (!recentNotif.empty) {
          totalSkipped++;
          continue;
        }

        // Get borrower
        const borrowerSnap = await collections.borrowers.doc(policy.borrowerId).get();
        if (!borrowerSnap.exists) continue;
        const borrower = borrowerSnap.data()!;

        const canEmail = !!borrower.email;
        const canSms =
          !!borrower.phone &&
          borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN &&
          isWithinSendingHours();

        if (!canEmail && !canSms) {
          logger.warn("[auto-request] No contact method for borrower", {
            borrowerId: policy.borrowerId,
            policyId: policyDoc.id,
          });
          continue;
        }

        // Get vehicle info
        const vehicleSnap = await collections.vehicles.doc(policy.vehicleId).get();
        const vehicle = vehicleSnap.exists ? vehicleSnap.data()! : null;
        const vehicleLabel = vehicle
          ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          : "your vehicle";

        const dealershipName = org.name ?? "Your Lender";

        // Generate intake token
        const token = randomUUID();
        const now = Timestamp.now();
        const expiresAt = Timestamp.fromMillis(now.toMillis() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        await db.collection("intakeTokens").doc(token).set({
          token,
          borrowerId: policy.borrowerId,
          vehicleId: policy.vehicleId,
          policyId: policyDoc.id,
          organizationId: orgDoc.id,
          borrowerFirstName: borrower.firstName,
          vehicleLabel,
          dealershipName,
          status: "PENDING",
          expiresAt,
          createdAt: now,
          updatedAt: now,
        });

        const intakeUrl = `${INTAKE_URL_BASE}?token=${token}`;
        let delivered = false;

        // Send email
        if (canEmail) {
          const emailResult = await sendIntakeRequestEmail({
            to: borrower.email!,
            borrowerName: borrower.firstName,
            vehicleLabel,
            dealershipName,
            intakeUrl,
          });
          if (emailResult.success) delivered = true;
        }

        // Send SMS
        if (canSms) {
          const smsText = intakeRequestSmsText(
            borrower.firstName,
            vehicleLabel,
            dealershipName,
            intakeUrl,
          );
          const smsResult = await sendSms(borrower.phone!, smsText);
          if (smsResult.success) delivered = true;
        }

        // Log notification
        await collections.notifications.doc().set({
          borrowerId: policy.borrowerId,
          organizationId: orgDoc.id,
          type: canEmail ? NotificationType.EMAIL : NotificationType.SMS,
          channel: canEmail ? NotificationChannel.EMAIL : NotificationChannel.SMS,
          trigger: NotificationTrigger.LAPSE_DETECTED,
          status: delivered ? NotificationStatus.SENT : NotificationStatus.FAILED,
          ...(delivered && { sentAt: Timestamp.now() }),
          content: `Auto-request for new insurance (${policy.status}) ${delivered ? "sent" : "failed"} to ${borrower.email ?? borrower.phone}`,
          createdAt: Timestamp.now(),
        });

        // Mark policy as awaiting new credentials
        await collections.policies.doc(policyDoc.id).update({
          awaitingCredentials: true,
          complianceIssues: [
            ...(policy.complianceIssues ?? []).filter(
              (i: string) => i !== ComplianceIssue.AWAITING_CREDENTIALS,
            ),
            ComplianceIssue.AWAITING_CREDENTIALS,
          ],
          updatedAt: Timestamp.now(),
        });

        if (delivered) {
          totalSent++;
          logger.info("[auto-request] Intake request sent for lapsed policy", {
            policyId: policyDoc.id,
            borrowerId: policy.borrowerId,
            status: policy.status,
          });
        }
      }
    }

    logger.info(`[auto-request] Daily lapse auto-request complete: ${totalSent} sent, ${totalSkipped} skipped`);
  },
);
