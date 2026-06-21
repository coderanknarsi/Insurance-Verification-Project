import { PolicyChangeType, type ChangeSeverity } from "../types/policy-change";

interface ChangeLike {
  type: PolicyChangeType;
  severity: ChangeSeverity;
}

export interface ChangeNotificationDecision {
  notifyBorrower: boolean;
  notifyLender: boolean;
  /** Trigger used for the borrower message, if any. */
  borrowerTrigger:
    | "VERIFICATION_PROOF_REQUEST"
    | "REINSTATEMENT_REMINDER"
    | "COVERAGE_DOWNGRADED"
    | "DEDUCTIBLE_INCREASED"
    | "EXPIRATION_MOVED_UP"
    | null;
  lenderSeverity: ChangeSeverity | null;
}

const RANK: Record<ChangeSeverity, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Pure routing decision: given the changes from one verification, decide who
 * gets told and how. POLICY_LAPSED is intentionally excluded from the borrower
 * branch here — the existing lapse cadence (daily-lapse-auto-request) owns
 * borrower lapse messaging; we only surface it to the lender + audit.
 */
export function decideChangeNotifications(
  changes: ChangeLike[],
): ChangeNotificationDecision {
  let notifyBorrower = false;
  let notifyLender = false;
  let borrowerTrigger: ChangeNotificationDecision["borrowerTrigger"] = null;
  let lenderSeverity: ChangeSeverity | null = null;

  const bump = (s: ChangeSeverity) => {
    if (!lenderSeverity || RANK[s] > RANK[lenderSeverity]) lenderSeverity = s;
  };

  for (const c of changes) {
    switch (c.type) {
      case PolicyChangeType.CARRIER_CHANGED:
        notifyBorrower = true;
        notifyLender = true;
        borrowerTrigger = borrowerTrigger ?? "VERIFICATION_PROOF_REQUEST";
        bump(c.severity);
        break;
      case PolicyChangeType.COVERAGE_DOWNGRADED:
        notifyBorrower = true;
        notifyLender = true;
        borrowerTrigger = "COVERAGE_DOWNGRADED";
        bump(c.severity);
        break;
      case PolicyChangeType.DEDUCTIBLE_INCREASED:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "DEDUCTIBLE_INCREASED";
        bump(c.severity);
        break;
      case PolicyChangeType.EXPIRATION_MOVED_UP:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "EXPIRATION_MOVED_UP";
        bump(c.severity);
        break;
      case PolicyChangeType.LIENHOLDER_REMOVED:
        notifyBorrower = true;
        notifyLender = true;
        if (!borrowerTrigger) borrowerTrigger = "VERIFICATION_PROOF_REQUEST";
        bump(c.severity);
        break;
      case PolicyChangeType.POLICY_REINSTATED:
        notifyBorrower = true;
        borrowerTrigger = borrowerTrigger ?? "REINSTATEMENT_REMINDER";
        break;
      case PolicyChangeType.POLICY_LAPSED:
        notifyLender = true;
        bump(c.severity);
        break;
      case PolicyChangeType.LIENHOLDER_ADDED:
      case PolicyChangeType.STATUS_CHANGED:
      default:
        break;
    }
  }

  return { notifyBorrower, notifyLender, borrowerTrigger, lenderSeverity };
}
