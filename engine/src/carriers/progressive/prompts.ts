/**
 * Progressive PROVE portal-specific prompts and extraction schemas.
 * PROVE = Progressive Policy Retrieval & Online Verification Engine
 * Portal URL: https://prove.progressive.com
 *
 * Real portal flow (from manual testing April 2026):
 * 1. Login page → username + password
 * 2. User Agreement page → must click "I agree" button
 * 3. 2-Step Verification → choose "Email Me" → click "Continue"
 * 4. OTP entry page → enter 6-digit code from email → click "Continue"
 * 5. "Find a Policy" search page (main dashboard)
 */

export const LOGIN_CONTEXT = `You are on the Progressive PROVE portal (https://prove.progressive.com).
This is an insurance lender verification portal for lienholders and insurance trackers.

The login flow has MULTIPLE screens you must navigate through:

1. LOGIN PAGE: Has a User ID field and a Password field, plus a "Log in" button.
   - Enter the username and password provided below.
   - Do NOT click "Register" — the account is already registered.

2. USER AGREEMENT PAGE: After login, you may see a "User Agreement" page with legal text.
   - You MUST scroll down if needed and click the "I agree" button to proceed.
   - Do NOT click "I don't agree" — that exits the site.

3. 2-STEP VERIFICATION PAGE: You will see "Manage 2-Step Verification" asking how to receive a code.
   - There are two options: "Text Me" and "Email Me"
   - Click the "Email Me" button to select email delivery.
   - Then click the "Continue" button.

4. OTP CODE ENTRY PAGE: You will see "Please Check Your Email" with a 6-digit code input.
   - Return FETCH_MFA_CODE action with carrierId "progressive" — the system will fetch the code from email automatically.
   - After the code is entered, click the "Continue" button to complete verification.

After all these steps, you should land on the "Find a Policy" search page.`;

export const SEARCH_CONTEXT = `You are on the Progressive PROVE "Find a Policy" page.
The page has "Search for a Vehicle or Watercraft" with two radio button options:
  - "Policy number" (requires policy number + last 6 chars of VIN)
  - "Full VIN or HIN" (requires vehicle type dropdown + full VIN)

IMPORTANT SEARCH INSTRUCTIONS:
- If you have a FULL VIN (17 characters), select the "Full VIN or HIN" radio button.
- The "Vehicle type" dropdown should already default to "Auto" — leave it as-is.
- Type the full VIN into the "Full VIN or HIN" text field.
- Click the "Submit" button.

- If you have a POLICY NUMBER AND VIN, use "Policy number" radio instead:
  - Type the policy number in the "Policy number" field.
  - Type the LAST 6 characters of the VIN in the "Last six characters" field.
  - Click "Submit".

Prefer Full VIN search when available.`;

export const RESULTS_CONTEXT = `You are viewing search results on the Progressive PROVE portal.
Look for the policy result that matches the vehicle VIN.
If multiple results appear, choose the one matching the VIN.
Click on the policy to view full details.
If a "no results found" message appears, report this as an ERROR.`;

export const EXTRACTION_CONTEXT = `You are viewing a policy detail page on the Progressive PROVE portal.
Extract ALL of the following information visible on the page.
Look carefully at every section — coverage details, named insured, vehicles, lienholders.
If a field is not visible on the page, set it to null.`;

/** Schema telling the LLM what fields to extract from the policy detail page */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The policy number (e.g., 12345678)",
  policyStatus: "Policy status: ACTIVE, CANCELLED, EXPIRED, PENDING_CANCELLATION, etc.",
  namedInsured: "Full name of the primary named insured",
  effectiveDate: "Coverage effective/start date (MM/DD/YYYY)",
  expirationDate: "Coverage expiration/end date (MM/DD/YYYY)",
  vehicleYear: "Year of the insured vehicle",
  vehicleMake: "Make of the insured vehicle",
  vehicleModel: "Model of the insured vehicle",
  vehicleVin: "VIN of the insured vehicle",
  hasComprehensive: "true if comprehensive coverage is listed, false otherwise",
  comprehensiveDeductible: "Comprehensive deductible amount (number only, no $)",
  hasCollision: "true if collision coverage is listed, false otherwise",
  collisionDeductible: "Collision deductible amount (number only, no $)",
  liabilityLimit: "Liability limit if shown",
  lienholderName: "Name of the lienholder/loss payee if listed",
  lienholderAddress: "Full address of the lienholder if listed",
  drivers: "Comma-separated list of driver names on the policy",
};
