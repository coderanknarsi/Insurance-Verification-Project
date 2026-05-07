/**
 * Validation rules for borrower-uploaded insurance documents at intake time.
 *
 * Two severity levels:
 *  - HARD reject: stop the submission, ask the borrower to re-upload.
 *    These represent clear, unambiguous mismatches a borrower would notice
 *    immediately if they checked their own document (wrong vehicle, wrong
 *    person, expired policy).
 *  - SOFT warn: accept the submission but flag for manual review by the lender.
 *    Used for cases where the borrower may not have control (lienholder mismatch,
 *    OCR ambiguity).
 */

import type { ExtractedInsuranceData } from "./insurance-ocr";

export interface IntakeValidationContext {
  vehicleVin?: string | null;
  vehicleLabel?: string | null;
  borrowerFirstName?: string | null;
  borrowerLastName?: string | null;
  /** Lienholder name configured by the org in compliance rules. */
  expectedLienholderName?: string | null;
  /** Whether the org actually requires a lienholder on policy. */
  requireLienholder?: boolean;
  /** Now timestamp; injectable for tests. */
  now?: Date;
}

export interface ValidationIssue {
  code:
    | "VIN_MISMATCH"
    | "INSURED_NAME_MISMATCH"
    | "POLICY_EXPIRED"
    | "FUTURE_EFFECTIVE_DATE"
    | "LIENHOLDER_MISMATCH"
    | "LIENHOLDER_MISSING"
    | "LOW_OCR_CONFIDENCE";
  /** Borrower-friendly message; safe to show on the intake form. */
  borrowerMessage: string;
  /** Lender-side message for the alert email. */
  lenderMessage: string;
}

export interface ValidationResult {
  hardRejects: ValidationIssue[];
  softWarnings: ValidationIssue[];
}

const VIN_TAIL_LEN = 4;

function tail(str: string, n: number): string {
  return str.length > n ? str.slice(-n) : str;
}

/**
 * Returns true if `extractedName` plausibly identifies the same person as
 * the borrower on file. Matching rules:
 *  - case-insensitive
 *  - first OR last name (or middle, if used as first) appears as a full word
 *  - tolerates middle initials, suffixes (Jr/Sr), and reversed order
 */
function nameMatches(
  extracted: string,
  firstName?: string | null,
  lastName?: string | null,
): boolean {
  const cleanedExtracted = extracted
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set(cleanedExtracted.split(" ").filter((t) => t.length >= 2));
  const targets = [firstName, lastName]
    .map((n) => (n ?? "").toLowerCase().trim())
    .filter((n) => n.length >= 2);

  if (targets.length === 0) return true; // no borrower name on file → can't reject
  return targets.some((t) => tokens.has(t));
}

function lienholderMatches(extracted: string, expected: string): boolean {
  // Normalize: strip "Inc", "LLC", commas, the word "auto", trailing addresses.
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\b(inc|llc|corp|corporation|company|co|finance|financial|auto|motors)\b\.?/g, "")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = normalize(extracted);
  const b = normalize(expected);
  if (!a || !b) return false;
  // Match if any normalized 4+-char token from `b` appears in `a`.
  const bTokens = b.split(" ").filter((t) => t.length >= 4);
  if (bTokens.length === 0) return a.includes(b) || b.includes(a);
  return bTokens.some((t) => a.includes(t));
}

