import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { admin, db } from "../config/firebase";
import { collections } from "../config/firestore";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth";
import { UserRole } from "../types/user";
import { ComplianceIssue, PolicyStatus, DashboardStatus, CoverageItem, CoverageDeductible, Policy } from "../types/policy";
import { SmsConsentStatus } from "../types/borrower";
import { extractInsuranceFromImage, ExtractedInsuranceData } from "../services/insurance-ocr";
import { sendSms, intakeRequestSmsText, isWithinSendingHours } from "../services/telnyx";
import { sendIntakeRequestEmail } from "../services/email";
import { logger } from "firebase-functions/v2";
import { DEMO_ORG_ID } from "../constants";
import { NotificationType, NotificationTrigger, NotificationStatus } from "../types/notification";

const INTAKE_URL_BASE = "https://app.autolientracker.com/intake";
const TOKEN_EXPIRY_DAYS = 7;

// ─── Shared Helper: Apply OCR fields to policy update ───────

function applyOcrToPolicy(
  extracted: ExtractedInsuranceData,
  policyUpdate: Record<string, unknown>,
  manualProvider?: string,
  manualPolicyNum?: string,
): boolean {
  if (extracted.confidence === "low") return false;

  // Basic fields
  if (!manualProvider && extracted.insuranceProvider) {
    policyUpdate.insuranceProvider = extracted.insuranceProvider;
  }
  if (!manualPolicyNum && extracted.policyNumber) {
    policyUpdate.policyNumber = extracted.policyNumber;
  }
  if (extracted.effectiveDate && extracted.expirationDate) {
    policyUpdate.coveragePeriod = {
      startDate: extracted.effectiveDate,
      endDate: extracted.expirationDate,
    };
  }
  if (extracted.insuredName) policyUpdate.ocrInsuredName = extracted.insuredName;
  if (extracted.vin) policyUpdate.ocrVin = extracted.vin;
  policyUpdate.ocrConfidence = extracted.confidence;

  // Policy type
  if (extracted.policyType) {
    policyUpdate.policyTypes = [extracted.policyType];
  }

  // Premium
  if (extracted.premiumAmount != null) {
    policyUpdate.premiumAmount = { currency: "USD", amount: extracted.premiumAmount };
  }

  // Payment frequency
  if (extracted.paymentFrequency) {
    policyUpdate.paymentFrequency = extracted.paymentFrequency;
  }

  // Lienholder
  if (extracted.lienholder?.name) {
    policyUpdate.isLienholderListed = true;
    policyUpdate.interestedParties = [{
      type: "LIEN_HOLDER",
      name: extracted.lienholder.name,
      ...(extracted.lienholder.address && { address: { addr1: extracted.lienholder.address } }),
    }];
  }

  // Coverage items (comprehensive, collision, etc.) with deductibles
  if (extracted.coverages && extracted.coverages.length > 0) {
    const coverageItems: CoverageItem[] = extracted.coverages.map((c) => {
      const deductibles: CoverageDeductible[] = [];
      if (c.deductible != null) {
        deductibles.push({ type: "STANDARD", amount: c.deductible, currency: "USD" });
      }
      return {
        type: c.type.toUpperCase(),
        limits: c.limit ? [{ type: "COMBINED", text: c.limit }] : [],
        deductibles,
      };
    });
    policyUpdate.coverageItems = coverageItems;
  }

  logger.info("[ocr] Extracted fields", {
    provider: extracted.insuranceProvider,
    hasPolicyNumber: !!extracted.policyNumber,
    hasEffective: !!extracted.effectiveDate,
    hasExpiration: !!extracted.expirationDate,
    hasLienholder: !!extracted.lienholder?.name,
    coverageCount: extracted.coverages?.length ?? 0,
    confidence: extracted.confidence,
  });

  return true;
}

