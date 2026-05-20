/**
 * State Farm B2B Portal prompts for AI agent navigation.
 *
 * Full flow:
 *   Login (b2b-login-app.digital.statefarm.com)
 *   → Email MFA (8-digit code)
 *   → B2B Portal homepage (b2b.statefarm.com)
 *   → Home & Auto Lenders → Insurance Inquiry
 *   → "Insurance Inquiry Tool" button
 *   → Policy Search page (enter VIN)
 *   → Auto Selection (if multiple vehicles)
 *   → Policy Information page (extract data)
 */

export const LOGIN_CONTEXT = `You are on the State Farm B2B portal login page (apps.b2b.statefarm.com).
The portal uses a multi-step Okta-style login: first enter your username/email, click Next, then enter your password.

Steps:
1. Wait for the page to fully load (dismiss any loading spinners with WAIT if needed).
2. Find the username or email input field and type the B2B ID / username into it.
3. Click the "Next" button (may be labelled "Next" or have id "usernamePrimaryButton").
4. Wait for the password field to appear, then type the password into it.
5. Click the "Sign In" or "Log In" button to submit.

After signing in, you will see an EMAIL MFA verification step.
State Farm sends an 8-digit code to the registered email address.

CRITICAL — DO NOT CLICK THE EMAIL BUTTON YOURSELF:
- As soon as you see a page with an option like "Email code to I**O@A...M" (a verification-method selector), IMMEDIATELY emit FETCH_MFA_CODE with carrierId "state_farm". Do NOT emit a CLICK for the Email button first.
- The FETCH_MFA_CODE handler will click the Email button, wait for the OTP input, fetch the code from email, type it in, and submit.
- Clicking the Email button yourself and then emitting FETCH_MFA_CODE causes a double-click that toggles the selection off or trips State Farm's rate limiter — the email will never arrive.

If you instead see the OTP input field directly (no method selector), still just emit FETCH_MFA_CODE — the handler will detect that and skip the click.

SUCCESS CRITERIA — REPORT DONE WHEN:
- The URL contains "b2b.statefarm.com/b2b-content" OR the page title is "B2B Portal | Home" OR you can see B2B portal navigation menus like "Home & Auto Lenders".
- As soon as you observe any of the above, emit a DONE action. The login task is complete; the next task will handle navigation.
- Do NOT emit ERROR just because the current page is the homepage — that means login SUCCEEDED.

IMPORTANT:
- Do NOT click "Remember this device" if that option appears.
- If there is a CAPTCHA, solve it before proceeding.
- Ignore generic notices on the password page (e.g. "If your last login was before December 2025, your password has expired") — these are informational. Proceed with entering the password unless the page explicitly says THIS account's password is expired.
- If State Farm prompts for a second MFA round (e.g. "trust this device" verification), use FETCH_MFA_CODE again — the system will retrieve the new code automatically.
- Use single quotes inside CSS attribute selectors, e.g. input[name='username'] not input[name="username"].`;

export const NAVIGATE_TO_INQUIRY_CONTEXT = `You are logged into the State Farm B2B portal (b2b.statefarm.com).
You need to reach the Insurance Inquiry Tool's Policy Search page.

REQUIRED SEQUENCE (perform each step in order):

STEP 1 — Initialize the Lenders service context:
{"type": "NAVIGATE", "url": "https://b2b.statefarm.com/b2b-content/home-auto-lenders", "reasoning": "Enter the Home & Auto Lenders service context."}

STEP 2 — Open the Insurance Inquiry landing page (do NOT skip step 1 first):
{"type": "NAVIGATE", "url": "https://b2b.statefarm.com/b2b-content/home-auto-lenders/ins-inquiry", "reasoning": "Open the Insurance Inquiry landing page."}

STEP 3 — Click the prominent red "Insurance Inquiry Tool" button on the landing page. Look for a button or link whose visible text contains "Insurance Inquiry Tool". The button opens the actual tool (URL changes to lenders.apps.*.statefarm.com/InsuranceInquiry/policySearch with a session token — you do NOT need to construct this URL, the click does it for you).

STEP 4 — Wait for the Policy Search page to load (it has fields including "Full VIN").

SUCCESS CRITERIA — REPORT DONE WHEN:
- The page displays a "Full VIN" input field, OR
- The URL contains "InsuranceInquiry/policySearch".

RECOVERY:
- If after STEP 2 the page looks unexpected (e.g. "Claim Services"), DO NOT immediately ERROR. Re-emit STEP 1 (navigate to /home-auto-lenders) then STEP 2 again. The Lenders service context must be initialized before /ins-inquiry resolves correctly.
- If after several attempts the navigation still fails, try clicking visible links/tiles whose text contains "Insurance Inquiry".

IMPORTANT:
- Always use NAVIGATE for the first two steps. Do not try to click through menus when a direct URL is available.
- Ignore unrelated tiles like "Electronic Data Interchange", "Claim Services", "Payments".
- Use single quotes inside CSS attribute selectors.`;

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
