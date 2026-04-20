import { defineString } from "firebase-functions/params";
import { Resend } from "resend";

const resendApiKey = defineString("RESEND_API_KEY");
const fromEmail = defineString("EMAIL_FROM_ADDRESS", {
  default: "AutoLienTracker <noreply@autolientracker.com>",
});

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    resendInstance = new Resend(resendApiKey.value());
  }
  return resendInstance;
}

// ─── Shared email layout ────────────────────────────────────────

function layoutHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c1222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0c1222;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#131b2e;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
        <!-- Logo -->
        <tr><td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Auto<span style="color:#3b82f6;">Lien</span>Tracker</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">${body}</td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:#6b7a99;line-height:1.5;">
            This is an automated message from AutoLienTracker. Please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Email templates ────────────────────────────────────────────

function verificationEmailHtml(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  verificationUrl: string,
): string {
  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      Insurance Verification Required
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Hi ${borrowerName}, your dealership <strong style="color:#ffffff;">${dealershipName}</strong>
      needs to verify the insurance on your vehicle.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
      <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${vehicleLabel}</p>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Click the button below to securely verify your insurance. It takes less than 2 minutes.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#3b82f6;border-radius:10px;">
        <a href="${verificationUrl}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
          Verify My Insurance
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.5;">
      If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${verificationUrl}" style="color:#3b82f6;word-break:break-all;">${verificationUrl}</a>
    </p>
  `);
}

function reminderEmailHtml(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  daysUntilExpiry: number,
  verificationUrl: string,
): string {
  const urgency = daysUntilExpiry <= 3
    ? `<span style="color:#ef4444;font-weight:600;">expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}</span>`
    : `expires in <strong style="color:#ffffff;">${daysUntilExpiry} days</strong>`;

  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      Insurance Expiring Soon
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Hi ${borrowerName}, the insurance on your vehicle ${urgency}.
      <strong style="color:#ffffff;">${dealershipName}</strong> requires active coverage at all times.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
      <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${vehicleLabel}</p>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Please update or re-verify your insurance before it lapses.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#3b82f6;border-radius:10px;">
        <a href="${verificationUrl}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
          Update My Insurance
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.5;">
      If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${verificationUrl}" style="color:#3b82f6;word-break:break-all;">${verificationUrl}</a>
    </p>
  `);
}

// ─── Public API ─────────────────────────────────────────────────

const issueLabels: Record<string, string> = {
  MISSING_LIENHOLDER: "Lienholder not listed on policy",
  NO_COMPREHENSIVE: "Comprehensive coverage missing",
  NO_COLLISION: "Collision coverage missing",
  DEDUCTIBLE_TOO_HIGH: "Deductible exceeds maximum allowed",
  POLICY_CANCELLED: "Policy has been cancelled",
  POLICY_EXPIRED: "Policy has expired",
  PENDING_CANCELLATION: "Policy is pending cancellation",
  VIN_MISMATCH: "VIN does not match records",
  VEHICLE_REMOVED: "Vehicle removed from policy",
  COVERAGE_EXPIRED: "Coverage period has expired",
  EXPIRING_SOON: "Coverage is expiring soon",
  UNVERIFIED: "Insurance not yet verified",
};

