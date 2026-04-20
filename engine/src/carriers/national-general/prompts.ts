import type { AgentTask } from "../../agent/types.js";

/**
 * National General (Allstate subsidiary) lienholder portal prompts.
 * Portal URL: lienholderverification.com
 * Simple flow: Login → Search (Last Name + VIN last 8 + Policy Number) → Results
 */

export const LOGIN_CONTEXT = `You are on the National General lienholder portal login page (lienholderverification.com).
This is "National General, an Allstate company" — a lienholder verification portal.
The page has a username/email field, a password field, and a "Log In" button.
There may be a "Remember Me" checkbox — do NOT check it.
Do NOT click "Register for a New Account" — the credentials are already registered.`;

export const SEARCH_CONTEXT = `You are logged into the National General Easy Access Lienholder Portal.
You should see a search form with three fields:
- "Last Name" — the last name of the insured
- "Vin" — the LAST 8 DIGITS of the VIN only (not the full VIN)
- "Policy Number" — the full policy number

Fill in all three fields, then click the "Search" button (red button).
If you only have 2 of 3 fields, fill in what you have and try searching.
IMPORTANT: The VIN field only accepts the LAST 8 digits, not the full 17-character VIN.`;

export const RESULTS_CONTEXT = `You are viewing search results on the National General lienholder portal.
Look for policy information displayed on the page.
The results may show coverage details, vehicle info, insured name, and lienholder information.
If there are multiple results, select the one matching the borrower's last name and VIN.
Click on the result or look for a link to view full policy details.`;

export const EXTRACTION_CONTEXT = `You are viewing policy/coverage details on the National General lienholder portal.
Extract ALL of the following information visible on the page.
Look carefully at every section — coverage details, named insured, vehicles, lienholders.
The page may show "Verification of Coverage" or similar heading.
If a field is not visible on the page, set it to null.`;

/** Schema telling the LLM what fields to extract from the policy detail page */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The policy number",
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
