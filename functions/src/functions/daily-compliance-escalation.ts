import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomUUID } from "crypto";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { DEMO_ORG_ID } from "../constants";
import { PolicyStatus, ComplianceIssue } from "../types/policy";
import { SmsConsentStatus } from "../types/borrower";
import {
  NotificationType,
  NotificationTrigger,
  NotificationStatus,
  NotificationChannel,
} from "../types/notification";
import {
  DEFAULT_LAPSE_ESCALATION,
  DEFAULT_COVERAGE_ESCALATION,
} from "../types/organization";
import { sendCadenceEmail, cadenceSmsText, type CadenceStage } from "../services/cadence-templates";
import { sendSms, isWithinSendingHours } from "../services/telnyx";

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";
const TOKEN_EXPIRY_DAYS = 14;

/** Statuses that mean the policy is lapsed and the lapse cadence applies. */
const LAPSED_STATUSES = new Set<PolicyStatus>([
  PolicyStatus.CANCELLED,
  PolicyStatus.EXPIRED,
  PolicyStatus.RESCINDED,
]);

/**
 * Coverage compliance issues that drive the coverage cadence. Lapse-state
 * issues (POLICY_CANCELLED, POLICY_EXPIRED) are excluded — those use the
 * lapse cadence instead.
 */
const COVERAGE_ISSUES = new Set<string>([
  ComplianceIssue.MISSING_LIENHOLDER,
  ComplianceIssue.NO_COMPREHENSIVE,
  ComplianceIssue.NO_COLLISION,
  ComplianceIssue.DEDUCTIBLE_TOO_HIGH,
  ComplianceIssue.VIN_MISMATCH,
  ComplianceIssue.VEHICLE_REMOVED,
]);

const ISSUE_LABELS: Record<string, string> = {
  MISSING_LIENHOLDER: "lienholder not listed on policy",
  NO_COMPREHENSIVE: "comprehensive coverage missing",
  NO_COLLISION: "collision coverage missing",
  DEDUCTIBLE_TOO_HIGH: "deductible exceeds maximum allowed",
  VIN_MISMATCH: "VIN does not match records",
  VEHICLE_REMOVED: "vehicle removed from policy",
};

/**
 * Daily compliance escalation — runs at 9:30 AM CT (after the 9 AM expiry
 * reminder and before the 10 AM lapse auto-request, so cures land first).
 *
 * Responsibilities:
 *   1. For policies in a LAPSED status, send T+secondNoticeDays and
 *      T+finalNoticeDays escalation notices (T+1 first notice is handled
 *      by daily-lapse-auto-request).
 *   2. For ACTIVE policies with non-lapse compliance issues, manage the
 *      coverage cure cadence (T+1 / T+14 / T+30).
 *   3. Detect cures — when a previously-flagged policy returns to
 *      compliance, send the cure confirmation and clear the cadence anchor.
 *
 * State is anchored on the policy itself via `lapseDetectedAt` and
 * `coverageIssueDetectedAt`. Notifications collection is the dedupe store
 * (we never send the same trigger twice for the same anchor period).
 */