export function validateIntakeSubmission(
  extracted: ExtractedInsuranceData,
  ctx: IntakeValidationContext,
): ValidationResult {
  const hardRejects: ValidationIssue[] = [];
  const softWarnings: ValidationIssue[] = [];
  const now = ctx.now ?? new Date();

  // ─── HARD: VIN mismatch ──────────────────────────────────
  if (extracted.vin && ctx.vehicleVin) {
    const docVin = extracted.vin.toUpperCase().trim();
    const ourVin = ctx.vehicleVin.toUpperCase().trim();
    if (docVin.length >= 11 && ourVin.length >= 11 && docVin !== ourVin) {
      hardRejects.push({
        code: "VIN_MISMATCH",
        borrowerMessage: `This document is for a different vehicle (VIN ending in ${tail(docVin, VIN_TAIL_LEN)}). Please upload the policy for ${
          ctx.vehicleLabel ?? "your vehicle on file"
        } (VIN ending in ${tail(ourVin, VIN_TAIL_LEN)}).`,
        lenderMessage: `VIN on the uploaded document (${tail(docVin, VIN_TAIL_LEN)}) does not match the vehicle on file (${tail(ourVin, VIN_TAIL_LEN)}). The borrower likely uploaded the wrong policy.`,
      });
    }
  }

  // ─── HARD: Insured name mismatch ─────────────────────────
  if (extracted.insuredName && (ctx.borrowerFirstName || ctx.borrowerLastName)) {
    const matches = nameMatches(
      extracted.insuredName,
      ctx.borrowerFirstName,
      ctx.borrowerLastName,
    );
    if (!matches) {
      const fullBorrower = [ctx.borrowerFirstName, ctx.borrowerLastName]
        .filter(Boolean)
        .join(" ");
      hardRejects.push({
        code: "INSURED_NAME_MISMATCH",
        borrowerMessage: `This policy lists ${extracted.insuredName} as the insured. Please upload your own insurance policy${
          fullBorrower ? ` (${fullBorrower})` : ""
        }.`,
        lenderMessage: `Insured name on the document is "${extracted.insuredName}", but the borrower on file is ${fullBorrower}.`,
      });
    }
  }

  // ─── HARD: Policy expired ────────────────────────────────
  if (extracted.expirationDate) {
    const exp = new Date(extracted.expirationDate);
    if (Number.isFinite(exp.getTime())) {
      const daysExpired = Math.floor((now.getTime() - exp.getTime()) / 86400000);
      if (daysExpired > 30) {
        hardRejects.push({
          code: "POLICY_EXPIRED",
          borrowerMessage: `This policy expired on ${exp.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}. Please upload your current policy.`,
          lenderMessage: `Uploaded policy expired ${daysExpired} days ago (${extracted.expirationDate}). Borrower needs to provide an active policy.`,
        });
      }
    }
  }

  // ─── SOFT: Effective date too far in the future ──────────
  if (extracted.effectiveDate) {
    const eff = new Date(extracted.effectiveDate);
    if (Number.isFinite(eff.getTime())) {
      const daysOut = Math.floor((eff.getTime() - now.getTime()) / 86400000);
      if (daysOut > 30) {
        softWarnings.push({
          code: "FUTURE_EFFECTIVE_DATE",
          borrowerMessage: "",
          lenderMessage: `Policy effective date (${extracted.effectiveDate}) is ${daysOut} days in the future. Borrower may have uploaded a quote rather than a bound policy.`,
        });
      }
    }
  }

  // ─── SOFT: Lienholder mismatch / missing ─────────────────
  if (ctx.requireLienholder && ctx.expectedLienholderName) {
    const expected = ctx.expectedLienholderName;
    const docLien = extracted.lienholder?.name?.trim() ?? "";

    if (!docLien) {
      softWarnings.push({
        code: "LIENHOLDER_MISSING",
        borrowerMessage: "",
        lenderMessage: `The uploaded document does not list a lienholder. You require "${expected}" to be on the policy.`,
      });
    } else if (!lienholderMatches(docLien, expected)) {
      softWarnings.push({
        code: "LIENHOLDER_MISMATCH",
        borrowerMessage: "",
        lenderMessage: `Lienholder on the document is "${docLien}", but you require "${expected}".`,
      });
    }
  }

  // ─── SOFT: Low OCR confidence ────────────────────────────
  if (extracted.confidence === "low") {
    softWarnings.push({
      code: "LOW_OCR_CONFIDENCE",
      borrowerMessage: "",
      lenderMessage: "OCR confidence on this upload was low. Verify carrier, policy number, and dates manually.",
    });
  }

  return { hardRejects, softWarnings };
}