function evaluateProvisionalCompliance(
  policyUpdate: Record<string, unknown>,
  existingPolicy: Policy | null,
  vehicleVin: string | null | undefined,
  hasCredentials: boolean,
  hasCard: boolean,
): void {
  const hasDates = !!policyUpdate.coveragePeriod;

  // Clear awaiting credentials if we got something useful
  if (hasCredentials || hasCard) {
    policyUpdate.awaitingCredentials = false;
  }

  // Check VIN
  let vinMismatch = false;
  if (policyUpdate.ocrVin && vehicleVin) {
    vinMismatch = String(policyUpdate.ocrVin).toUpperCase() !== String(vehicleVin).toUpperCase();
  }

  if (hasCredentials && hasDates) {
    // We have provider + policy# + dates → full provisional eval
    const endDate = new Date((policyUpdate.coveragePeriod as { endDate: string }).endDate);
    const datesValid = endDate.getTime() > Date.now();

    if (datesValid && !vinMismatch) {
      policyUpdate.status = PolicyStatus.PENDING_ACTIVATION;
      policyUpdate.complianceIssues = [ComplianceIssue.UNVERIFIED];
      policyUpdate.dashboardStatus = DashboardStatus.GREEN;
    } else if (vinMismatch) {
      policyUpdate.complianceIssues = [ComplianceIssue.VIN_MISMATCH, ComplianceIssue.UNVERIFIED];
      policyUpdate.dashboardStatus = DashboardStatus.RED;
    } else {
      policyUpdate.complianceIssues = [ComplianceIssue.COVERAGE_EXPIRED, ComplianceIssue.UNVERIFIED];
      policyUpdate.dashboardStatus = DashboardStatus.RED;
    }
  } else if (hasCredentials) {
    // Provider + policy# but no dates → still mark provisional GREEN (assume current)
    policyUpdate.status = PolicyStatus.PENDING_ACTIVATION;
    policyUpdate.complianceIssues = [ComplianceIssue.UNVERIFIED];
    policyUpdate.dashboardStatus = DashboardStatus.GREEN;
  } else if (hasCard) {
    // Card uploaded but no credentials extracted → remove AWAITING_CREDENTIALS only
    const currentIssues = ((existingPolicy?.complianceIssues ?? []) as string[]).filter(
      (i: string) => i !== ComplianceIssue.AWAITING_CREDENTIALS
    );
    policyUpdate.complianceIssues = currentIssues;
  }
}

// ─── Types ──────────────────────────────────────────────────