function complianceAlertBorrowerHtml(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  issues: string[],
): string {
  const issueRows = issues
    .map((issue) => {
      const label = issueLabels[issue] ?? issue;
      return `<tr><td style="padding:8px 12px;font-size:13px;color:#ef4444;border-bottom:1px solid rgba(255,255,255,0.04);">⚠ ${label}</td></tr>`;
    })
    .join("");

  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      Insurance Compliance Issue Detected
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Hi ${borrowerName}, we detected a change to the insurance on your vehicle that
      no longer meets the requirements set by <strong style="color:#ffffff;">${dealershipName}</strong>.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:16px;">
      <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
      <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${vehicleLabel}</p>
    </div>
    <div style="background:#0c1222;border:1px solid rgba(239,68,68,0.2);border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <div style="padding:10px 12px;background:rgba(239,68,68,0.08);border-bottom:1px solid rgba(239,68,68,0.15);">
        <p style="margin:0;font-size:12px;color:#ef4444;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Issues Found</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">${issueRows}</table>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Please contact your insurance provider to update your coverage, then re-verify
      with ${dealershipName}. Failure to maintain proper coverage may result in the
      dealership placing force-placed insurance on your vehicle.
    </p>
  `);
}

function complianceAlertDealerHtml(
  borrowerName: string,
  vehicleLabel: string,
  issues: string[],
  borrowerEmail: string,
): string {
  const issueRows = issues
    .map((issue) => {
      const label = issueLabels[issue] ?? issue;
      return `<tr><td style="padding:8px 12px;font-size:13px;color:#ef4444;border-bottom:1px solid rgba(255,255,255,0.04);">⚠ ${label}</td></tr>`;
    })
    .join("");

  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      Compliance Alert: ${borrowerName}
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      A policy change was detected that puts this borrower out of compliance.
      <strong style="color:#ffffff;">We have automatically notified the borrower</strong> at
      <span style="color:#3b82f6;">${borrowerEmail}</span> to rectify the issue.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:16px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:24px;">
            <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Borrower</p>
            <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${borrowerName}</p>
          </td>
          <td>
            <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
            <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${vehicleLabel}</p>
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#0c1222;border:1px solid rgba(239,68,68,0.2);border-radius:12px;overflow:hidden;margin-bottom:24px;">
      <div style="padding:10px 12px;background:rgba(239,68,68,0.08);border-bottom:1px solid rgba(239,68,68,0.15);">
        <p style="margin:0;font-size:12px;color:#ef4444;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Compliance Issues</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">${issueRows}</table>
    </div>
    <p style="margin:0;font-size:13px;color:#8b9dc3;line-height:1.6;">
      No action is needed from you at this time. The borrower has been instructed to
      update their coverage. You can monitor their status on your
      <strong style="color:#ffffff;">AutoLienTracker dashboard</strong>.
    </p>
  `);
}

export interface SendVerificationEmailInput {
  to: string;
  borrowerName: string;
  vehicleLabel: string;
  dealershipName: string;
  verificationUrl: string;
}

export interface SendReminderEmailInput {
  to: string;
  borrowerName: string;
  vehicleLabel: string;
  dealershipName: string;
  daysUntilExpiry: number;
  verificationUrl: string;
}

export interface EmailResult {
  id: string;
  success: boolean;
  error?: string;
}

export async function sendVerificationEmail(
  input: SendVerificationEmailInput,
): Promise<EmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.to,
    subject: `Verify your insurance – ${input.vehicleLabel}`,
    html: verificationEmailHtml(
      input.borrowerName,
      input.vehicleLabel,
      input.dealershipName,
      input.verificationUrl,
    ),
  });

  if (error) {
    return { id: "", success: false, error: error.message };
  }
  return { id: data?.id ?? "", success: true };
}

export async function sendReminderEmail(
  input: SendReminderEmailInput,
): Promise<EmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.to,
    subject: `⚠️ Insurance expiring in ${input.daysUntilExpiry} days – ${input.vehicleLabel}`,
    html: reminderEmailHtml(
      input.borrowerName,
      input.vehicleLabel,
      input.dealershipName,
      input.daysUntilExpiry,
      input.verificationUrl,
    ),
  });

  if (error) {
    return { id: "", success: false, error: error.message };
  }
  return { id: data?.id ?? "", success: true };
}

// ─── Compliance Alert Emails ────────────────────────────────────

export interface SendComplianceAlertInput {
  borrowerEmail: string;
  borrowerName: string;
  vehicleLabel: string;
  dealershipName: string;
  dealerEmail: string;
  issues: string[];
}

export async function sendComplianceAlertEmails(
  input: SendComplianceAlertInput,
): Promise<{ borrowerResult: EmailResult; dealerResult: EmailResult }> {
  const resend = getResend();

  // 1. Email to borrower
  const { data: bData, error: bError } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.borrowerEmail,
    subject: `⚠️ Insurance compliance issue – ${input.vehicleLabel}`,
    html: complianceAlertBorrowerHtml(
      input.borrowerName,
      input.vehicleLabel,
      input.dealershipName,
      input.issues,
    ),
  });

  const borrowerResult: EmailResult = bError
    ? { id: "", success: false, error: bError.message }
    : { id: bData?.id ?? "", success: true };

  // 2. Email to dealer/lender
  const { data: dData, error: dError } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.dealerEmail,
    subject: `Compliance Alert: ${input.borrowerName} – ${input.vehicleLabel}`,
    html: complianceAlertDealerHtml(
      input.borrowerName,
      input.vehicleLabel,
      input.issues,
      input.borrowerEmail,
    ),
  });

  const dealerResult: EmailResult = dError
    ? { id: "", success: false, error: dError.message }
    : { id: dData?.id ?? "", success: true };

  return { borrowerResult, dealerResult };
}

