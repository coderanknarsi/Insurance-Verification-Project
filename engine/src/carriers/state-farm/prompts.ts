/**
 * State Farm B2B Portal prompts for AI agent navigation.
 *
 * Full flow:
 *   Login (b2b-login-app.digital.statefarm.com)
 *   → Email MFA (6-digit code)
 *   → B2B Portal homepage (b2b.statefarm.com)
 *   → Home & Auto Lenders → Insurance Inquiry
 *   → "Insurance Inquiry Tool" button
 *   → Policy Search page (enter VIN)
 *   → Auto Selection (if multiple vehicles)
 *   → Policy Information page (extract data)
 */

export const LOGIN_CONTEXT = `You are on the State Farm B2B portal login page (b2b-login-app.digital.statefarm.com).
The page has a "B2B ID" field and a "Password" field, plus a "Log In" button.

Steps:
1. Enter the B2B ID in the B2B ID / username field.
2. Enter the password in the Password field.
3. Click "Log In".

After clicking Log In, you will see an EMAIL MFA verification step.
State Farm sends a 6-digit code to the registered email address.
When you see the MFA / verification code input field, use the FETCH_MFA_CODE action to retrieve the code automatically, then type it in and submit.

IMPORTANT:
- Do NOT click "Remember this device" if that option appears.
- If there is a CAPTCHA, solve it before clicking Log In.
- After MFA, you should land on the B2B portal homepage (b2b.statefarm.com/b2b-content or similar).`;

export const NAVIGATE_TO_INQUIRY_CONTEXT = `You are logged into the State Farm B2B portal (b2b.statefarm.com).
You need to navigate to the Insurance Inquiry Tool. Here are the steps:

1. Find and click the "Home & Auto Lenders" dropdown/menu item in the navigation.
2. From the dropdown, select "Insurance Inquiry" (or a similarly named option).
3. You should land on an Insurance Inquiry page with a red/prominent "Insurance Inquiry Tool" button.
4. Click the "Insurance Inquiry Tool" button.
5. You should now be on the Policy Search page (URL contains "InsuranceInquiry/policySearch" or similar).

If you see a page with search fields (like Full VIN, Policy Number, etc.), you have successfully navigated to the right page — report DONE.

IMPORTANT:
- The navigation may involve hovering over menus or clicking dropdown items.
- If you see "Electronic Data Interchange" or other options, ignore them — you want "Insurance Inquiry".
- Look for buttons, links, or menu items. The portal may use dropdowns, accordion menus, or sidebar navigation.`;

export const SEARCH_CONTEXT = `You are on the State Farm Insurance Inquiry Policy Search page.
This page has multiple search options. Use the "Full VIN" field.

Steps:
1. Find the "Full VIN" input field on the page.
2. Enter the complete 17-character VIN.
3. Click the "Policy Search" button.

After searching, one of these will happen:
- You go directly to a Policy Information page (single match) — report DONE.
- You see an Auto Selection page with a table of vehicles (multiple matches) — you need to select the right one.
- You see "No results found" or an error — report DONE with that information.

IMPORTANT:
- Use ONLY the Full VIN field. Do not fill in other fields like Policy Number or Last Name.
- Make sure to enter the complete 17-character VIN, not a partial one.
- Clear any pre-filled fields before entering the VIN.`;

export const AUTO_SELECTION_CONTEXT = `You are on the State Farm Auto Selection page.
This page shows a table with multiple vehicles that matched the VIN search.
Each row has a radio button and shows: Insured Name, Year Make Model, Car Number, Policy Number, State.

Steps:
1. Look at the table rows and find the vehicle that matches the target Year/Make/Model or VIN.
2. Click the radio button for the correct row.
3. Click "Continue" or "Select" to proceed to the Policy Information page.

If there is only one row, select it and continue.
If you cannot determine which row is correct, select the first one.`;

export const EXTRACTION_CONTEXT = `You are on the State Farm Policy Information page.
Extract ALL of the following information visible on the page. Look carefully at every section.

The page is organized into sections:
- **Lienholder**: Company name, address lines, Additional Insured (Yes/No), Loss Payee (Yes/No)
- **Insured**: Name, address
- **Policy Details**: Policy Number, Policy Origin Date, Policy Status, Policy Effective Date
- **Vehicle Information**: Year, Make, Model, Body Style, VIN
- **Coverages**: Listed by letter code (A=Collision, D=Comprehensive, G=Bodily Injury/Property Damage)
  - Each coverage line shows: Coverage letter/name, Deductible amount, and/or Limit amounts
- **Agent Information**: Name, address, phone, email

IMPORTANT DATE MAPPING:
- "Policy Origin Date" is the coverage START date (e.g., 10/16/2025)
- "Policy Effective Date" is the coverage END/EXPIRATION date (e.g., 04/16/2026)
  These are 6 months apart (State Farm standard policy term).

Extract everything you can see. If a field is not visible, set it to null.`;

/** Schema telling the LLM what fields to extract from the Policy Information page */
export const POLICY_EXTRACTION_SCHEMA: Record<string, string> = {
  policyNumber: "The policy number (e.g., '0448103-SFP-15')",
  policyStatus: "Policy status: Active, Cancelled, Expired, etc.",
  policyOriginDate: "Policy Origin Date — this is the coverage START date (MM/DD/YYYY)",
  policyEffectiveDate: "Policy Effective Date — this is the coverage END/EXPIRATION date (MM/DD/YYYY)",
  namedInsured: "Full name of the insured person",
  insuredAddress: "Full address of the insured",
  vehicleYear: "Year of the insured vehicle",
  vehicleMake: "Make of the insured vehicle",
  vehicleModel: "Model of the insured vehicle",
  vehicleVin: "VIN of the insured vehicle",
  vehicleBodyStyle: "Body style of the vehicle",
  lienholderName: "Lienholder company name (e.g., 'BEST AUTO')",
  lienholderAddress: "Full lienholder address (all lines combined)",
  additionalInsured: "Additional Insured: 'Yes' or 'No'",
  lossPaye: "Loss Payee: 'Yes' or 'No'",
  hasCollision: "true if Coverage A (Collision) is listed, false otherwise",
  collisionDeductible: "Collision (Coverage A) deductible amount (number only, no $)",
  hasComprehensive: "true if Coverage D (Comprehensive) is listed, false otherwise",
  comprehensiveDeductible: "Comprehensive (Coverage D) deductible amount (number only, no $)",
  glassDeductible: "Glass deductible amount if shown separately (number only, no $)",
  bodilyInjuryLimitPerPerson: "Bodily Injury limit per person (number only)",
  bodilyInjuryLimitPerAccident: "Bodily Injury limit per accident (number only)",
  propertyDamageLimitPerAccident: "Property Damage limit per accident (number only)",
  agentName: "Insurance agent name",
  agentPhone: "Insurance agent phone number",
  agentEmail: "Insurance agent email",
};
