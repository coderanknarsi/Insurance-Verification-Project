import { createHash } from "crypto";
import { PolicyStatus } from "../types/policy";
import type { Policy } from "../types/policy";

/**
 * Carriers the engine can verify automatically. Source of truth — must
 * match the IDs registered in `engine/src/carriers/registry.ts`.
 */
export const SUPPORTED_CARRIERS = [
  "progressive",
  "allstate",
  "state_farm",
  "national_general",
] as const;

export type SupportedCarrier = (typeof SUPPORTED_CARRIERS)[number];

/** Lifecycle state that drives which workflow operates on a policy. */
export enum VerificationState {
  /** No insurance card uploaded yet — intake-chase is active. */
  PENDING_UPLOAD = "PENDING_UPLOAD",
  /** Card uploaded, carrier supported, org has master creds — eligible for sweep. */
  INSURED_SUPPORTED = "INSURED_SUPPORTED",
  /** Card uploaded, carrier outside supported set — bumped reminders only. */
  INSURED_UNSUPPORTED = "INSURED_UNSUPPORTED",
  /** Card uploaded, carrier supported, but org has no master creds — bumped reminders + dealer nudge. */
  INSURED_NO_CREDS = "INSURED_NO_CREDS",
}

/**
 * Statuses that make a policy eligible for the weekly engine sweep.
 * ACTIVE = confirmed coverage, UNVERIFIED = bulk-imported / awaiting first sweep.
 * Cancelled / expired / rescinded statuses fall under the lapse cadence instead.
 */
const SWEEP_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set<string>([
  PolicyStatus.ACTIVE,
  PolicyStatus.UNVERIFIED,
  PolicyStatus.PENDING_ACTIVATION,
]);

/** Normalize a free-text carrier name to a registry id. */
export function normalizeCarrier(name: string | undefined | null): string {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, "_");
}

/**
 * Decide which lifecycle state applies to a single policy.
 *
 * @param policy The policy document data.
 * @param orgId Org id (reserved for future per-org carrier overrides).
 * @param orgActiveCarrierCreds Set of carrier ids the org has active master creds for.
 */
export function getPolicyVerificationState(
  policy: Pick<Policy, "insuranceProvider" | "status">,
  orgId: string,
  orgActiveCarrierCreds: ReadonlySet<string>,
): VerificationState {
  void orgId; // reserved for future per-org overrides
  const carrier = normalizeCarrier(policy.insuranceProvider);
  if (!carrier) return VerificationState.PENDING_UPLOAD;

  const isSupported = (SUPPORTED_CARRIERS as readonly string[]).includes(carrier);
  if (!isSupported) return VerificationState.INSURED_UNSUPPORTED;

  if (!orgActiveCarrierCreds.has(carrier)) return VerificationState.INSURED_NO_CREDS;

  if (!SWEEP_ELIGIBLE_STATUSES.has(String(policy.status))) {
    // Supported + creds present but cancelled/expired/rescinded — not in sweep,
    // lapse cadence handles it. Surface NO_CREDS so reminders bump up.
    return VerificationState.INSURED_NO_CREDS;
  }

  return VerificationState.INSURED_SUPPORTED;
}

/**
 * Returns the assigned verification weekday for an org (1=Mon … 5=Fri).
 * If `override` is a valid 1..5 it wins; otherwise stable hash of orgId.
 */
export function getOrgVerificationDay(
  orgId: string,
  override?: number,
): 1 | 2 | 3 | 4 | 5 {
  if (
    typeof override === "number" &&
    Number.isInteger(override) &&
    override >= 1 &&
    override <= 5
  ) {
    return override as 1 | 2 | 3 | 4 | 5;
  }
  const hash = createHash("sha256").update(orgId).digest();
  const n = (hash.readUInt32BE(0) % 5) + 1;
  return n as 1 | 2 | 3 | 4 | 5;
}