export const dailyComplianceEscalation = onSchedule(
  {
    schedule: "30 9 * * *",
    timeZone: "America/Chicago",
    retryCount: 1,
    memory: "256MiB",
  },
  async () => {
    const orgsSnap = await collections.organizations.get();
    let totalSent = 0;
    let totalCured = 0;

    for (const orgDoc of orgsSnap.docs) {
      if (orgDoc.id === DEMO_ORG_ID) continue;

      const org = orgDoc.data();
      const rules = org.settings?.complianceRules;
      if (!rules || rules.notificationsPaused) continue;

      const lapseCadence = rules.lapseEscalation ?? DEFAULT_LAPSE_ESCALATION;
      const coverageCadence = rules.coverageEscalation ?? DEFAULT_COVERAGE_ESCALATION;
      const orgTimezone: string | undefined = rules.timezone;
      const dealershipName = org.name ?? "Your Lender";

      const policiesSnap = await collections.policies
        .where("organizationId", "==", orgDoc.id)
        .get();

      for (const policyDoc of policiesSnap.docs) {
        const policy = policyDoc.data();
        const isLapsed = LAPSED_STATUSES.has(policy.status);
        const issueList = (policy.complianceIssues ?? []).filter((i: string) =>
          COVERAGE_ISSUES.has(i),
        );
        const hasCoverageIssues =
          policy.status === PolicyStatus.ACTIVE && issueList.length > 0;

        // ── 1. CURE DETECTION ────────────────────────────────────
        if (!isLapsed && policy.lapseDetectedAt) {
          const sent = await sendCadenceMessage(
            "LAPSE_CURED",
            policy,
            policyDoc.id,
            orgDoc.id,
            dealershipName,
            orgTimezone,
            issueList,
          );
          await collections.policies.doc(policyDoc.id).update({
            lapseDetectedAt: FieldValue.delete(),
            updatedAt: Timestamp.now(),
          });
          if (sent) totalCured++;
          continue;
        }
        if (!hasCoverageIssues && policy.coverageIssueDetectedAt) {
          const sent = await sendCadenceMessage(
            "COVERAGE_CURED",
            policy,
            policyDoc.id,
            orgDoc.id,
            dealershipName,
            orgTimezone,
            issueList,
          );
          await collections.policies.doc(policyDoc.id).update({
            coverageIssueDetectedAt: FieldValue.delete(),
            updatedAt: Timestamp.now(),
          });
          if (sent) totalCured++;
          continue;
        }

        // ── 2. LAPSE CADENCE ────────────────────────────────────
        if (isLapsed && policy.lapseDetectedAt) {
          const days = daysSince(policy.lapseDetectedAt);
          let stage: CadenceStage | null = null;
          let trigger: NotificationTrigger | null = null;

          if (days >= lapseCadence.finalNoticeDays) {
            stage = "LAPSED_FINAL_NOTICE";
            trigger = NotificationTrigger.LAPSED_FINAL_NOTICE;
          } else if (days >= lapseCadence.secondNoticeDays) {
            stage = "LAPSED_SECOND_NOTICE";
            trigger = NotificationTrigger.LAPSED_SECOND_NOTICE;
          }

          if (stage && trigger) {
            const alreadySent = await wasAlreadySent(
              policy.borrowerId,
              orgDoc.id,
              trigger,
              policy.lapseDetectedAt,
            );
            if (!alreadySent) {
              const sent = await sendCadenceMessage(
                stage,
                policy,
                policyDoc.id,
                orgDoc.id,
                dealershipName,
                orgTimezone,
                issueList,
              );
              if (sent) totalSent++;
            }
          }
          continue;
        }

        // ── 3. COVERAGE CADENCE ─────────────────────────────────
        if (hasCoverageIssues) {
          // Anchor the cadence on first detection
          if (!policy.coverageIssueDetectedAt) {
            await collections.policies.doc(policyDoc.id).update({
              coverageIssueDetectedAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            });
            // First notice fires next run (T+1) — don't send today
            continue;
          }

          const days = daysSince(policy.coverageIssueDetectedAt);
          let stage: CadenceStage | null = null;
          let trigger: NotificationTrigger | null = null;

          if (days >= coverageCadence.finalNoticeDays) {
            stage = "COVERAGE_FINAL_NOTICE";
            trigger = NotificationTrigger.COVERAGE_FINAL_NOTICE;
          } else if (days >= coverageCadence.secondNoticeDays) {
            stage = "COVERAGE_SECOND_NOTICE";
            trigger = NotificationTrigger.COVERAGE_SECOND_NOTICE;
          } else if (days >= coverageCadence.firstNoticeDays) {
            stage = "COVERAGE_FIRST_NOTICE";
            trigger = NotificationTrigger.COVERAGE_FIRST_NOTICE;
          }

          if (stage && trigger) {
            const alreadySent = await wasAlreadySent(
              policy.borrowerId,
              orgDoc.id,
              trigger,
              policy.coverageIssueDetectedAt,
            );
            if (!alreadySent) {
              const sent = await sendCadenceMessage(
                stage,
                policy,
                policyDoc.id,
                orgDoc.id,
                dealershipName,
                orgTimezone,
                issueList,
              );
              if (sent) totalSent++;
            }
          }
        }
      }
    }

    logger.info(
      `[compliance-escalation] Done — ${totalSent} escalations sent, ${totalCured} cures sent`,
    );
  },
);

// ─── helpers ────────────────────────────────────────────────────

