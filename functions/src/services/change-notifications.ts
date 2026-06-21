import type { RawPolicyChange } from "./policy-diff";

export interface DispatchChangeInput {
  organizationId: string;
  borrowerId: string;
  policyId: string;
  changeIds: string[];
  changes: RawPolicyChange[];
}

/** Stub — replaced with real borrower/lender dispatch in Chunk 3. */
export async function dispatchChangeNotifications(
  _input: DispatchChangeInput,
): Promise<void> {
  return;
}
