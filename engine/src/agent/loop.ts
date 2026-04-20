import type { Page } from "playwright";
import type { AgentTask, AgentStep } from "./types.js";
import { observe } from "./observer.js";
import { reason } from "./reasoner.js";
import { executeAction } from "./actions.js";
import { detectCaptcha } from "../captcha/detector.js";
import { solveCaptcha } from "../captcha/solver.js";
import { fetchOtpCode } from "../email/otp-reader.js";

const MAX_STEPS = 25;
const MAX_CAPTCHA_RETRIES = 2;
const MAX_MFA_RETRIES = 2;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface AgentLoopResult {
  success: boolean;
  data?: Record<string, unknown>;
  steps: AgentStep[];
  error?: string;
}

/**
 * Runs the AI agent loop: observe → reason → act → repeat.
 *
 * The agent observes the page (screenshot + DOM elements), sends them to
 * Gemini Flash for reasoning, executes the returned action, and repeats
 * until the LLM returns a DONE action with extracted data or max steps is hit.
 */
export async function agentLoop(
  page: Page,
  task: AgentTask,
  maxSteps: number = MAX_STEPS
): Promise<AgentLoopResult> {
  const steps: AgentStep[] = [];
  let captchaRetries = 0;
  let mfaRetries = 0;
  let consecutiveErrors = 0;

  for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
    const stepStart = Date.now();

    // 1. Observe the page
    const observation = await observe(page);

    // 2. Ask the LLM what to do
    const action = await reason(observation, task, steps);

    // Log the step
    const step: AgentStep = {
      stepNumber: stepNum,
      observation: {
        url: observation.url,
        title: observation.title,
        elementCount: observation.elements.length,
      },
      action,
      durationMs: Date.now() - stepStart,
    };
    steps.push(step);

    console.log(
      `[agent] Step ${stepNum}: ${action.type}` +
        (action.selector ? ` → "${action.selector}"` : "") +
        (action.text ? ` text="${action.text}"` : "") +
        (action.reasoning ? ` (${action.reasoning})` : "")
    );

    // 3. Handle terminal actions
    if (action.type === "DONE") {
      return { success: true, data: action.data, steps };
    }

    if (action.type === "ERROR") {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          success: false,
          steps,
          error: `Agent hit ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${action.errorMessage}`,
        };
      }
      // Give the agent another chance
      continue;
    }

    // Reset error counter on non-error actions
    consecutiveErrors = 0;

    if (action.type === "FETCH_MFA_CODE") {
      mfaRetries++;
      if (mfaRetries > MAX_MFA_RETRIES) {
        return {
          success: false,
          steps,
          error: "MFA code could not be retrieved after max retries",
        };
      }

      const carrierId = action.carrierId ?? "progressive";
      // Use a 5-minute lookback window so we catch OTP emails that arrived
      // slightly before the agent decided to fetch (PingFederate sends the
      // OTP during the authenticate call, which happens before this step).
      const sinceCutoff = new Date(Date.now() - 5 * 60 * 1000);
      console.log(`[agent] Fetching MFA code for ${carrierId}...`);
      const otpCode = await fetchOtpCode(carrierId, sinceCutoff);

      if (!otpCode) {
        return {
          success: false,
          steps,
          error: `Failed to retrieve MFA code for ${carrierId} from email`,
        };
      }

      // Find the OTP input field and type the code
      const otpObservation = await observe(page);
      const otpInput = otpObservation.elements.find(
        (el) =>
          el.tag === "input" &&
          (el.placeholder?.includes("XXXXXX") ||
            el.placeholder?.includes("code") ||
            el.ariaLabel?.toLowerCase().includes("code") ||
            el.inputType === "text" || el.inputType === "tel")
      );
      if (otpInput) {
        await page.fill(otpInput.selector, "");
        await page.type(otpInput.selector, otpCode, { delay: 80 });
        await page.waitForTimeout(500);
        console.log(`[agent] Typed MFA code into ${otpInput.selector}`);
      } else {
        console.warn("[agent] Could not find OTP input field, letting agent retry");
      }
      continue;
    }

    if (action.type === "CAPTCHA_DETECTED") {
      captchaRetries++;
      if (captchaRetries > MAX_CAPTCHA_RETRIES) {
        return {
          success: false,
          steps,
          error: "CAPTCHA could not be solved after max retries",
        };
      }

      const captchaInfo = await detectCaptcha(page);
      if (captchaInfo.detected && captchaInfo.type && captchaInfo.type !== "unknown" && captchaInfo.siteKey) {
        const solved = await solveCaptcha(page, captchaInfo.type, captchaInfo.siteKey);
        if (!solved) {
          return {
            success: false,
            steps,
            error: `Failed to solve ${captchaInfo.type} CAPTCHA`,
          };
        }
        // After solving, wait for page to update and continue
        await page.waitForTimeout(2000);
      } else {
        return {
          success: false,
          steps,
          error: "CAPTCHA detected but type/siteKey could not be determined",
        };
      }
      continue;
    }

    // 4. Execute the action
    try {
      await executeAction(page, action);
      // Wait for any navigation or XHR to settle
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    } catch (err) {
      console.error(
        `[agent] Action failed at step ${stepNum}:`,
        err instanceof Error ? err.message : err
      );
      // Don't abort — let the agent observe the result and recover
    }
  }

  return {
    success: false,
    steps,
    error: `Agent exceeded maximum steps (${maxSteps})`,
  };
}
