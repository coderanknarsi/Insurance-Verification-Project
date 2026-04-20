import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AgentAction, AgentObservation, AgentTask, AgentStep } from "./types.js";

const MODEL_NAME = "gemini-2.5-flash";

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const key = process.env.GOOGLE_AI_API_KEY ?? "";
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

const SYSTEM_PROMPT = `You are an AI agent navigating insurance carrier web portals to verify auto insurance coverage for lenders.

Your job is to look at the current page (screenshot + interactive elements list) and decide the SINGLE next action to take.

RULES:
- Return EXACTLY ONE action as a JSON object
- Use the "selector" field from the elements list to target elements
- When typing into a field, first CLICK the field, then TYPE into it on the next step
- If you see a CAPTCHA, return {"type": "CAPTCHA_DETECTED"}
- If the data you need is visible on the page, use {"type": "DONE", "data": {...}} with the extracted fields
- If something went wrong and you can't recover, return {"type": "ERROR", "errorMessage": "description"}
- Be patient: pages may take time to load. Use WAIT if the page looks incomplete.
- Think step-by-step in the "reasoning" field

AVAILABLE ACTIONS:
- CLICK: {"type": "CLICK", "selector": "...", "reasoning": "..."}
- TYPE: {"type": "TYPE", "selector": "...", "text": "...", "reasoning": "..."}
- SELECT: {"type": "SELECT", "selector": "...", "value": "...", "reasoning": "..."}
- PRESS_KEY: {"type": "PRESS_KEY", "key": "Enter", "reasoning": "..."}
- SCROLL: {"type": "SCROLL", "direction": "down", "amount": 500, "reasoning": "..."}
- WAIT: {"type": "WAIT", "waitMs": 2000, "reasoning": "..."}
- DONE: {"type": "DONE", "data": {"policyStatus": "...", "policyNumber": "...", ...}, "reasoning": "..."}
- CAPTCHA_DETECTED: {"type": "CAPTCHA_DETECTED", "reasoning": "..."}
- FETCH_MFA_CODE: {"type": "FETCH_MFA_CODE", "carrierId": "progressive", "reasoning": "..."} — Use when the page asks for a verification code sent to email. The system will automatically fetch the code from email and type it in.
- ERROR: {"type": "ERROR", "errorMessage": "...", "reasoning": "..."}

Return ONLY the JSON object, no markdown fencing or extra text.`;

/**
 * Sends the current observation to Gemini Flash and gets the next action.
 */
export async function reason(
  observation: AgentObservation,
  task: AgentTask,
  history: AgentStep[]
): Promise<AgentAction> {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({ model: MODEL_NAME });

  // Build element list text
  const elementsList = observation.elements
    .map(
      (el) =>
        `[${el.index}] <${el.tag}> selector="${el.selector}" ` +
        `text="${el.text}" ` +
        (el.inputType ? `type="${el.inputType}" ` : "") +
        (el.placeholder ? `placeholder="${el.placeholder}" ` : "") +
        (el.ariaLabel ? `aria-label="${el.ariaLabel}" ` : "") +
        (el.currentValue ? `value="${el.currentValue}" ` : "")
    )
    .join("\n");

  // Build history summary (last 5 steps to keep tokens low)
  const recentHistory = history.slice(-5).map(
    (s) =>
      `Step ${s.stepNumber}: ${s.action.type}` +
      (s.action.selector ? ` on "${s.action.selector}"` : "") +
      (s.action.text ? ` text="${s.action.text}"` : "") +
      (s.action.reasoning ? ` — ${s.action.reasoning}` : "")
  );

  const userPrompt = [
    `CURRENT TASK: ${task.goal}`,
    task.context ? `CONTEXT: ${task.context}` : "",
    task.extractionSchema
      ? `EXTRACT THESE FIELDS: ${JSON.stringify(task.extractionSchema)}`
      : "",
    "",
    `PAGE URL: ${observation.url}`,
    `PAGE TITLE: ${observation.title}`,
    "",
    `INTERACTIVE ELEMENTS (${observation.elements.length} visible):`,
    elementsList || "(no interactive elements found)",
    "",
    recentHistory.length > 0
      ? `PREVIOUS ACTIONS:\n${recentHistory.join("\n")}`
      : "This is the first step.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: observation.screenshotBase64,
            },
          },
          { text: userPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 500,
    },
  });

  const responseText = result.response.text().trim();

  // Parse the JSON response — strip markdown fences if present
  const cleaned = responseText
    .replace(/^```json?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const action = JSON.parse(cleaned) as AgentAction;
    if (!action.type) {
      return {
        type: "ERROR",
        errorMessage: "LLM returned action without type field",
        reasoning: responseText,
      };
    }
    return action;
  } catch {
    console.error("[reasoner] Failed to parse LLM response:", responseText);
    return {
      type: "ERROR",
      errorMessage: "Failed to parse LLM response as JSON",
      reasoning: responseText,
    };
  }
}
