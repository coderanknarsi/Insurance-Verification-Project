import { logger } from "firebase-functions/v2";
import { collections } from "../config/firestore";
import { UserRole } from "../types/user";
import { sendGenericEmail, wrapInLayout } from "./cadence-templates";
import type { ChangeSeverity } from "../types/policy-change";

/**
 * Returns the email address that should receive lender-side alerts for an org.
 * Looks for the first ADMIN user in the org, falling back to any user.
 */
export async function getLenderAlertEmail(
  organizationId: string,
): Promise<string | null> {
  try {
    const adminSnap = await collections.users
      .where("organizationId", "==", organizationId)
      .where("role", "==", UserRole.ADMIN)
      .limit(1)
      .get();
    if (!adminSnap.empty) {
      const email = adminSnap.docs[0].data().email;
      if (email) return email as string;
    }
    const anySnap = await collections.users
      .where("organizationId", "==", organizationId)
      .limit(1)
      .get();
    if (!anySnap.empty) {
      const email = anySnap.docs[0].data().email;
      if (email) return email as string;
    }
  } catch (err) {
    logger.warn("[lender-email] lookup failed", {
      organizationId,
      err: String(err),
    });
  }
  return null;
}

const DASHBOARD_URL = "https://app.autolientracker.com";

export interface LenderChangeAlertInput {
  organizationId: string;
  policyId: string;
  borrowerId: string;
  severity: ChangeSeverity;
  summary: string;
}

/**
 * Real-time lender alert for a material coverage change on a financed vehicle.
 * Sends to the org's admin(s). Severity drives the subject prefix. Best-effort:
 * never throws (alerting must not break change persistence).
 */
export async function dispatchLenderChangeAlert(
  input: LenderChangeAlertInput,
): Promise<void> {
  try {
    const email = await getLenderAlertEmail(input.organizationId);
    if (!email) {
      logger.warn("[lender-change-alert] no recipient email", {
        organizationId: input.organizationId,
      });
      return;
    }

    let borrowerName = "A borrower";
    try {
      const bSnap = await collections.borrowers.doc(input.borrowerId).get();
      const b = bSnap.data();
      if (b) borrowerName = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || borrowerName;
    } catch {
      // best-effort
    }

    const prefix =
      input.severity === "critical"
        ? "[Action] Coverage change"
        : input.severity === "warning"
          ? "Coverage change"
          : "Coverage update";
    const accent =
      input.severity === "critical" ? "#ef4444" : input.severity === "warning" ? "#f59e0b" : "#3b82f6";

    const html = wrapInLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:${accent};">
        ${prefix}
      </h2>
      <p style="margin:0 0 16px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        A material change was detected on a financed vehicle's insurance for
        <strong style="color:#ffffff;">${borrowerName}</strong>.
      </p>
      <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:15px;color:#ffffff;line-height:1.6;">${input.summary}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#6b7a99;line-height:1.5;">
        Review this borrower in your dashboard: ${DASHBOARD_URL}
      </p>`);

    const result = await sendGenericEmail(email, `${prefix} — ${borrowerName}`, html);
    if (!result.success) {
      logger.warn("[lender-change-alert] send failed", {
        organizationId: input.organizationId,
        error: result.error,
      });
    }
  } catch (err) {
    logger.warn("[lender-change-alert] unexpected error", {
      organizationId: input.organizationId,
      error: String(err),
    });
  }
}

export interface LenderChangeDigestRow {
  borrowerName: string;
  summary: string;
  severity: ChangeSeverity;
  detectedAt: string;
}

/**
 * Weekly roll-up of policy changes for an org's lender/admin. Sent to the org's
 * admin recipient. Best-effort: never throws. Returns true if an email was sent.
 */
export async function sendLenderChangeDigestEmail(
  organizationId: string,
  rows: LenderChangeDigestRow[],
): Promise<boolean> {
  try {
    if (rows.length === 0) return false;
    const email = await getLenderAlertEmail(organizationId);
    if (!email) {
      logger.warn("[lender-change-digest] no recipient email", { organizationId });
      return false;
    }

    const accentFor = (s: ChangeSeverity) =>
      s === "critical" ? "#ef4444" : s === "warning" ? "#f59e0b" : "#3b82f6";

    const rowsHtml = rows
      .map(
        (r) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;color:#ffffff;">${r.borrowerName}</td>
          <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;color:#c7d2e8;">${r.summary}</td>
          <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:${accentFor(r.severity)};text-transform:uppercase;font-weight:600;">${r.severity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:#6b7a99;">${r.detectedAt}</td>
        </tr>`,
      )
      .join("");

    const criticalCount = rows.filter((r) => r.severity === "critical").length;
    const headline =
      criticalCount > 0
        ? `${criticalCount} coverage issue${criticalCount === 1 ? "" : "s"} need attention`
        : `${rows.length} coverage update${rows.length === 1 ? "" : "s"} this week`;

    const html = wrapInLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">Weekly coverage change digest</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">${headline} across your financed portfolio.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Borrower</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Change</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Severity</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Detected</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7a99;line-height:1.5;">
        Review these borrowers in your dashboard: ${DASHBOARD_URL}
      </p>`);

    const result = await sendGenericEmail(email, `Weekly coverage digest — ${headline}`, html);
    if (!result.success) {
      logger.warn("[lender-change-digest] send failed", { organizationId, error: result.error });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[lender-change-digest] unexpected error", {
      organizationId,
      error: String(err),
    });
    return false;
  }
}