interface IntakeToken {
  token: string;
  borrowerId: string;
  vehicleId: string;
  policyId: string;
  organizationId: string;
  borrowerFirstName: string;
  vehicleLabel: string;
  dealershipName: string;
  status: "PENDING" | "COMPLETED" | "EXPIRED";
  expiresAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── requestBorrowerIntake ──────────────────────────────────

/**
 * Generates a magic-link intake token and sends an SMS to the borrower
 * asking them to provide their insurance carrier + policy number.
 *
 * Auth: Required (dealer admin/manager)
 */
export const requestBorrowerIntake = onCall(async (request) => {
  const { user } = await requireAuth(request);
  const data = request.data as {
    organizationId: string;
    borrowerId: string;
    vehicleId: string;
    policyId: string;
  };

  if (!data.organizationId || !data.borrowerId || !data.vehicleId || !data.policyId) {
    throw new HttpsError("invalid-argument", "organizationId, borrowerId, vehicleId, and policyId are required.");
  }

  requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
  requireOrg(user, data.organizationId);

  if (data.organizationId === DEMO_ORG_ID) {
    throw new HttpsError("permission-denied", "Intake requests are disabled for demo accounts.");
  }

  // Fetch borrower
  const borrowerDoc = await collections.borrowers.doc(data.borrowerId).get();
  if (!borrowerDoc.exists) {
    throw new HttpsError("not-found", "Borrower not found.");
  }
  const borrower = borrowerDoc.data()!;

  if (borrower.organizationId !== data.organizationId) {
    throw new HttpsError("permission-denied", "Borrower does not belong to this organization.");
  }

  // Fetch vehicle for label
  const vehicleDoc = await collections.vehicles.doc(data.vehicleId).get();
  if (!vehicleDoc.exists) {
    throw new HttpsError("not-found", "Vehicle not found.");
  }
  const vehicle = vehicleDoc.data()!;
  const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

  // Fetch org for dealership name + compliance timezone
  const orgDoc = await db.collection("organizations").doc(data.organizationId).get();
  const orgData = orgDoc.exists ? orgDoc.data() : null;
  const dealershipName = orgData?.name ?? "Your Lender";
  const orgTimezone: string | undefined = orgData?.settings?.complianceRules?.timezone;

  // Determine delivery channel: SMS preferred → email fallback.
  // SMS is further gated by TCPA-style quiet hours in the org's timezone.
  const hasSmsConsent =
    !!borrower.phone && borrower.smsConsentStatus === SmsConsentStatus.OPTED_IN;
  const withinHours = isWithinSendingHours(orgTimezone);
  const canSms = hasSmsConsent && withinHours;
  const smsSuppressedReason: "QUIET_HOURS" | null =
    hasSmsConsent && !withinHours ? "QUIET_HOURS" : null;
  const canEmail = !!borrower.email;

  if (!canSms && !canEmail) {
    throw new HttpsError(
      "failed-precondition",
      "Borrower has no reachable contact method. Add a phone number with SMS consent or an email address.",
    );
  }

  // Generate token
  const token = randomUUID();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const intakeToken: IntakeToken = {
    token,
    borrowerId: data.borrowerId,
    vehicleId: data.vehicleId,
    policyId: data.policyId,
    organizationId: data.organizationId,
    borrowerFirstName: borrower.firstName,
    vehicleLabel,
    dealershipName,
    status: "PENDING",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("intakeTokens").doc(token).set(intakeToken);

  // Deliver via both SMS + email when available (SMS may silently fail at carrier level without 10DLC)
  const intakeUrl = `${INTAKE_URL_BASE}?token=${token}`;
  let smsSent = false;
  let emailSent = false;
  let smsError: string | null = null;
  let emailError: string | null = null;

  if (canSms) {
    const smsText = intakeRequestSmsText(borrower.firstName, vehicleLabel, dealershipName, intakeUrl);
    const smsResult = await sendSms(borrower.phone!, smsText);
    smsSent = smsResult.success;
    if (!smsResult.success) {
      smsError = smsResult.error ?? "SMS send failed";
    }
  }

  if (canEmail) {
    const emailResult = await sendIntakeRequestEmail({
      to: borrower.email!,
      borrowerName: borrower.firstName,
      vehicleLabel,
      dealershipName,
      intakeUrl,
    });
    emailSent = emailResult.success;
    if (!emailResult.success) {
      emailError = emailResult.error ?? "Email send failed";
    }
  }

  const delivered = smsSent || emailSent;
  const deliveryMethod = smsSent && emailSent ? "both" : emailSent ? "email" : "sms";

  if (!delivered) {
    logger.error("[intake] Delivery failed", { borrowerId: data.borrowerId, smsError, emailError });
  }

  logger.info("[intake] Token created and notification sent", {
    token,
    borrowerId: data.borrowerId,
    deliveryMethod,
    smsSent,
    emailSent,
  });

  // Log notification for Verifications tab
  const channelType = smsSent ? NotificationType.SMS : NotificationType.EMAIL;
  const notifStatus = delivered ? NotificationStatus.SENT : NotificationStatus.FAILED;
  await collections.notifications.doc().set({
    organizationId: data.organizationId,
    borrowerId: data.borrowerId,
    type: channelType,
    trigger: NotificationTrigger.INTAKE_REQUESTED,
    status: notifStatus,
    content: `Insurance verification request sent to ${borrower.firstName} ${borrower.lastName}`,
    createdAt: now,
    ...(delivered && { sentAt: now }),
    ...(!delivered && { errorCode: emailError ?? smsError ?? "Delivery failed" }),
  });

  return {
    token,
    intakeUrl,
    deliveryMethod,
    delivered,
    deliveryError: delivered ? null : (emailError ?? smsError),
    smsSuppressedReason,
    complianceTimezone: orgTimezone ?? null,
  };
});

// ─── getIntakeInfo ──────────────────────────────────────────

/**
 * Public function — returns minimal, non-sensitive info for the intake page.
 * Only returns first name, vehicle label, and dealership name.
 * No auth required (borrower accesses via magic link).
 */
export const getIntakeInfo = onCall(async (request) => {
  const data = request.data as { token: string };

  if (!data.token) {
    throw new HttpsError("invalid-argument", "token is required.");
  }

  const tokenDoc = await db.collection("intakeTokens").doc(data.token).get();
  if (!tokenDoc.exists) {
    throw new HttpsError("not-found", "Invalid or expired link.");
  }

  const tokenData = tokenDoc.data() as IntakeToken;

  if (tokenData.status === "COMPLETED") {
    const orgDoc = await collections.organizations.doc(tokenData.organizationId).get();
    const dealershipName = orgDoc.exists ? (orgDoc.data()?.name ?? tokenData.dealershipName) : tokenData.dealershipName;
    return {
      status: "COMPLETED",
      borrowerFirstName: tokenData.borrowerFirstName,
      vehicleLabel: tokenData.vehicleLabel,
      dealershipName,
    };
  }

  if (tokenData.expiresAt.toMillis() < Date.now()) {
    await tokenDoc.ref.update({ status: "EXPIRED", updatedAt: Timestamp.now() });
    throw new HttpsError("deadline-exceeded", "This link has expired. Please contact your lender for a new one.");
  }

  const orgDoc = await collections.organizations.doc(tokenData.organizationId).get();
  const dealershipName = orgDoc.exists ? (orgDoc.data()?.name ?? tokenData.dealershipName) : tokenData.dealershipName;

  return {
    status: "PENDING",
    borrowerFirstName: tokenData.borrowerFirstName,
    vehicleLabel: tokenData.vehicleLabel,
    dealershipName,
  };
});

// ─── submitBorrowerIntake ───────────────────────────────────

/**
 * Public function — borrower submits their insurance info via the magic link.
 * Accepts carrier + policy number, or a base64-encoded photo of their insurance card.
 * No auth required.
 */
export const submitBorrowerIntake = onCall(
  { timeoutSeconds: 60 },
  async (request) => {
    const data = request.data as {
      token: string;
      insuranceProvider?: string;
      policyNumber?: string;
      insuranceCardBase64?: string;
    };

    if (!data.token) {
      throw new HttpsError("invalid-argument", "token is required.");
    }

    if (!data.insuranceProvider && !data.policyNumber && !data.insuranceCardBase64) {
      throw new HttpsError("invalid-argument", "Please provide your insurance carrier and policy number, or upload a photo of your insurance card.");
    }

    const tokenDoc = await db.collection("intakeTokens").doc(data.token).get();
    if (!tokenDoc.exists) {
      throw new HttpsError("not-found", "Invalid or expired link.");
    }

    const tokenData = tokenDoc.data() as IntakeToken;

    if (tokenData.status === "COMPLETED") {
      throw new HttpsError("already-exists", "Your insurance info has already been submitted. Thank you!");
    }

    if (tokenData.expiresAt.toMillis() < Date.now()) {
      await tokenDoc.ref.update({ status: "EXPIRED", updatedAt: Timestamp.now() });
      throw new HttpsError("deadline-exceeded", "This link has expired. Please contact your lender for a new one.");
    }

    const now = Timestamp.now();
    const policyUpdate: Record<string, unknown> = { updatedAt: now };

    // Update policy with carrier info
    if (data.insuranceProvider) {
      policyUpdate.insuranceProvider = data.insuranceProvider;
    }
    if (data.policyNumber) {
      policyUpdate.policyNumber = data.policyNumber;
    }

    // Detect content type from base64 data URI prefix or default to jpeg
    let cardContentType = "image/jpeg";
    let ext = "jpg";
    if (data.insuranceCardBase64) {
      if (data.insuranceCardBase64.startsWith("/9j/")) {
        cardContentType = "image/jpeg"; ext = "jpg";
      } else if (data.insuranceCardBase64.startsWith("iVBOR")) {
        cardContentType = "image/png"; ext = "png";
      } else if (data.insuranceCardBase64.startsWith("JVBER")) {
        cardContentType = "application/pdf"; ext = "pdf";
      } else if (data.insuranceCardBase64.startsWith("R0lGO")) {
        cardContentType = "image/gif"; ext = "gif";
      }
    }

    // Handle insurance card photo upload
    if (data.insuranceCardBase64) {
      const bucket = admin.storage().bucket("insurance-track-os-cards");
      const filePath = `insurance-cards/${tokenData.organizationId}/${tokenData.policyId}/card.${ext}`;
      const file = bucket.file(filePath);

      const imageBuffer = Buffer.from(data.insuranceCardBase64, "base64");
      await file.save(imageBuffer, {
        metadata: { contentType: cardContentType },
      });

      // Generate a signed URL valid for 1 year
      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });

      policyUpdate.insuranceCardUrl = signedUrl;
    }

    // ─── OCR extraction from uploaded card ─────────────────
    let ocrExtracted = false;
    if (data.insuranceCardBase64) {
      const extracted = await extractInsuranceFromImage(data.insuranceCardBase64, cardContentType);
      ocrExtracted = applyOcrToPolicy(extracted, policyUpdate, data.insuranceProvider, data.policyNumber);
    }

    // ─── Provisional compliance evaluation ──────────────────
    const hasCredentials = !!(policyUpdate.insuranceProvider && policyUpdate.policyNumber);
    const hasCard = !!data.insuranceCardBase64;

    const policyDoc = await collections.policies.doc(tokenData.policyId).get();
    const existingPolicy = policyDoc.exists ? policyDoc.data() ?? null : null;

    const vehicleDoc = await collections.vehicles.doc(tokenData.vehicleId).get();
    const vehicleVin = vehicleDoc.exists ? vehicleDoc.data()?.vin : null;

    evaluateProvisionalCompliance(policyUpdate, existingPolicy, vehicleVin, hasCredentials, hasCard);

    // Update policy
    await collections.policies.doc(tokenData.policyId).update(policyUpdate);

    // Mark token as completed
    await tokenDoc.ref.update({
      status: "COMPLETED",
      updatedAt: now,
    });

    logger.info("[intake] Borrower submitted insurance info", {
      token: data.token,
      borrowerId: tokenData.borrowerId,
      policyId: tokenData.policyId,
      hasProvider: !!policyUpdate.insuranceProvider,
      hasPolicyNumber: !!policyUpdate.policyNumber,
      hasPhoto: hasCard,
      ocrExtracted,
      newStatus: policyUpdate.status,
      newDashboard: policyUpdate.dashboardStatus,
    });

    // Log completion notification for Verifications tab
    const provider = policyUpdate.insuranceProvider as string | undefined;
    const policyNum = policyUpdate.policyNumber as string | undefined;
    const contentParts = ["Borrower submitted insurance via intake link"];
    if (provider) contentParts.push(`— ${provider}`);
    if (policyNum) contentParts.push(`#${policyNum}`);
    await collections.notifications.doc().set({
      organizationId: tokenData.organizationId,
      borrowerId: tokenData.borrowerId,
      type: NotificationType.PORTAL,
      trigger: NotificationTrigger.INTAKE_COMPLETED,
      status: NotificationStatus.COMPLETED,
      content: contentParts.join(" "),
      createdAt: now,
    });

    return { success: true };
  }
);

