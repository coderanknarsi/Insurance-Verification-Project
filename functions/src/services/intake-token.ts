import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { db } from "../config/firebase";
import { collections } from "../config/firestore";
import { sendSms, intakeRequestSmsText, intakeReminderSmsText, isWithinSendingHours } from "./telnyx";
import { sendIntakeRequestEmail } from "./email";
import { SmsConsentStatus } from "../types/borrower";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
} from "../types/notification";
import { logger } from "firebase-functions/v2";

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";
const TOKEN_EXPIRY_DAYS = 7;

interface BorrowerLite {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  smsConsentStatus?: SmsConsentStatus;
}

export interface IntakeNotifyInput {
  organizationId: string;
  borrower: BorrowerLite;
  vehicleId: string;
  vehicleLabel: string;
  policyId: string;
  dealershipName: string;
  orgTimezone?: string;
  /** "request" (default) for the first ask, "reminder" for follow-ups. */
  kind?: "request" | "reminder";
}

export interface IntakeNotifyResult {
  token: string;
  intakeUrl: string;
  delivered: boolean;
  deliveryMethod: "sms" | "email" | "both" | "none";
  smsSuppressedReason: "QUIET_HOURS" | null;
  smsError: string | null;
  emailError: string | null;
}

/**
 * Creates an intake token, sends SMS+email to the borrower, and logs a
 * notification record. Shared between `requestBorrowerIntake` (one-off)
 * and `onOrgOnboardingComplete` (bulk kickoff).
 *
 * Returns deliveryMethod="none" + delivered=false if the borrower has
 * no reachable contact method or is suppressed for quiet hours and
 * has no email.
 */
export async function createIntakeTokenAndNotify(
  input: IntakeNotifyInput,
): Promise<IntakeNotifyResult> {
  const { organizationId, borrower, vehicleId, vehicleLabel, policyId, dealershipName, orgTimezone } = input;
  const kind = input.kind ?? "request";
  const isReminder = kind === "reminder";

  const hasSmsConsent =
    !!borrower.phone && borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN;
  const withinHours = isWithinSendingHours(orgTimezone);
  const canSms = hasSmsConsent && withinHours;
  const smsSuppressedReason: "QUIET_HOURS" | null =
    hasSmsConsent && !withinHours ? "QUIET_HOURS" : null;
  const canEmail = !!borrower.email;

  const token = randomUUID();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  if (!canSms && !canEmail) {
    return {
      token,
      intakeUrl: `${INTAKE_URL_BASE}?token=${token}`,
      delivered: false,
      deliveryMethod: "none",
      smsSuppressedReason,
      smsError: null,
      emailError: "no reachable contact method",
    };
  }

  await db.collection("intakeTokens").doc(token).set({
    token,
    borrowerId: borrower.id,
    vehicleId,
    policyId,
    organizationId,
    borrowerFirstName: borrower.firstName,
    vehicleLabel,
    dealershipName,
    status: "PENDING",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const intakeUrl = `${INTAKE_URL_BASE}?token=${token}`;
  let smsSent = false;
  let emailSent = false;
  let smsError: string | null = null;
  let emailError: string | null = null;

  if (canSms) {
    const smsText = isReminder
      ? intakeReminderSmsText(borrower.firstName, vehicleLabel, dealershipName, intakeUrl)
      : intakeRequestSmsText(borrower.firstName, vehicleLabel, dealershipName, intakeUrl);
    const r = await sendSms(borrower.phone!, smsText);
    smsSent = r.success;
    if (!r.success) smsError = r.error ?? "SMS send failed";
  }

  if (canEmail) {
    const r = await sendIntakeRequestEmail({
      to: borrower.email!,
      borrowerName: borrower.firstName,
      vehicleLabel,
      dealershipName,
      intakeUrl,
    });
    emailSent = r.success;
    if (!r.success) emailError = r.error ?? "Email send failed";
  }

  const delivered = smsSent || emailSent;
  const deliveryMethod: IntakeNotifyResult["deliveryMethod"] =
    smsSent && emailSent
      ? "both"
      : smsSent
        ? "sms"
        : emailSent
          ? "email"
          : "none";

  await collections.notifications.doc().set({
    organizationId,
    borrowerId: borrower.id,
    type: smsSent ? NotificationType.SMS : NotificationType.EMAIL,
    trigger: isReminder
      ? NotificationTrigger.INTAKE_REMINDER
      : NotificationTrigger.INTAKE_REQUESTED,
    status: delivered ? NotificationStatus.SENT : NotificationStatus.FAILED,
    content: `${isReminder ? "Insurance reminder" : "Insurance verification request"} sent to ${borrower.firstName} ${borrower.lastName}`,
    createdAt: now,
    ...(delivered && { sentAt: now }),
    ...(!delivered && {
      errorCode: emailError ?? smsError ?? "Delivery failed",
    }),
  });

  if (!delivered) {
    logger.warn("[intake-token] delivery failed", {
      borrowerId: borrower.id,
      smsError,
      emailError,
    });
  }

  return {
    token,
    intakeUrl,
    delivered,
    deliveryMethod,
    smsSuppressedReason,
    smsError,
    emailError,
  };
}
