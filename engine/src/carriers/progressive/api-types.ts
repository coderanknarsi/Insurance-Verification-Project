/**
 * TypeScript types for the Progressive PROVE portal's internal API.
 *
 * Discovered via network capture (capture-prove-api.ts) on April 4, 2026.
 *   Base URL:  https://api.progressive.com
 *   Endpoint:  POST /ProveAPI/v1/vehicles  (search by VIN or policy number)
 *   Endpoint:  DELETE /ProveAPI/v1/vehicles (clear previous search)
 *   Auth: Bearer JWT + api_key header + x-pgrclient header
 *
 * Both search modes use the same endpoint; the body determines the search type.
 * The response returns full policy + vehicle + coverage data in a single call.
 */

// ─── Request types ────────────────────────────────────────

/** VIN search: POST /ProveAPI/v1/vehicles */
export interface ProveVinSearchRequest {
  RiskCode: string;        // "AU" for auto
  FullVinNumber: string;   // 17-digit VIN
}

/** Policy number search: POST /ProveAPI/v1/vehicles */
export interface ProvePolicySearchRequest {
  PolicyNumber: string;
  VinLastSixNumbers: string;
}

export type ProveSearchRequest = ProveVinSearchRequest | ProvePolicySearchRequest;

// ─── Response types ───────────────────────────────────────

export interface ProveSearchResponse {
  accountSessionId: string;
  sessionDataLocation: string;
  policies: ProvePolicy;
  agents: { name: string; phoneNumber: string };
  alerts: unknown[];
}

export interface ProvePolicy {
  number: string;
  riskCode: string;            // "AA"
  effectiveDate: string;       // "4/3/2026"
  policyInfoKey: string;       // "IA-AA"
  status: string;              // "Active", "Renewal offer", etc.
  transactionAvailability: { canProcessEndorsement: boolean };
  primaryNamedInsured: { name: string };
  coverages: ProveCoverage[];
  vehicles: ProveVehicle;
  drivers: ProveDriver[];
  termDetails: ProveTermDetail[];
}

export interface ProveCoverage {
  name: string;        // "BIPD", "COMP", "COLL"
  label: string;       // "Bodily Injury & Property Damage Liability"
  description: string; // "$20,000 each person/$40,000 each accident/$15,000 each accident"
}

export interface ProveVehicle {
  vin: string;
  modelYear: string;
  make: string;
  model: string;
  vehicleCohortDate: string;
  vehicleLienholders: ProveLienholder[];
  vehicleAdditionalInterest: ProveAdditionalInterest[];
}

export interface ProveLienholder {
  lienholderName: string;
  lienholderAddressLineOne: string;
  lienholderAddressLineTwo: string;
  lienholderAddressCity: string;
  lienholderAddressState: string;
  lienholderAddressZip: string;
  lienholderCode: string;
  id: string;
}

export interface ProveAdditionalInterest {
  additionalInterestName: string;
  additionalInterestAddressLineOne: string;
  additionalInterestAddressLineTwo: string;
  additionalInterestAddressCity: string;
  additionalInterestAddressState: string;
  additionalInterestAddressZip: string;
  additionalInterestCode: string;
  id: string;
}

export interface ProveDriver {
  name: string;
  status: string; // "Insured driver (Includes permit driver)"
}

export interface ProveTermDetail {
  termDetailRenewalCounter: string;
  termDetailEffectiveDate: string;
  termDetailExpirationDate: string;
  termDetailStatusDisplay: string; // "Active", "Renewal offer"
}

/** Error response from PROVE API (e.g. 404 on vehicle search) */
export interface ProveApiError {
  errorCode: string;
  developerMessage: string;
  displayMessage: string;
}