// ─── dealerSubmitInsurance ──────────────────────────────────

/**
 * Authenticated function — dealer/lender submits insurance info on behalf
 * of a borrower.  Accepts carrier + policy number, and/or a base64
 * insurance card photo.  Runs the same OCR + provisional compliance
 * evaluation as the borrower intake flow.
 */
export const dealerSubmitInsurance = onCall(
  { timeoutSeconds: 60 },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as {
      organizationId: string;
      policyId: string;
      vehicleId: string;
      insuranceProvider?: string;
      policyNumber?: string;
      insuranceCardBase64?: string;
    };

    if (!data.organizationId || !data.policyId || !data.vehicleId) {
      throw new HttpsError("invalid-argument", "organizationId, policyId, and vehicleId are required.");
    }

    if (!data.insuranceProvider && !data.policyNumber && !data.insuranceCardBase64) {
      throw new HttpsError("invalid-argument", "Please provide carrier name, policy number, or upload an insurance card.");
    }

    requireRole(user, UserRole.ADMIN, UserRole.MANAGER);
    requireOrg(user, data.organizationId);

    const policyDoc = await collections.policies.doc(data.policyId).get();
    if (!policyDoc.exists) {
      throw new HttpsError("not-found", "Policy not found.");
    }
    const existingPolicy = policyDoc.data()!;
    if (existingPolicy.organizationId !== data.organizationId) {
      throw new HttpsError("permission-denied", "Policy does not belong to this organization.");
    }

    const now = Timestamp.now();
    const policyUpdate: Record<string, unknown> = { updatedAt: now };

    if (data.insuranceProvider) policyUpdate.insuranceProvider = data.insuranceProvider;
    if (data.policyNumber) policyUpdate.policyNumber = data.policyNumber;

    // Detect content type
    let cardContentType = "image/jpeg";
    let ext = "jpg";
    if (data.insuranceCardBase64) {
      if (data.insuranceCardBase64.startsWith("/9j/")) { cardContentType = "image/jpeg"; ext = "jpg"; }
      else if (data.insuranceCardBase64.startsWith("iVBOR")) { cardContentType = "image/png"; ext = "png"; }
      else if (data.insuranceCardBase64.startsWith("JVBER")) { cardContentType = "application/pdf"; ext = "pdf"; }
      else if (data.insuranceCardBase64.startsWith("R0lGO")) { cardContentType = "image/gif"; ext = "gif"; }
    }

    // Upload card
    if (data.insuranceCardBase64) {
      const bucket = admin.storage().bucket("insurance-track-os-cards");
      const filePath = `insurance-cards/${data.organizationId}/${data.policyId}/card.${ext}`;
      const file = bucket.file(filePath);
      const imageBuffer = Buffer.from(data.insuranceCardBase64, "base64");
      await file.save(imageBuffer, { metadata: { contentType: cardContentType } });
      const [signedUrl] = await file.getSignedUrl({ action: "read", expires: Date.now() + 365 * 24 * 60 * 60 * 1000 });
      policyUpdate.insuranceCardUrl = signedUrl;
    }

    // OCR extraction
    let ocrExtracted = false;
    if (data.insuranceCardBase64) {
      const extracted = await extractInsuranceFromImage(data.insuranceCardBase64, cardContentType);
      ocrExtracted = applyOcrToPolicy(extracted, policyUpdate, data.insuranceProvider, data.policyNumber);
    }

    // Provisional compliance evaluation
    const hasCredentials = !!(policyUpdate.insuranceProvider && policyUpdate.policyNumber);
    const hasCard = !!data.insuranceCardBase64;

    const vehicleDoc = await collections.vehicles.doc(data.vehicleId).get();
    const vehicleVin = vehicleDoc.exists ? vehicleDoc.data()?.vin : null;

    evaluateProvisionalCompliance(policyUpdate, existingPolicy, vehicleVin, hasCredentials, hasCard);

    await collections.policies.doc(data.policyId).update(policyUpdate);

    logger.info("[dealer-submit] Insurance info submitted by dealer", {
      policyId: data.policyId,
      hasProvider: !!policyUpdate.insuranceProvider,
      hasPolicyNumber: !!policyUpdate.policyNumber,
      hasCard,
      ocrExtracted,
      newStatus: policyUpdate.status,
      newDashboard: policyUpdate.dashboardStatus,
    });

    // Log dealer submission for Verifications tab
    const dealerProvider = (policyUpdate.insuranceProvider as string) ?? data.insuranceProvider;
    const dealerPolicyNum = (policyUpdate.policyNumber as string) ?? data.policyNumber;
    const dealerContentParts = ["Insurance submitted by dealer"];
    if (dealerProvider) dealerContentParts.push(`— ${dealerProvider}`);
    if (dealerPolicyNum) dealerContentParts.push(`#${dealerPolicyNum}`);
    if (ocrExtracted) dealerContentParts.push("(OCR extracted)");
    await collections.notifications.doc().set({
      organizationId: data.organizationId,
      borrowerId: existingPolicy.borrowerId,
      type: NotificationType.PORTAL,
      trigger: NotificationTrigger.DEALER_SUBMITTED,
      status: NotificationStatus.COMPLETED,
      content: dealerContentParts.join(" "),
      createdAt: now,
    });

    return {
      success: true,
      ocrExtracted,
      provider: policyUpdate.insuranceProvider as string | undefined,
      policyNumber: policyUpdate.policyNumber as string | undefined,
    };
  }
);
