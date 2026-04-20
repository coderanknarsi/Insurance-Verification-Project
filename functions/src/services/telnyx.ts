import { defineString } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

const telnyxApiKey = defineString("TELNYX_API_KEY");
const telnyxPhoneNumber = defineString("TELNYX_PHONE_NUMBER");
const telnyxMessagingProfileId = defineString("TELNYX_MESSAGING_PROFILE_ID", {
  default: "",
});

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export interface SmsSendResult {
  success: boolean;
  messageSid?: string;
  segments?: number;
  errorCode?: string;
  error?: string;
}

interface TelnyxMessageResponse {
  data: {
    id: string;
    record_type: string;
    parts: number;
    to: Array<{ phone_number: string; status: string }>;
  };
}

/**
 * Send an SMS message via Telnyx Messaging API v2.
 * Validates phone number format before sending.
 */
export async function sendSms(
  to: string,
  text: string,
): Promise<SmsSendResult> {
  // Normalize phone to E.164
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { success: false, error: "Invalid phone number format", errorCode: "INVALID_PHONE" };
  }

  if (text.length === 0 || text.length > 1600) {
    return { success: false, error: "Message must be 1–1600 characters", errorCode: "INVALID_LENGTH" };
  }

  const body: Record<string, string> = {
    from: telnyxPhoneNumber.value(),
    to: normalized,
    text,
  };

  const profileId = telnyxMessagingProfileId.value();
  if (profileId) {
    body.messaging_profile_id = profileId;
  }

  try {
    const resp = await fetch(`${TELNYX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${telnyxApiKey.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logger.error("Telnyx SMS send failed", { status: resp.status, body: errBody });
      return {
        success: false,
        error: `Telnyx API error (${resp.status})`,
        errorCode: `HTTP_${resp.status}`,
      };
    }

    const json = (await resp.json()) as TelnyxMessageResponse;
    return {
      success: true,
      messageSid: json.data.id,
      segments: json.data.parts ?? 1,
    };
  } catch (err) {
    logger.error("Telnyx SMS send exception", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
      errorCode: "EXCEPTION",
    };
  }
}

/**
 * Check whether sending SMS is allowed right now based on TCPA quiet hours.
 * Returns true if it's between 8 AM and 9 PM in the given IANA timezone.
 * Defaults to America/Chicago if timezone is not provided.
 */
export function isWithinSendingHours(timezone?: string): boolean {
  const tz = timezone || "America/Chicago";
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    return hour >= 8 && hour < 21; // 8 AM to 9 PM
  } catch {
    // If timezone is invalid, default to allowing (fail-open for this check)
    logger.warn(`Invalid timezone "${timezone}", defaulting to allow`);
    return true;
  }
}

/**
 * Normalize a US phone number to E.164 format (+1XXXXXXXXXX).
 * Returns null if the number can't be normalized.
 */
function normalizePhone(phone: string): string | null {
  // Strip non-digits
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // Already has country code with +
  if (phone.startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

// ─── SMS Templates ──────────────────────────────────────────────

export function expiryReminderSmsText(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  daysUntilExpiry: number,
  verificationUrl: string,
): string {
  return (
    `${dealershipName}: Hi ${borrowerName}, your insurance for ${vehicleLabel} ` +
    `expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}. ` +
    `Verify now: ${verificationUrl}\n\n` +
    `Reply STOP to opt out.`
  );
}

export function complianceAlertSmsText(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  issueCount: number,
): string {
  return (
    `${dealershipName}: Hi ${borrowerName}, we've detected ${issueCount} insurance ` +
    `compliance issue${issueCount === 1 ? "" : "s"} on your ${vehicleLabel}. ` +
    `Please update your coverage to avoid force-placed insurance. ` +
    `Contact us or check your email for details.\n\n` +
    `Reply STOP to opt out.`
  );
}

export function verificationRequestSmsText(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  verificationUrl: string,
): string {
  return (
    `${dealershipName}: Hi ${borrowerName}, please verify your insurance for ` +
    `${vehicleLabel}. It takes under 2 min: ${verificationUrl}\n\n` +
    `Reply STOP to opt out.`
  );
}

export function intakeRequestSmsText(
  borrowerName: string,
  vehicleLabel: string,
  dealershipName: string,
  intakeUrl: string,
): string {
  return (
    `${dealershipName}: Hi ${borrowerName}, we need to update your insurance file ` +
    `for your ${vehicleLabel}. Please tap here to securely submit your info: ${intakeUrl}\n\n` +
    `Reply STOP to opt out.`
  );
}
