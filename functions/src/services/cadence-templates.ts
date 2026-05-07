/**
 * Cadence message templates — email + SMS for the borrower communication
 * cadence (lapse and coverage escalation notices).
 *
 * Spec: docs/superpowers/specs/2026-04-26-borrower-communication-cadence-design.md
 */
import { defineString } from "firebase-functions/params";
import { Resend } from "resend";

const resendApiKey = defineString("RESEND_API_KEY");
const fromEmail = defineString("EMAIL_FROM_ADDRESS", {
  default: "AutoLienTracker <noreply@autolientracker.com>",
});

let resendInstance: Resend | null = null;
function getResend(): Resend {
  if (!resendInstance) resendInstance = new Resend(resendApiKey.value());
  return resendInstance;
}

export interface EmailResult {
  id: string;
  success: boolean;
  error?: string;
}

// ─── Shared layout (matches existing email.ts styling) ──────────

function layoutHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c1222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0c1222;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#131b2e;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Auto<span style="color:#3b82f6;">Lien</span>Tracker</span>
        </td></tr>
        <tr><td style="padding:32px 40px;">${body}</td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:#6b7a99;line-height:1.5;">
            This is an automated message regarding your auto loan insurance requirement. Please do not reply.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Stage definitions ──────────────────────────────────────────

export type CadenceStage =
  | "LAPSED_SECOND_NOTICE"
  | "LAPSED_FINAL_NOTICE"
  | "LAPSE_CURED"
  | "COVERAGE_FIRST_NOTICE"
  | "COVERAGE_SECOND_NOTICE"
  | "COVERAGE_FINAL_NOTICE"
  | "COVERAGE_CURED";

export interface CadenceMessageInput {
  to: string;
  borrowerName: string;
  vehicleLabel: string;
  dealershipName: string;
  /** ISO date string of when the lapse/issue was first detected. */
  detectedDate?: string;
  /** Comma-separated human-readable issue list (coverage cadence only). */
  issueSummary?: string;
  /** Action URL — intake link or proof upload page. */
  actionUrl: string;
}

interface StageCopy {
  subject: (i: CadenceMessageInput) => string;
  body: (i: CadenceMessageInput) => string;        // HTML body (sits inside layout)
  sms: (i: CadenceMessageInput) => string;
}

const cta = (url: string, label: string) => `
  <table cellpadding="0" cellspacing="0" style="margin:20px 0 24px;">
    <tr><td style="background:#3b82f6;border-radius:10px;">
      <a href="${url}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
        ${label}
      </a>
    </td></tr>
  </table>`;

const vehicleCard = (label: string) => `
  <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
    <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
    <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${label}</p>
  </div>`;

const finalNoticeWarningBlock = (lender: string) => `
  <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;">
      Final Notice
    </p>
    <p style="margin:0;font-size:14px;color:#ffffff;line-height:1.6;">
      If proof of compliant coverage is not received promptly,
      <strong>${lender}</strong> may exercise its rights under your loan agreement, which can include:
    </p>
    <ul style="margin:12px 0 0;padding-left:20px;font-size:14px;color:#ffffff;line-height:1.7;">
      <li>Force-placing insurance at your expense (typically adds <strong>$1,500&ndash;$3,000/yr</strong> to your loan), or</li>
      <li>Repossession of the vehicle.</li>
    </ul>
  </div>`;

