import { defineString } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "firebase-functions/v2";

const googleAiApiKey = defineString("GOOGLE_AI_API_KEY");

const MODEL_NAME = "gemini-2.5-flash";

// ─── Types ──────────────────────────────────────────────────

export interface ExtractedInsuranceData {
  insuranceProvider?: string;
  policyNumber?: string;
  effectiveDate?: string;   // YYYY-MM-DD
  expirationDate?: string;  // YYYY-MM-DD
  insuredName?: string;
  vin?: string;
  confidence: "high" | "medium" | "low";
  lienholder?: {
    name?: string;
    address?: string;
  };
  coverages?: Array<{
    type: string;        // e.g. "COMPREHENSIVE", "COLLISION", "LIABILITY"
    deductible?: number; // in USD
    limit?: string;      // e.g. "$20,000/$40,000"
  }>;
  policyType?: string;     // e.g. "Personal Auto", "Commercial Auto"
  premiumAmount?: number;  // total premium in USD
  paymentFrequency?: string; // e.g. "MONTHLY", "SEMI_ANNUAL", "ANNUAL"
}

// ─── Extraction ─────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an expert at reading insurance ID cards and insurance declarations pages.

Extract the following fields from this insurance document image. Return ONLY a valid JSON object with these fields:

{
  "insuranceProvider": "Name of the insurance company (e.g., Progressive, GEICO, State Farm)",
  "policyNumber": "The policy number",
  "effectiveDate": "Policy effective/start date in YYYY-MM-DD format",
  "expirationDate": "Policy expiration/end date in YYYY-MM-DD format",
  "insuredName": "Name of the insured person",
  "vin": "Vehicle Identification Number (17 characters)",
  "policyType": "The type of policy (e.g., Personal Auto, Commercial Auto, Personal Car Policy, Motorcycle)",
  "premiumAmount": 142.68,
  "paymentFrequency": "Payment frequency — use one of: MONTHLY, QUARTERLY, SEMI_ANNUAL, ANNUAL, PAY_IN_FULL, or null if not visible",
  "lienholder": {
    "name": "Name of the lienholder/lender/loss payee listed on the policy, or null if none",
    "address": "Full address of the lienholder, or null if not visible"
  },
  "coverages": [
    {
      "type": "Coverage type — use one of: COMPREHENSIVE, COLLISION, LIABILITY, UNINSURED_MOTORIST, UNDERINSURED_MOTORIST, MEDICAL, ROADSIDE, LOAN_LEASE",
      "deductible": 1000,
      "limit": "$20,000/$40,000"
    }
  ],
  "confidence": "high, medium, or low based on how clearly you could read the document"
}

Rules:
- If a field is not visible or readable, set it to null.
- For dates, always convert to YYYY-MM-DD format.
- For VIN, return the full 17-character VIN if visible.
- For insurance provider, return the common/marketing name (e.g., "Progressive" not "Progressive Casualty Insurance Company").
- For policyType, look for text like "Personal Car Policy", "Personal Auto Policy", "Commercial Auto", etc. Return the type as stated on the document.
- For premiumAmount, return the total policy premium as a number in USD (e.g., 142.68 not "$142.68"). Look for "Total premium", "Policy premium", or similar labels. If only individual coverage premiums are shown, sum them.
- For paymentFrequency, look for billing cycle or payment schedule information. Return null if not visible.
- For lienholder, look for sections labeled "Lienholder", "Loss Payee", "Additional Interest", or "Lender". Return null for the entire object if no lienholder is listed.
- For coverages, extract ALL coverage lines you can find. Deductible should be a number in USD (e.g., 1000 not "$1,000"). Limit can be a string describing the limit. Include comprehensive and collision deductibles when visible.
- Set confidence to "high" if the image is clear and you could read most fields, "medium" if some fields were hard to read, "low" if the image is blurry or most fields are unclear.
- Return ONLY the JSON object, no markdown, no explanation.`;

/**
 * Extracts insurance information from a base64-encoded insurance card/document
 * using Gemini Vision.
 */
export async function extractInsuranceFromImage(
  base64Data: string,
  mimeType: string,
): Promise<ExtractedInsuranceData> {
  const apiKey = googleAiApiKey.value();
  if (!apiKey) {
    logger.warn("[ocr] GOOGLE_AI_API_KEY not configured, skipping extraction");
    return { confidence: "low" };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  try {
    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
    ]);

    const response = result.response;
    const text = response.text().trim();

    // Strip markdown code fences if present
    const jsonStr = text
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(jsonStr);

    const extracted: ExtractedInsuranceData = {
      insuranceProvider: parsed.insuranceProvider ?? undefined,
      policyNumber: parsed.policyNumber ?? undefined,
      effectiveDate: parsed.effectiveDate ?? undefined,
      expirationDate: parsed.expirationDate ?? undefined,
      insuredName: parsed.insuredName ?? undefined,
      vin: parsed.vin ?? undefined,
      confidence: parsed.confidence ?? "low",
      lienholder: parsed.lienholder?.name ? parsed.lienholder : undefined,
      coverages: Array.isArray(parsed.coverages) && parsed.coverages.length > 0
        ? parsed.coverages
        : undefined,
      policyType: parsed.policyType ?? undefined,
      premiumAmount: typeof parsed.premiumAmount === "number" ? parsed.premiumAmount : undefined,
      paymentFrequency: parsed.paymentFrequency ?? undefined,
    };

    logger.info("[ocr] Extraction complete", {
      provider: extracted.insuranceProvider,
      policyNumber: extracted.policyNumber ? "***" : null,
      effectiveDate: extracted.effectiveDate,
      expirationDate: extracted.expirationDate,
      hasVin: !!extracted.vin,
      confidence: extracted.confidence,
    });

    return extracted;
  } catch (error) {
    logger.error("[ocr] Extraction failed", { error: String(error) });
    return { confidence: "low" };
  }
}
