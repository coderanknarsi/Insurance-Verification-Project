import { logger } from "firebase-functions/v2";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { getLenderAlertEmail } from "./lender-email";
import { sendDealerSweepAlertEmail } from "./email";

const DASHBOARD_URL = "https://app.autolientracker.com";

export interface SweepSummary {
  total: number;
  verified: number;
  failed: number;
  issuesFound: number;
}

export type SweepAlertSeverity = "info" | "warning" | "critical";

export interface SweepAlert {
  subject: string;
  severity: SweepAlertSeverity;
  title: string;
  lines: string[];
}

/**
 * Pure: turn a finalized sweep's counts into a dealer-facing alert.
 *  - critical: every policy failed (nothing was verified)
 *  - warning:  at least one failure
 *  - info:     clean run
 */
export function buildSweepAlert(summary: SweepSummary): SweepAlert {
  const { total, verified, failed, issuesFound } = summary;

  const severity: SweepAlertSeverity =
    total > 0 && verified === 0 ? "critical" : failed > 0 ? "warning" : "info";

  const subject =
    severity === "info"
      ? `Verification sweep complete — ${verified} verified`
      : severity === "critical"
        ? `Verification sweep FAILED — 0 of ${total} verified`
        : `Verification sweep finished with errors — ${verified} verified, ${failed} failed`;

  const title =
    severity === "critical"
      ? "Your verification sweep failed"
      : severity === "warning"
        ? "Your verification sweep finished with errors"
        : "Your verification sweep completed";

  const lines: string[] = [
    `<strong>${verified}</strong> of <strong>${total}</strong> ${
      total === 1 ? "policy was" : "policies were"
    } successfully verified.`,
  ];
  if (failed > 0) {
    lines.push(
      `<strong>${failed}</strong> ${
        failed === 1 ? "policy" : "policies"
      } could not be verified this run and may be unprotected — please review and re-run.`,
    );
  }
  if (issuesFound > 0) {
    lines.push(
      `<strong>${issuesFound}</strong> ${
        issuesFound === 1 ? "policy has" : "policies have"
      } a compliance issue that needs attention.`,
    );
  }

  return { subject, severity, title, lines };
}

/**
 * Best-effort: email the org's admins a recap when a sweep run finalizes, and
 * stamp `dealerAlertSentAt` on the run so it is sent at most once. Never
 * throws — alerting must not break run finalization.
 */
export async function dispatchDealerSweepAlert(
  organizationId: string,
  runId: string,
  summary: SweepSummary,
): Promise<void> {
  try {
    const email = await getLenderAlertEmail(organizationId);
    if (!email) {
      logger.warn("[dealer-sweep-alert] no recipient email", { organizationId, runId });
      return;
    }

    const alert = buildSweepAlert(summary);
    const result = await sendDealerSweepAlertEmail({
      to: email,
      subject: alert.subject,
      title: alert.title,
      lines: alert.lines,
      dashboardUrl: DASHBOARD_URL,
    });

    await db
      .collection("dataFeedRuns")
      .doc(runId)
      .update({ dealerAlertSentAt: Timestamp.now() })
      .catch((err) =>
        logger.warn("[dealer-sweep-alert] stamp failed", { runId, error: String(err) }),
      );

    if (!result.success) {
      logger.warn("[dealer-sweep-alert] send failed", {
        organizationId,
        runId,
        error: result.error,
      });
    }
  } catch (err) {
    logger.warn("[dealer-sweep-alert] unexpected error", {
      organizationId,
      runId,
      error: String(err),
    });
  }
}