const STAGE_COPY: Record<CadenceStage, StageCopy> = {
  // ─── Lapse cadence ─────────────────────────────────────────────
  LAPSED_SECOND_NOTICE: {
    subject: (i) =>
      `Second notice: Insurance lapse on your ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
        Second Notice — Insurance Lapse
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, we still have not received proof of active auto insurance for your vehicle.
        Your loan agreement with <strong style="color:#ffffff;">${i.dealershipName}</strong> requires
        continuous coverage.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      <p style="margin:0 0 8px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Please send your current declarations page or proof of insurance as soon as possible to avoid
        further action.
      </p>
      ${cta(i.actionUrl, "Submit Proof of Insurance")}`,
    sms: (i) =>
      `${i.dealershipName}: Second notice — we still don't have proof of insurance for your ${i.vehicleLabel}. ` +
      `Submit it now: ${i.actionUrl}\n\nReply STOP to opt out.`,
  },
  LAPSED_FINAL_NOTICE: {
    subject: (i) =>
      `FINAL NOTICE: Insurance required on your ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ef4444;">
        Final Notice — Action Required
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, your loan agreement with <strong style="color:#ffffff;">${i.dealershipName}</strong>
        requires you to maintain continuous auto insurance. Our records show your coverage has been lapsed
        and we have not received proof of new insurance despite previous notices.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      ${finalNoticeWarningBlock(i.dealershipName)}
      <p style="margin:0;font-size:14px;color:#8b9dc3;line-height:1.6;">
        To resolve this, submit your current declarations page immediately:
      </p>
      ${cta(i.actionUrl, "Submit Proof Now")}`,
    sms: (i) =>
      `${i.dealershipName}: FINAL NOTICE — Insurance required on your ${i.vehicleLabel}. ` +
      `Without proof, lender may force-place insurance or repossess. Act now: ${i.actionUrl}\n\nReply STOP to opt out.`,
  },
  LAPSE_CURED: {
    subject: (i) => `Insurance confirmed — ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#10b981;">
        You're all set
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, we've confirmed active insurance coverage on your vehicle. Thanks for resolving
        this promptly. <strong style="color:#ffffff;">${i.dealershipName}</strong> has been notified that your
        loan is back in good standing.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      <p style="margin:0;font-size:13px;color:#6b7a99;line-height:1.5;">
        Remember to keep your coverage active and your lender listed on the policy. We'll continue to monitor
        your policy and notify you before any future expirations.
      </p>`,
    sms: (i) =>
      `${i.dealershipName}: Insurance confirmed on your ${i.vehicleLabel}. Thanks — your loan is back in good standing.`,
  },

  // ─── Coverage cadence (active policy, but non-compliant) ─────
  COVERAGE_FIRST_NOTICE: {
    subject: (i) =>
      `Coverage update needed on your ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
        Coverage Update Needed
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, we noticed your insurance policy was updated. Your current coverage on your
        vehicle does not meet the requirements set in your loan agreement with
        <strong style="color:#ffffff;">${i.dealershipName}</strong>.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      ${i.issueSummary ? `
      <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;color:#ef4444;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Issues Found</p>
        <p style="margin:0;font-size:14px;color:#ffffff;line-height:1.6;">${i.issueSummary}</p>
      </div>` : ""}
      <p style="margin:0 0 8px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Please contact your insurance company to bring your policy back into compliance and send us
        your updated declarations page.
      </p>
      ${cta(i.actionUrl, "Submit Updated Policy")}`,
    sms: (i) =>
      `${i.dealershipName}: Your insurance was updated and no longer meets your loan's coverage requirements ` +
      `(${i.issueSummary ?? "see email"}). Send updated proof: ${i.actionUrl}\n\nReply STOP to opt out.`,
  },
  COVERAGE_SECOND_NOTICE: {
    subject: (i) =>
      `Second notice: Coverage update needed on your ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
        Second Notice — Coverage Update
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, we still have not received an updated policy that meets the coverage
        requirements in your loan agreement with <strong style="color:#ffffff;">${i.dealershipName}</strong>.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      ${i.issueSummary ? `
      <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;color:#ef4444;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Outstanding Issues</p>
        <p style="margin:0;font-size:14px;color:#ffffff;line-height:1.6;">${i.issueSummary}</p>
      </div>` : ""}
      <p style="margin:0 0 8px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Please contact your insurance company to correct these and send us your updated declarations page
        as soon as possible.
      </p>
      ${cta(i.actionUrl, "Submit Updated Policy")}`,
    sms: (i) =>
      `${i.dealershipName}: Second notice — your auto insurance still doesn't meet your loan requirements ` +
      `(${i.issueSummary ?? "see email"}). Update now: ${i.actionUrl}\n\nReply STOP to opt out.`,
  },
  COVERAGE_FINAL_NOTICE: {
    subject: (i) =>
      `FINAL NOTICE: Compliant insurance required on your ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ef4444;">
        Final Notice — Action Required
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, despite previous notices, your auto insurance still does not meet the
        requirements of your loan agreement with <strong style="color:#ffffff;">${i.dealershipName}</strong>.
      </p>
      ${vehicleCard(i.vehicleLabel)}
      ${i.issueSummary ? `
      <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:14px 18px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;color:#ef4444;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Outstanding Issues</p>
        <p style="margin:0;font-size:14px;color:#ffffff;line-height:1.6;">${i.issueSummary}</p>
      </div>` : ""}
      ${finalNoticeWarningBlock(i.dealershipName)}
      <p style="margin:0;font-size:14px;color:#8b9dc3;line-height:1.6;">
        To resolve this, contact your insurance company today and submit updated proof:
      </p>
      ${cta(i.actionUrl, "Submit Updated Policy")}`,
    sms: (i) =>
      `${i.dealershipName}: FINAL NOTICE — your insurance still doesn't meet loan requirements. ` +
      `Lender may force-place coverage or repossess. Act now: ${i.actionUrl}\n\nReply STOP to opt out.`,
  },
  COVERAGE_CURED: {
    subject: (i) => `Coverage confirmed — ${i.vehicleLabel}`,
    body: (i) => `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#10b981;">
        You're all set
      </h2>
      <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
        Hi ${i.borrowerName}, we've confirmed your updated policy meets the coverage requirements in your
        loan agreement. Thanks for resolving this. <strong style="color:#ffffff;">${i.dealershipName}</strong>
        has been notified that your loan is back in good standing.
      </p>
      ${vehicleCard(i.vehicleLabel)}`,
    sms: (i) =>
      `${i.dealershipName}: Your updated insurance on your ${i.vehicleLabel} now meets all loan requirements. Thanks!`,
  },
};

// ─── Public API ─────────────────────────────────────────────────

export async function sendCadenceEmail(
  stage: CadenceStage,
  input: CadenceMessageInput,
): Promise<EmailResult> {
  const copy = STAGE_COPY[stage];
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.to,
    subject: copy.subject(input),
    html: layoutHtml(copy.body(input)),
  });
  if (error) return { id: "", success: false, error: error.message };
  return { id: data?.id ?? "", success: true };
}

export function cadenceSmsText(
  stage: CadenceStage,
  input: CadenceMessageInput,
): string {
  return STAGE_COPY[stage].sms(input);
}
