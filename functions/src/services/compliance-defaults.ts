import {
  OrganizationType,
  DEFAULT_LAPSE_ESCALATION,
  DEFAULT_COVERAGE_ESCALATION,
  type ComplianceRules,
} from "../types/organization";

const DEFAULT_TIMEZONE = "America/Chicago";

/**
 * Baseline compliance defaults applied at onboarding when an org has not
 * configured its own rules. Intentionally strict-but-reasonable: every lender
 * type wants comprehensive + collision + lienholder, with a sane deductible
 * ceiling so a borrower can't quietly raise their deductible to the point the
 * collateral is effectively uninsured.
 *
 * Returned object is always a fresh copy (nested escalation objects included)
 * so callers can safely mutate it.
 */
export function defaultComplianceRules(orgType?: OrganizationType): ComplianceRules {
  // Banks / credit unions / finance companies generally enforce a tighter
  // deductible ceiling than a buy-here-pay-here lot, which tends to be more
  // lenient on older, lower-value inventory.
  const maxDeductible =
    orgType === OrganizationType.BHPH_DEALER ? 1000 : 1000;

  return {
    requireLienholder: true,
    requireComprehensive: true,
    requireCollision: true,
    maxCompDeductible: maxDeductible,
    maxCollisionDeductible: maxDeductible,
    expirationWarningDays: 14,
    lapseGracePeriodDays: 10,
    autoSendReminder: true,
    reminderDaysBeforeExpiry: 14,
    timezone: DEFAULT_TIMEZONE,
    lapseEscalation: { ...DEFAULT_LAPSE_ESCALATION },
    coverageEscalation: { ...DEFAULT_COVERAGE_ESCALATION },
  };
}