// ─── Intake Request Email ───────────────────────────────────────

function intakeRequestEmailHtml(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  intakeUrl: string,
): string {
  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      Insurance Information Needed
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Hi ${borrowerName}, <strong style="color:#ffffff;">${dealershipName}</strong>
      needs to update the insurance file for your vehicle.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</p>
      <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${vehicleLabel}</p>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Click the button below to securely submit your insurance details. It only takes a minute.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#3b82f6;border-radius:10px;">
        <a href="${intakeUrl}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
          Submit Insurance Info
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.5;">
      This link expires in 7 days. If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${intakeUrl}" style="color:#3b82f6;word-break:break-all;">${intakeUrl}</a>
    </p>
  `);
}

export interface SendIntakeRequestEmailInput {
  to: string;
  borrowerName: string;
  vehicleLabel: string;
  dealershipName: string;
  intakeUrl: string;
}

export async function sendIntakeRequestEmail(
  input: SendIntakeRequestEmailInput,
): Promise<EmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.to,
    subject: `Action needed: Submit your insurance info – ${input.vehicleLabel}`,
    html: intakeRequestEmailHtml(
      input.borrowerName,
      input.vehicleLabel,
      input.dealershipName,
      input.intakeUrl,
    ),
  });

  if (error) {
    return { id: "", success: false, error: error.message };
  }
  return { id: data?.id ?? "", success: true };
}

// ─── Team Invite Email ──────────────────────────────────────────

function teamInviteHtml(
  inviterName: string,
  organizationName: string,
  role: string,
  inviteUrl: string,
): string {
  const roleLabel = role === "MANAGER" ? "Manager" : "Viewer";
  return layoutHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff;">
      You've Been Invited
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      <strong style="color:#ffffff;">${inviterName}</strong> has invited you to join
      <strong style="color:#ffffff;">${organizationName}</strong> on AutoLienTracker
      as a <strong style="color:#3b82f6;">${roleLabel}</strong>.
    </p>
    <div style="background:#0c1222;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:24px;">
            <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Organization</p>
            <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${organizationName}</p>
          </td>
          <td>
            <p style="margin:0;font-size:12px;color:#6b7a99;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
            <p style="margin:4px 0 0;font-size:15px;color:#ffffff;font-weight:500;">${roleLabel}</p>
          </td>
        </tr>
      </table>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#8b9dc3;line-height:1.6;">
      Click the button below to accept the invitation and create your account.
      This invite expires in 7 days.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr><td style="background:#3b82f6;border-radius:10px;">
        <a href="${inviteUrl}" target="_blank"
           style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
          Accept Invitation
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.5;">
      If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${inviteUrl}" style="color:#3b82f6;word-break:break-all;">${inviteUrl}</a>
    </p>
  `);
}

export interface SendTeamInviteEmailInput {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}

export async function sendTeamInviteEmail(
  input: SendTeamInviteEmailInput,
): Promise<EmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: input.to,
    subject: `You're invited to join ${input.organizationName} on AutoLienTracker`,
    html: teamInviteHtml(
      input.inviterName,
      input.organizationName,
      input.role,
      input.inviteUrl,
    ),
  });

  if (error) {
    return { id: "", success: false, error: error.message };
  }
  return { id: data?.id ?? "", success: true };
}

// ─── Admin alert emails ─────────────────────────────────────────

const ADMIN_EMAIL = "anknarsi@gmail.com";

function adminAlertHtml(title: string, details: string): string {
  return layoutHtml(`
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#ffffff;">${title}</h2>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:16px;">
      ${details}
    </div>
    <p style="margin:0;font-size:13px;color:#8896b3;">
      This is an automated admin alert from your AutoLienTracker platform.
    </p>
  `);
}

export async function sendAdminAlertEmail(
  subject: string,
  title: string,
  details: string,
): Promise<EmailResult> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: fromEmail.value(),
    to: ADMIN_EMAIL,
    subject: `[ALT Admin] ${subject}`,
    html: adminAlertHtml(title, details),
  });

  if (error) {
    console.error("Failed to send admin alert email:", error.message);
    return { id: "", success: false, error: error.message };
  }
  return { id: data?.id ?? "", success: true };
}
