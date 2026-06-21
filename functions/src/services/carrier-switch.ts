export type SweepOutcome = "OK" | "LAPSE" | "POSSIBLE_SWITCH";

interface ClassifyInput {
  parsedStatus: string;
  /** Did the carrier portal return ANY matching policy record? */
  recordFound: boolean;
  /** Was this policy previously verified as active coverage? */
  hadPriorCoverage?: boolean;
}

const LAPSED = new Set(["CANCELLED", "EXPIRED", "RESCINDED"]);

/**
 * Distinguish a genuine lapse (carrier explicitly says cancelled/expired) from
 * a likely carrier switch (carrier has no record, but the borrower previously
 * had active coverage here — they probably moved to another insurer).
 */
export function classifySweepOutcome(input: ClassifyInput): SweepOutcome {
  if (input.parsedStatus === "ACTIVE") return "OK";
  if (LAPSED.has(input.parsedStatus)) return "LAPSE";
  // NOT_AVAILABLE / no record:
  if (!input.recordFound && input.hadPriorCoverage) return "POSSIBLE_SWITCH";
  return "LAPSE";
}
