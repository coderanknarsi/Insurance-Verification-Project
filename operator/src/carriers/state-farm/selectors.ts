// Centralized selectors for the State Farm B2B portal.
// Keep them here so layout changes are a one-file edit.
//
// Phase 4 will populate these by porting the working logic from
// extension/content-script.js.

export const stateFarmSelectors = {
  searchForm: {
    vinInput: 'input[name="vin"]',
    lastNameInput: 'input[name="lastName"]',
    submitButton: 'button[type="submit"], input[type="submit"]',
  },
  autoSelection: {
    radioRows: 'input[type="radio"][name*="policy" i]',
    continueButton: 'button:has-text("Continue"), input[value="Continue"]',
  },
  results: {
    policyNumber: '[data-test="policy-number"], dt:has-text("Policy") + dd',
    insuredName: '[data-test="insured-name"]',
    effectiveDate: '[data-test="effective-date"]',
    expirationDate: '[data-test="expiration-date"]',
  },
  backToSearch: 'a:has-text("New Search"), button:has-text("New Search")',
};
