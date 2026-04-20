import type { Page } from "playwright";
import type { AgentAction } from "./types.js";

/**
 * Executes a single agent action on the page.
 * Returns once the action is complete.
 */
export async function executeAction(page: Page, action: AgentAction): Promise<void> {
  switch (action.type) {
    case "CLICK":
      if (!action.selector) throw new Error("CLICK action missing selector");
      // Use force:true so clicks on radio/checkbox inputs work even when
      // a wrapper element (e.g. <span class="radio-wrapper">) intercepts.
      await page.click(action.selector, { timeout: 10_000, force: true });
      // Small delay to let the page react
      await page.waitForTimeout(500);
      break;

    case "TYPE":
      if (!action.selector) throw new Error("TYPE action missing selector");
      if (action.text === undefined) throw new Error("TYPE action missing text");
      // Clear existing content then type with human-like delays
      await page.fill(action.selector, "");
      await page.type(action.selector, action.text, { delay: 50 + Math.random() * 80 });
      break;

    case "SELECT":
      if (!action.selector) throw new Error("SELECT action missing selector");
      if (!action.value) throw new Error("SELECT action missing value");
      await page.selectOption(action.selector, action.value);
      break;

    case "PRESS_KEY":
      if (!action.key) throw new Error("PRESS_KEY action missing key");
      await page.keyboard.press(action.key);
      await page.waitForTimeout(500);
      break;

    case "SCROLL":
      await page.mouse.wheel(0, action.amount ?? 500);
      await page.waitForTimeout(300);
      break;

    case "WAIT":
      await page.waitForTimeout(action.waitMs ?? 2000);
      break;

    case "DONE":
    case "EXTRACT":
    case "CAPTCHA_DETECTED":
    case "FETCH_MFA_CODE":
    case "ERROR":
      // These are terminal/signal actions — no page interaction needed
      break;

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
