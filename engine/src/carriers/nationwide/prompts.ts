/**
 * Nationwide policy inquiry portal prompts.
 * Auth host: identity.nationwide.com (OAuth → policyinquiry.nationwide.com)
 * Search host: policyinquiry.nationwide.com/policy-search
 *
 * Login is a 2-step OAuth flow:
 *   1) Username → Continue
 *   2) Password → Continue
 *   3) MFA selection page (defaults to SMS) — must click "Try another way"
 *      and select the Email option so the OTP arrives at the IMAP-monitored
 *      mailbox (verify@autolientracker.com).
 */

export const LOGIN_CONTEXT = `You are logging in to Nationwide's policy inquiry portal.

The login is a 2-step OAuth flow on identity.nationwide.com:
  STEP 1: Enter the username/email in the "User ID" or "Username" field, then click "Continue" / "Next" / "Sign In".
  STEP 2: A password field will appear (or load on the next page). Enter the password, then click "Continue" / "Sign In".

After step 2, a multi-factor authentication page may appear. It will likely default to "Text Message" / "Send code via text".
  YOU MUST NOT use the SMS option.
  Look for a small link such as "Try another way", "Use another method", "More options", "Choose another method", or similar.
  Click it, then select the "Email" option (it shows a masked email like a***k@bestautospencer.com).
  Click "Send code" / "Continue" to trigger the email OTP.

After the OTP code is requested, the agent runtime will fetch the 6-digit code from email automatically. Wait for the OTP code field, enter the code when provided, then click "Verify" / "Submit" / "Continue".

Do NOT check any "Remember this device" / "Trust this browser" boxes.
You are done with login when you reach the policy-search page on policyinquiry.nationwide.com.`;

export const SEARCH_CONTEXT = `You are on the Nationwide policy search page (policyinquiry.nationwide.com/policy-search).

The page asks: "Do you have the policy number?" with two radio options: "Yes" and "No".

Select "Yes". Two fields will appear:
  - "Policy Number" — enter the full policy number provided
  - "VIN (Last 6 Digits)" — enter ONLY the last 6 characters of the VIN, NOT the full 17-character VIN

Make sure the search type tab is "Auto" (this is usually the default).

After both fields are filled, click "Submit" / "Search" to run the inquiry.`;

export const RESULTS_CONTEXT = `You are viewing Nationwide policy search results / policy details.

If a list of matches appears, click the row that matches the policy number and last-6 VIN you searched for.
If a single policy detail page loads directly, you are already on the right page.

The detail page will show coverage information, vehicle info, the named insured, and any lienholders / additional interests.`;

export const EXTRACTION_CONTEXT = `You are viewing the Nationwide policy detail page.

Extract every field listed in the schema. Look across all visible sections:
  - Policy summary (status, effective / expiration dates)
  - Named insured & drivers
  - Vehicle (year / make / model / VIN)
  - Coverages (Comprehensive, Collision, Liability)
  - Additional Interests / Lienholder / Loss Payee

If a field is not visible, set it to null. Do not guess.`;

/** Schema describing what the LLM should pull from the detail page. */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The Nationwide policy number",
  policyStatus: "Policy status: ACTIVE, IN FORCE, CANCELLED, EXPIRED, PENDING_CANCELLATION, etc.",
  namedInsured: "Full name of the primary named insured",
  effectiveDate: "Coverage effective / start date (MM/DD/YYYY)",
  expirationDate: "Coverage expiration / end date (MM/DD/YYYY)",
  vehicleYear: "Year of the insured vehicle",
  vehicleMake: "Make of the insured vehicle",
  vehicleModel: "Model of the insured vehicle",
  vehicleVin: "VIN of the insured vehicle",
  hasComprehensive: "true if comprehensive coverage is listed, false otherwise",
  comprehensiveDeductible: "Comprehensive deductible amount (number only, no $)",
  hasCollision: "true if collision coverage is listed, false otherwise",
  collisionDeductible: "Collision deductible amount (number only, no $)",
  liabilityLimit: "Liability limit if shown",
  lienholderName: "Name of the lienholder / additional interest / loss payee, if listed",
  lienholderAddress: "Full address of the lienholder, if listed",
  drivers: "Comma-separated list of driver names on the policy",
};
