/**
 * Allstate AXCIS Lienholder Portal prompts for AI agent navigation.
 *
 * Portal: eaxcis.allstate.com
 * Flow:
 *   Login → Search (Policy Number + Last 5 VIN, or Name + Address)
 *   → Results page → Extract policy details
 */

export const LOGIN_CONTEXT = `You are on the Allstate AXCIS lienholder portal login page (eaxcis.allstate.com).
The page has a username/User ID field and a password field, plus a login/submit button.

Steps:
1. Enter the username in the User ID field.
2. Enter the password in the Password field.
3. Click the login/submit button.

After login, you may see an MFA/verification step. If a verification code is requested,
use the FETCH_MFA_CODE action to retrieve it automatically, then type it in and submit.

Once logged in, you should see the "Lienholder AXCIS" page with "Search Criteria" —
a search form with fields for Policy Number, VIN, Last Name, Address, etc.
If you see this search form, report DONE.

IMPORTANT:
- The page header says "Lienholder AXCIS - EDIT MODE" when logged in.
- If you see "Lienholder Service Center" in the top-right corner, you're on the right portal.
- Do NOT click "Help", "Support", or "Terms of Use" links.`;

export const SEARCH_CONTEXT = `You are on the Allstate AXCIS search page (eaxcis.allstate.com/Secured/auto/request.aspx).
This page has TWO search methods:

**Method 1 (Preferred): Policy Number + VIN**
- "Automobile Policy number" field — enter the full policy number
- "Last five(5) digits of VIN" field — enter the LAST 5 digits of the VIN
- Click the "Lookup" button

**Method 2 (Fallback): Name + Address**
- "Insured Last Name" field
- "Street #" field — the street number only
- "Address" field — the street name
- "ZIP Code" field
- Click the "Search" button
- Note: "All fields must be filled in" for this method

Use Method 1 if you have a policy number. Use Method 2 only if no policy number is available.

IMPORTANT:
- The VIN field wants only the LAST 5 digits, not the full 17-character VIN.
- There are separate "Lookup" and "Search" buttons for each method — use the correct one.
- If you see "Reset" buttons, they clear the form — do NOT click them.
- After searching, you should see policy details or a list of matching policies.`;

export const RESULTS_CONTEXT = `You are viewing search results on the Allstate AXCIS portal.
If multiple results are shown, select the one matching the target vehicle/insured.
If a single result is shown, the policy details may already be displayed.
Look for coverage details, vehicle info, insured name, and lienholder information.
Click on any result link to view full policy details if needed.`;

export const EXTRACTION_CONTEXT = `You are viewing policy/coverage details on the Allstate AXCIS lienholder portal.
Extract ALL of the following information visible on the page.
Look carefully at every section — coverage details, named insured, vehicles, lienholders.

The page typically shows:
- **Policy Information**: Policy number, status, effective date, expiration date
- **Insured Information**: Named insured name and address
- **Vehicle Information**: Year, Make, Model, VIN
- **Coverage Details**: Comprehensive, Collision, Liability, with deductibles and limits
- **Lienholder Information**: Company name, address, loss payee status

If a field is not visible on the page, set it to null.`;

/** Schema telling the LLM what fields to extract from the policy detail page */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The policy number",
  policyStatus: "Policy status: ACTIVE, CANCELLED, EXPIRED, PENDING_CANCELLATION, etc.",
  namedInsured: "Full name of the primary named insured",
  insuredAddress: "Full address of the insured",
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
  liabilityLimit: "Liability limit if shown (number only)",
  lienholderName: "Name of the lienholder/loss payee if listed",
  lienholderAddress: "Full address of the lienholder if listed",
  isLossPaye: "Is the lienholder listed as Loss Payee: 'Yes' or 'No'",
  drivers: "Comma-separated list of driver names on the policy",
};