function daysSince(ts: Timestamp): number {
  const ms = Date.now() - ts.toMillis();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function wasAlreadySent(
  borrowerId: string,
  organizationId: string,
  trigger: NotificationTrigger,
  since: Timestamp,
): Promise<boolean> {
  const snap = await collections.notifications
    .where("borrowerId", "==", borrowerId)
    .where("organizationId", "==", organizationId)
    .where("trigger", "==", trigger)
    .where("createdAt", ">=", since)
    .limit(1)
    .get();
  return !snap.empty;
}

function summarizeIssues(issues: string[]): string {
  return issues
    .map((i) => ISSUE_LABELS[i] ?? i.toLowerCase().replace(/_/g, " "))
    .join(", ");
}

const STAGE_TO_TRIGGER: Record<CadenceStage, NotificationTrigger> = {
  LAPSED_SECOND_NOTICE: NotificationTrigger.LAPSED_SECOND_NOTICE,
  LAPSED_FINAL_NOTICE: NotificationTrigger.LAPSED_FINAL_NOTICE,
  LAPSE_CURED: NotificationTrigger.LAPSE_CURED,
  COVERAGE_FIRST_NOTICE: NotificationTrigger.COVERAGE_FIRST_NOTICE,
  COVERAGE_SECOND_NOTICE: NotificationTrigger.COVERAGE_SECOND_NOTICE,
  COVERAGE_FINAL_NOTICE: NotificationTrigger.COVERAGE_FINAL_NOTICE,
  COVERAGE_CURED: NotificationTrigger.COVERAGE_CURED,
};

const FINAL_OR_ESCALATION_STAGES = new Set<CadenceStage>([
  "LAPSED_SECOND_NOTICE",
  "LAPSED_FINAL_NOTICE",
  "COVERAGE_SECOND_NOTICE",
  "COVERAGE_FINAL_NOTICE",
]);

/**
 * Sends the email + (optionally) SMS for a stage and writes notification log entries.
 * Returns true if at least one channel delivered.
 */
async function sendCadenceMessage(
  stage: CadenceStage,
  policy: any,
  policyId: string,
  organizationId: string,
  dealershipName: string,
  orgTimezone: string | undefined,
  issues: string[],
): Promise<boolean> {
  const trigger = STAGE_TO_TRIGGER[stage];

  const borrowerSnap = await collections.borrowers.doc(policy.borrowerId).get();
  if (!borrowerSnap.exists) return false;
  const borrower = borrowerSnap.data()!;

  const vehicleSnap = await collections.vehicles.doc(policy.vehicleId).get();
  const vehicle = vehicleSnap.exists ? vehicleSnap.data()! : null;
  const vehicleLabel = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : "your vehicle";

  // Generate fresh intake token for action URL (skip cure messages)
  let actionUrl = "https://app.autolientracker.com";
  if (stage !== "LAPSE_CURED" && stage !== "COVERAGE_CURED") {
    const token = randomUUID();
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    await db.collection("intakeTokens").doc(token).set({
      token,
      borrowerId: policy.borrowerId,
      vehicleId: policy.vehicleId,
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
    actionUrl = `${INTAKE_URL_BASE}?token=${token}`;
  }

  const messageInput = {
    to: borrower.email ?? "",
    borrowerName: `${borrower.firstName} ${borrower.lastName}`,
    vehicleLabel,
    dealershipName,
    actionUrl,
    issueSummary: issues.length ? summarizeIssues(issues) : undefined,
  };

  let delivered = false;

  // Email
  if (borrower.email) {
    const emailResult = await sendCadenceEmail(stage, messageInput);
    if (emailResult.success) delivered = true;

    await collections.notifications.doc().set({
      borrowerId: policy.borrowerId,
      organizationId,
      type: NotificationType.EMAIL,
      channel: NotificationChannel.EMAIL,
      trigger,
      status: emailResult.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
      ...(emailResult.success && { sentAt: Timestamp.now() }),
      content: `${stage} email ${emailResult.success ? "sent" : "failed"} to ${borrower.email}`,
      createdAt: Timestamp.now(),
    });
    if (!emailResult.success) {
      logger.warn(`[compliance-escalation] Email failed for ${borrower.email}: ${emailResult.error}`);
    }
  }

  // SMS — escalation notices only (skip cures and first coverage notice)
  const smsAllowed = FINAL_OR_ESCALATION_STAGES.has(stage) || stage === "COVERAGE_FIRST_NOTICE";
  const canSendSms =
    smsAllowed &&
    borrower.phone &&
    borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN &&
    isWithinSendingHours(orgTimezone);

  if (canSendSms) {
    const smsText = cadenceSmsText(stage, messageInput);
    const smsResult = await sendSms(borrower.phone!, smsText);

    await collections.notifications.doc().set({
      borrowerId: policy.borrowerId,
      organizationId,
      type: NotificationType.SMS,
      channel: NotificationChannel.SMS,
      trigger,
      status: smsResult.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
      ...(smsResult.success && { sentAt: Timestamp.now() }),
      content: `${stage} SMS ${smsResult.success ? "sent" : "failed"} to ${borrower.phone}`,
      ...(smsResult.messageSid && { messageSid: smsResult.messageSid }),
      ...(smsResult.errorCode && { errorCode: smsResult.errorCode }),
      ...(smsResult.segments && { segments: smsResult.segments }),
      createdAt: Timestamp.now(),
    });
    if (smsResult.success) delivered = true;
    else logger.warn(`[compliance-escalation] SMS failed for ${borrower.phone}: ${smsResult.error}`);
  }

  if (delivered) {
    logger.info(`[compliance-escalation] ${stage} sent`, {
      policyId,
      borrowerId: policy.borrowerId,
      organizationId,
    });
  }
  return delivered;
}
