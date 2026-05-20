import type { Page } from "playwright";
import type { AgentTask, AgentStep, PageElement } from "./types.js";
import { observe } from "./observer.js";
import { reason } from "./reasoner.js";
import { executeAction } from "./actions.js";
import { detectCaptcha } from "../captcha/detector.js";
import { solveCaptcha } from "../captcha/solver.js";
import { fetchOtpCode } from "../email/otp-reader.js";

const MAX_STEPS = 25;
const MAX_CAPTCHA_RETRIES = 2;
const MAX_MFA_RETRIES = 3;
const MAX_CONSECUTIVE_ERRORS = 5;

export function resolveMfaCarrierId(action: AgentStep["action"], task: AgentTask): string | null {
  return action.carrierId ?? task.carrierId ?? null;
}

export function findOtpInputElement(elements: PageElement[]): PageElement | undefined {
  return elements.find((el) => {
    if (el.tag !== "input") return false;
    const text = [el.selector, el.placeholder, el.ariaLabel, el.text]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      el.inputType === "tel" ||
      text.includes("code") ||
      text.includes("otp") ||
      text.includes("otc") ||
      text.includes("one-time") ||
      text.includes("onetime") ||
      text.includes("verification")
    );
  });
}

export function findEmailMfaButton(elements: PageElement[]): PageElement | undefined {
  return elements.find((el) => {
    if (el.tag !== "button" && el.tag !== "a") return false;
    const text = [el.selector, el.ariaLabel, el.text]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return text.includes("email") && (text.includes("code") || text.includes("verify"));
  });
}

export function findMfaSubmitButton(elements: PageElement[]): PageElement | undefined {
  return elements.find((el) => {
    if (el.tag !== "button" && el.tag !== "a") return false;
    const text = [el.selector, el.ariaLabel, el.text]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      text.includes("onetimecodeprimarybutton") ||
      text.includes("verify") ||
      text.includes("submit") ||
      text.includes("continue")
    );
  });
}

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

      const carrierId = resolveMfaCarrierId(action, task);
      if (!carrierId) {
        return {
          success: false,
          steps,
          error: "MFA carrier ID was not provided by the action or task",
        };
      }
      let otpObservation = await observe(page);
      let otpInput = findOtpInputElement(otpObservation.elements);

      if (!otpInput) {
        // Detect whether the LLM (or a previous loop iteration) already
        // clicked an MFA email/verify button in a recent step. Re-clicking
        // can toggle the selection off or trip the carrier's rate limiter.
        const recentEmailClick = steps.slice(-3).some((s) => {
          if (s.action.type !== "CLICK" || !s.action.selector) return false;
          const sel = s.action.selector.toLowerCase();
          return (
            sel.includes("email") ||
            sel.includes("otc") ||
            sel.includes("verify") ||
            sel.includes("data-testid=\"email\"")
          );
        });

        const emailMfaButton = findEmailMfaButton(otpObservation.elements);
        if (emailMfaButton && !recentEmailClick) {
          console.log(`[agent] Clicking MFA email option ${emailMfaButton.selector}`);
          await page.click(emailMfaButton.selector, { timeout: 10_000, force: true });
          await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(3_000);
          otpObservation = await observe(page);
          otpInput = findOtpInputElement(otpObservation.elements);
        } else if (recentEmailClick) {
          console.log("[agent] Email MFA button was just clicked; skipping re-click to avoid toggling/rate-limit");
          await page.waitForTimeout(3_000);
          otpObservation = await observe(page);
          otpInput = findOtpInputElement(otpObservation.elements);
        }
      }

      if (!otpInput) {
        console.warn("[agent] OTP input field is not available yet; waiting before retrying MFA fetch");
        await page.waitForTimeout(2_000);
        continue;
      }

      // Tight window: only accept OTPs delivered in the last ~90s so we don't
      // pick up stale codes left over from previous failed sweeps.
      const sinceCutoff = new Date(Date.now() - 90_000);
      console.log(`[agent] Fetching MFA code for ${carrierId}...`);
      const otpCode = await fetchOtpCode(carrierId, sinceCutoff);

      if (!otpCode) {
        return {
          success: false,
          steps,
          error: `Failed to retrieve MFA code for ${carrierId} from email`,
        };
      }

      await page.fill(otpInput.selector, "");
      await page.type(otpInput.selector, otpCode, { delay: 80 });
      await page.waitForTimeout(500);
      console.log(`[agent] Typed MFA code into ${otpInput.selector}`);

      const submitObservation = await observe(page);
      const submitButton = findMfaSubmitButton(submitObservation.elements);
      if (submitButton) {
        await page.click(submitButton.selector, { timeout: 10_000, force: true });
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_000);
        console.log(`[agent] Submitted MFA code with ${submitButton.selector}`);
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
