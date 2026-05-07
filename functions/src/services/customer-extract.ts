import { defineString } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "firebase-functions/v2";

const googleAiApiKey = defineString("GOOGLE_AI_API_KEY");

const MODEL_NAME = "gemini-2.5-flash";

/** Row shape returned to the client — matches the CSV import row schema. */
export interface ExtractedCustomerRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  loanNumber?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  insuranceProvider?: string;
  policyNumber?: string;
}

const EXTRACTION_PROMPT = `You are an expert at reading auto-finance / dealership Customer / Account / Portfolio reports.

The document you are reading was exported from a Dealer Management System (such as Frazer, DealerTrack, Reynolds & Reynolds, CDK) or a lender's loan-servicing system. Each customer / borrower / account is one row in the underlying data, but the document may be formatted as a multi-page table, multi-column report, or a list of customer cards.

Extract every customer / account row you can find. Return ONLY a valid JSON array — no markdown, no explanation. Each element must follow this exact shape:

{
  "firstName": "Customer's first name",
  "lastName": "Customer's last name",
  "email": "Email address, or null",
  "phone": "Phone number (any format), or null",
  "loanNumber": "Loan / account / deal number, or null",
  "vin": "Full 17-character Vehicle Identification Number, or null",
  "make": "Vehicle make (e.g. Toyota), or null",
  "model": "Vehicle model (e.g. Camry), or null",
  "year": 2021,
  "insuranceProvider": "Insurance carrier name if shown (e.g. Progressive), or null",
  "policyNumber": "Insurance policy number if shown, or null"
}

Rules:
- Skip header rows, totals, page numbers, footers, and summary rows. Only extract real customers.
- If a single "Customer Name" column contains both names (e.g. "Smith, John" or "John Smith"), split it into firstName and lastName intelligently.
- If a row has no name and no VIN, skip it.
- VINs are exactly 17 characters. VINs NEVER contain the letters I, O, or Q. When a character in a VIN is visually ambiguous, ALWAYS prefer the digit: read "0" (zero) instead of "O", "1" (one) instead of "I", and never use "Q". Return the full 17-character VIN even if it looks unusual. Only set vin to null if the VIN is clearly cut off, missing, or shorter than 17 characters after applying these rules.
- "year" must be a 4-digit integer (e.g. 2021), not a string.
- For phone, return digits and standard separators (dashes / parens) — do not invent area codes.
- If a field is not present, use null. Never invent data.
- Return ONLY the JSON array. Do not wrap it in an object. Do not include any prose.
- Maximum 500 rows. If the document has more than 500 customers, return the first 500 in document order.`;

/**
 * Extracts customer rows from a PDF / image / scanned document using Gemini 2.5 Flash.
 *
 * Accepts inline base64 data plus a MIME type. Supported: application/pdf,
 * image/png, image/jpeg, image/webp, image/heic, image/heif.
 */
export async function extractCustomersFromDocument(
  base64Data: string,
  mimeType: string,
): Promise<ExtractedCustomerRow[]> {
  const apiKey = googleAiApiKey.value();
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      // Keep the response deterministic and JSON-shaped.
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent([
    EXTRACTION_PROMPT,
    {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    },
  ]);

  const text = result.response.text().trim();
  // Strip stray markdown fences if Gemini ignores responseMimeType.
  const jsonStr = text
    .replace(/^```json?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    logger.error("[customer-extract] failed to parse Gemini response", { text: text.slice(0, 500) });
    throw new Error("AI returned invalid JSON. Please try uploading a clearer document.");
  }

  // Accept either a bare array or an object wrapping an array.
  let arr: unknown[];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const arrCandidate = obj.rows ?? obj.customers ?? obj.data ?? Object.values(obj).find((v) => Array.isArray(v));
    arr = Array.isArray(arrCandidate) ? arrCandidate : [];
  } else {
    arr = [];
  }

  const rows: ExtractedCustomerRow[] = [];
  for (const item of arr.slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const row: ExtractedCustomerRow = {};
    if (typeof o.firstName === "string") row.firstName = o.firstName.trim();
    if (typeof o.lastName === "string") row.lastName = o.lastName.trim();
    if (typeof o.email === "string") row.email = o.email.trim();
    if (typeof o.phone === "string") row.phone = o.phone.trim();
    if (typeof o.loanNumber === "string") row.loanNumber = o.loanNumber.trim();
    if (typeof o.vin === "string") row.vin = o.vin.trim().toUpperCase();
    if (typeof o.make === "string") row.make = o.make.trim();
    if (typeof o.model === "string") row.model = o.model.trim();
    if (typeof o.year === "number" && Number.isFinite(o.year)) {
      row.year = Math.trunc(o.year);
    } else if (typeof o.year === "string") {
      const y = parseInt(o.year, 10);
      if (!isNaN(y)) row.year = y;
    }
    if (typeof o.insuranceProvider === "string") row.insuranceProvider = o.insuranceProvider.trim();
    if (typeof o.policyNumber === "string") row.policyNumber = o.policyNumber.trim();

    // Drop empty rows entirely.
    const hasIdentity = row.firstName || row.lastName || row.vin || row.loanNumber;
    if (hasIdentity) rows.push(row);
  }

  return rows;
}
