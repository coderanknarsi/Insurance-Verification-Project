/**
 * GEICO B2B Lienholder/Dealer portal prompts.
 * Portal URL: https://partners.geico.com/lienholders/logon.aspx
 *
 * Flow: Login (User ID + Password) → optional Terms acceptance on first login →
 *       Coverage Verification search (Policy# + VIN last 4-5) → results.
 * No MFA.
 */

export const LOGIN_CONTEXT = `You are on the GEICO B2B Auto LienHolders / Dealers portal login page (partners.geico.com/lienholders/logon.aspx).
The page has a "User ID" field, a "Password" field, and a blue "LOG IN" button.

Do NOT click "New Enrollment", "ADD COMPANY", "NEED HELP?", "Login Problems", or "Forgot Password".
Just enter the credentials and click LOG IN.

After login, GEICO MAY display an "Online Coverage Information / Individual User Access Agreement" terms page asking
"Do you accept the above agreement?" with "Yes" and "No" radio buttons and a "Continue" button.
If you see this page: select "Yes" and click "Continue".

You are done with login when you reach the "Coverage Verification" page.`;

export const SEARCH_CONTEXT = `You are on the GEICO Coverage Verification page (partners.geico.com/lienholders/coverageview.aspx).

The form has two visible fields:
  - "Policy Number" — enter the full policy number provided
  - "VIN (Last 4 or 5 characters)" — enter ONLY the LAST 5 characters of the VIN (preferred), NOT the full 17-character VIN

There is also a "No policy number?" checkbox — DO NOT check it. We are searching by policy number.

After both fields are filled, click the blue "SEARCH" button.`;

export const RESULTS_CONTEXT = `You are viewing GEICO Coverage Verification results.

The page should show a verification of coverage with the named insured, policy dates,
vehicle info, coverages, and any lienholder / additional interest information.

If multiple policies appear, choose the row matching the policy number searched.`;

export const EXTRACTION_CONTEXT = `You are viewing the GEICO Coverage Verification result page.

Extract every field listed in the schema. Look across all visible sections:
  - Policy summary (status, effective / expiration dates)
  - Named insured & drivers
  - Vehicle (year / make / model / VIN)
  - Coverages (Comprehensive, Collision, Liability)
  - Lienholder / Additional Interest / Loss Payee

If a field is not visible, set it to null. Do not guess.`;

/** Schema describing what the LLM should pull from the GEICO coverage page. */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The GEICO policy number",
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
