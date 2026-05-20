import type { Page } from "playwright";
import type { CarrierModule, InputField } from "../types.js";
import type { AgentTask } from "../../agent/types.js";
import type { VerificationInput, VerificationResult } from "../../types/verification.js";
import type { CarrierCredentialPayload } from "../../types/credentials.js";
import { PolicyStatus } from "../../types/policy.js";
import {
  LOGIN_CONTEXT,
  NAVIGATE_TO_INQUIRY_CONTEXT,
  SEARCH_CONTEXT,
  AUTO_SELECTION_CONTEXT,
  EXTRACTION_CONTEXT,
  POLICY_EXTRACTION_SCHEMA,
} from "./prompts.js";

/**
 * State Farm B2B Portal carrier module.
 *
 * Flow: AI-driven login (with email MFA) → navigate to Insurance Inquiry Tool
 *       → VIN search → optional auto selection → extract policy details.
 *
 * This is an AI-only carrier (no direct HTTP API). The agent navigates the
 * full browser flow for every search, similar to National General.
 */
export class StateFarmModule implements CarrierModule {
  carrierId = "state_farm";
  carrierName = "State Farm";
  portalUrl = "https://apps.b2b.statefarm.com/login";

  requiredInputs: InputField[] = [
    {
      name: "vin",
      required: true,
      description: "Full 17-character Vehicle Identification Number",
    },
  ];

  buildLoginTasks(credentials: CarrierCredentialPayload): AgentTask[] {
    return [
      {
        carrierId: this.carrierId,
        goal: `Navigate to ${this.portalUrl} and log in with the B2B ID and password. Complete the email MFA verification step using FETCH_MFA_CODE with carrierId "state_farm" when prompted for a verification code.`,
        context:
          LOGIN_CONTEXT +
          `\n\nB2B ID: ${credentials.username}\nPassword: ${credentials.password}`,
      },
      {
        goal: `Navigate from the B2B portal homepage to the Insurance Inquiry Tool search page.`,
        context: NAVIGATE_TO_INQUIRY_CONTEXT,
      },
    ];
  }

  buildSearchTasks(input: VerificationInput): AgentTask[] {
    const tasks: AgentTask[] = [
      {
        goal: `If you are on an Auto Selection page with multiple vehicles, select the correct one. If you are already on the Policy Information page, report DONE immediately.`,
        context:
          AUTO_SELECTION_CONTEXT +
          `\n\nTarget VIN: ${input.vin}` +
          (input.borrowerLastName
            ? `\nTarget Borrower Last Name: ${input.borrowerLastName}`
            : ""),
      },
      {
        goal: "Extract all policy details from the current Policy Information page.",
        context: EXTRACTION_CONTEXT,
        extractionSchema: POLICY_EXTRACTION_SCHEMA,
      },
    ];
    return tasks;
  }

  async prepareSearch(page: Page, input: VerificationInput): Promise<void> {
    if (!page.url().includes("InsuranceInquiry/policySearch")) return;

    const vinInput = page.locator("#vinID").first();
    const searchButton = page.locator("#atpSearchButtonID").first();
    await vinInput.waitFor({ state: "visible", timeout: 15_000 });
    await searchButton.waitFor({ state: "visible", timeout: 15_000 });

    console.log(`[state-farm] Submitting Full VIN search for ${input.vin}`);
    await fillStateFarmVin(page, input.vin);
    await submitStateFarmSearch(page, "click");

    if (await isStillOnStateFarmSearchForm(page)) {
      console.warn("[state-farm] Search form still visible after button click; retrying with JS click + Enter");
      await fillStateFarmVin(page, input.vin);
      await submitStateFarmSearch(page, "js-click");
    }

    if (await isStillOnStateFarmSearchForm(page)) {
      await fillStateFarmVin(page, input.vin);
      await submitStateFarmSearch(page, "enter");
    }

    if (await hasNoStateFarmSearchResults(page)) {
      throw new Error(`State Farm returned no policy results for VIN ${input.vin}`);
    }

    if (await isStillOnStateFarmSearchForm(page)) {
      throw new Error("State Farm VIN search did not leave the Policy Search form after submit attempts");
    }
  }

  async isSessionActive(page: Page): Promise<boolean> {
    const url = page.url();

    // On login page means not authenticated
    if (
      url.includes("b2b-login-app") ||
      url.includes("/Login") ||
      url.includes("/login")
    ) {
      return false;
    }

    // If we're on a b2b.statefarm.com or the inquiry tool, we're likely logged in
    if (
      url.includes("b2b.statefarm.com") ||
      url.includes("InsuranceInquiry")
    ) {
      return true;
    }

    // Fallback: check for a logout link
    const logoutVisible = await page
      .locator("text=/log\\s*out|sign\\s*out/i")
      .first()
      .isVisible()
      .catch(() => false);
    return logoutVisible;
  }

