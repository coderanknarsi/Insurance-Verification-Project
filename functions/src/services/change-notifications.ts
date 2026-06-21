import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { SmsConsentStatus } from "../types/borrower";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
  NotificationChannel,
} from "../types/notification";
import { sendSms, isWithinSendingHours } from "./telnyx";
import {
  changeMessage,
  sendGenericEmail,
  type ChangeMessageKind,
} from "./cadence-templates";
import { dispatchLenderChangeAlert } from "./lender-email";
import { decideChangeNotifications } from "./change-notification-policy";
import type { RawPolicyChange } from "./policy-diff";

export interface DispatchChangeInput {
  organizationId: string;
  borrowerId: string;
  policyId: string;
  changeIds: string[];
  changes: RawPolicyChange[];
}

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";

/**
 * Turn detected policy changes into the right messages to the right party.
 * - Borrower: email always (no opt-out model); SMS only if opted-in and within
 *   TCPA quiet hours.
 * - Lender: real-time alert for material changes.
 * Honors the org-wide notifications kill-switch. Best-effort throughout.
 */
export async function dispatchChangeNotifications(
  input: DispatchChangeInput,
): Promise<void> {
  const { organizationId, borrowerId, policyId, changes, changeIds } = input;

  const orgSnap = await collections.organizations.doc(organizationId).get();
  const org = orgSnap.data();
  if (!org) return;
  const rules = org.settings?.complianceRules;
  if (rules?.notificationsPaused) return; // org kill-switch
  const dealershipName = org.name ?? "Your Lender";

  const decision = decideChangeNotifications(changes);
  const summary = changes.map((c) => c.summary).join("; ");

  // ── Borrower ──
  if (decision.notifyBorrower && decision.borrowerTrigger && borrowerId) {
    const borrowerSnap = await collections.borrowers.doc(borrowerId).get();
    const borrower = borrowerSnap.data();
    if (borrower) {
      const kind = decision.borrowerTrigger as ChangeMessageKind;
      const intakeUrl =
        kind === "REINSTATEMENT_REMINDER"
          ? undefined
          : `${INTAKE_URL_BASE}/${policyId}`;
      const msg = changeMessage(kind, {
        dealershipName,
        firstName: borrower.firstName,
        summary,
        intakeUrl,
      });
      const trigger = mapTrigger(kind);

      // Email (always allowed).
      if (borrower.email) {
        const r = await sendGenericEmail(borrower.email, msg.subject, msg.html).catch(
          (e) => {
            logger.error("change email failed", { policyId, e: String(e) });
            return null;
          },
        );
        if (r?.success) {
          await recordNotification(
            borrowerId,
            organizationId,
            NotificationType.EMAIL,
            NotificationChannel.EMAIL,
            trigger,
            msg.subject,
          );
        }
      }

      // SMS (consent + TCPA quiet hours).
      const consented = borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN;
      const tz = rules?.timezone;
      if (consented && borrower.phone && isWithinSendingHours(tz)) {
        const r = await sendSms(borrower.phone, msg.sms).catch((e) => {
          logger.error("change sms failed", { policyId, e: String(e) });
          return null;
        });
        if (r?.success) {
          await recordNotification(
            borrowerId,
            organizationId,
            NotificationType.SMS,
            NotificationChannel.SMS,
            trigger,
            msg.sms,
          );
        }
      }
    }
  }

  // ── Lender ──
  if (decision.notifyLender) {
    await dispatchLenderChangeAlert({
      organizationId,
      policyId,
      borrowerId,
      severity: decision.lenderSeverity ?? "warning",
      summary,
    }).catch((e) =>
      logger.error("lender change alert failed", { policyId, e: String(e) }),
    );
  }

  // Stamp the change docs as notified.
  if (changeIds.length > 0) {
    const batch = db.batch();
    for (const id of changeIds) {
      batch.update(collections.policyChanges.doc(id), {
        notifiedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit().catch(() => undefined);
  }
}

function mapTrigger(kind: ChangeMessageKind): NotificationTrigger {
  switch (kind) {
    case "VERIFICATION_PROOF_REQUEST":
      return NotificationTrigger.VERIFICATION_PROOF_REQUEST;
    case "REINSTATEMENT_REMINDER":
      return NotificationTrigger.REINSTATEMENT_REMINDER;
    case "COVERAGE_DOWNGRADED":
      return NotificationTrigger.COVERAGE_DOWNGRADED;
    case "DEDUCTIBLE_INCREASED":
      return NotificationTrigger.DEDUCTIBLE_INCREASED;
    case "EXPIRATION_MOVED_UP":
      return NotificationTrigger.EXPIRATION_MOVED_UP;
  }
}

async function recordNotification(
  borrowerId: string,
  organizationId: string,
  type: NotificationType,
  channel: NotificationChannel,
  trigger: NotificationTrigger,
  content: string,
): Promise<void> {
  await collections.notifications.add({
    borrowerId,
    organizationId,
    type,
    channel,
    trigger,
    status: NotificationStatus.SENT,
    content,
    sentAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  } as never);
}