  normalizeResult(
    input: VerificationInput,
    rawData: Record<string, unknown>
  ): VerificationResult {
    const status = mapPolicyStatus(rawData.policyStatus as string | undefined);

    // Coverages
    const coverages = [];
    if (rawData.hasCollision === true || rawData.hasCollision === "true") {
      coverages.push({
        type: "Collision",
        deductible: parseNumber(rawData.collisionDeductible),
      });
    }
    if (rawData.hasComprehensive === true || rawData.hasComprehensive === "true") {
      coverages.push({
        type: "Comprehensive",
        deductible: parseNumber(rawData.comprehensiveDeductible),
      });
    }
    // Bodily Injury + Property Damage → Liability
    const biLimit = parseNumber(rawData.bodilyInjuryLimitPerAccident);
    const pdLimit = parseNumber(rawData.propertyDamageLimitPerAccident);
    if (biLimit || pdLimit) {
      coverages.push({
        type: "Liability",
        limit: biLimit ?? pdLimit,
      });
    }

    // Lienholder / Interested Parties
    const interestedParties = [];
    if (rawData.lienholderName) {
      interestedParties.push({
        name: String(rawData.lienholderName),
        type: "LIEN_HOLDER",
        address: rawData.lienholderAddress
          ? { addr1: String(rawData.lienholderAddress) }
          : undefined,
      });
    }

    // Loss Payee flag: "Yes" means lienholder is properly listed
    const lossPaye = String(rawData.lossPaye ?? "").toLowerCase();
    const isLienholderListed =
      interestedParties.length > 0 && lossPaye === "yes";

    // Date mapping — State Farm specific:
    // "Policy Origin Date" = coverage START date
    // "Policy Effective Date" = coverage END/EXPIRATION date
    const startDate = rawData.policyOriginDate
      ? String(rawData.policyOriginDate)
      : undefined;
    const endDate = rawData.policyEffectiveDate
      ? String(rawData.policyEffectiveDate)
      : undefined;

    return {
      success: status !== PolicyStatus.NOT_AVAILABLE,
      policyId: input.policyId,
      policyStatus: status,
      policyNumber: rawData.policyNumber
        ? String(rawData.policyNumber)
        : input.policyNumber,
      insuranceProvider: "State Farm",
      coveragePeriod:
        startDate && endDate
          ? { startDate, endDate }
          : undefined,
      coverages: coverages.length > 0 ? coverages : undefined,
      isLienholderListed,
      interestedParties:
        interestedParties.length > 0 ? interestedParties : undefined,
      rawData,
      agentSteps: 0, // filled by caller
      durationMs: 0, // filled by caller
    };
  }
}

async function fillStateFarmVin(page: Page, vin: string): Promise<void> {
  const vinInput = page.locator("#vinID").first();
  await vinInput.click({ timeout: 10_000 });
  await vinInput.fill("");
  await vinInput.type(vin, { delay: 35 });
  await vinInput.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    (el as HTMLInputElement).blur();
  });
  await page.waitForTimeout(500);
}

async function submitStateFarmSearch(
  page: Page,
  mode: "click" | "js-click" | "enter"
): Promise<void> {
  const searchButton = page.locator("#atpSearchButtonID").first();
  if (mode === "click") {
    await searchButton.click({ timeout: 10_000, force: true });
  } else if (mode === "js-click") {
    await searchButton.evaluate((el) => (el as HTMLElement).click());
  } else {
    await page.locator("#vinID").first().focus();
    await page.keyboard.press("Enter");
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
}

async function isStillOnStateFarmSearchForm(page: Page): Promise<boolean> {
  if (!page.url().includes("InsuranceInquiry/policySearch")) return false;
  return page.locator("#vinID").first().isVisible({ timeout: 1_000 }).catch(() => false);
}

async function hasNoStateFarmSearchResults(page: Page): Promise<boolean> {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /no\s+(results|records|polic(?:y|ies))|not\s+found|unable\s+to\s+locate/i.test(bodyText);
}

function mapPolicyStatus(raw: string | undefined): PolicyStatus {
  if (!raw) return PolicyStatus.NOT_AVAILABLE;
  const upper = raw.toUpperCase().trim();
  if (upper.includes("ACTIVE") || upper.includes("IN FORCE"))
    return PolicyStatus.ACTIVE;
  if (upper.includes("CANCEL")) return PolicyStatus.CANCELLED;
  if (upper.includes("EXPIRE")) return PolicyStatus.EXPIRED;
  if (upper.includes("PENDING")) return PolicyStatus.PENDING_ACTIVATION;
  return PolicyStatus.NOT_AVAILABLE;
}

function parseNumber(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = Number(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? undefined : n;
}
