import type { Page } from "playwright";
import type { AgentObservation, PageElement } from "./types.js";

async function captureScreenshot(page: Page): Promise<Buffer> {
  const screenshotOptions = {
    type: "jpeg" as const,
    quality: 75,
    fullPage: false,
  };

  try {
    return await page.screenshot(screenshotOptions);
  } catch (err) {
    console.warn(
      "[observer] Screenshot capture failed, retrying after page settles:",
      err instanceof Error ? err.message : err,
    );
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
    return page.screenshot(screenshotOptions);
  }
}

/**
 * Observes the current page state:
 * 1. Takes a JPEG screenshot (compressed for LLM input)
 * 2. Extracts visible interactive elements with their text/attributes
 */
export async function observe(page: Page): Promise<AgentObservation> {
  // Settle any pending navigation before capturing page state.
  // This prevents both "Protocol error (Page.captureScreenshot)" and
  // "Execution context was destroyed" errors that occur when the page is
  // still in the middle of a redirect chain when observe() is called.
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});

  // Take compressed screenshot
  const screenshotBuffer = await captureScreenshot(page);
  const screenshotBase64 = screenshotBuffer.toString("base64");

  // Extract interactive elements from the page. Wrap in retry because the page
  // may still be navigating (e.g. login redirect chain), which can destroy the
  // execution context mid-evaluate.
  const evaluateElements = () => page.evaluate(() => {
    const interactiveSelectors = [
      "input:not([type=hidden])",
      "button",
      "a[href]",
      "select",
      "textarea",
      "[role=button]",
      "[role=link]",
      "[role=tab]",
      "[onclick]",
    ].join(", ");

    const nodeList = document.querySelectorAll(interactiveSelectors);
    const results: Array<{
      tag: string;
      text: string;
      inputType?: string;
      placeholder?: string;
      ariaLabel?: string;
      currentValue?: string;
      isVisible: boolean;
      selector: string;
    }> = [];

    nodeList.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();

      // Skip elements that are off-screen or have no dimensions
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0;

      // Build a reliable CSS selector
      // Use short selectors: IDs over 30 chars are dynamic/unstable and confuse
      // the LLM (it truncates them), so fall back to data-agent-index.
      let selector = "";
      if (htmlEl.id && htmlEl.id.length <= 30) {
        selector = `#${CSS.escape(htmlEl.id)}`;
      } else if (htmlEl.getAttribute("name")) {
        const name = htmlEl.getAttribute("name")!;
        const tag = htmlEl.tagName.toLowerCase();
        selector = `${tag}[name="${CSS.escape(name)}"]`;
      } else if (htmlEl.getAttribute("data-testid")) {
        selector = `[data-testid="${CSS.escape(htmlEl.getAttribute("data-testid")!)}"]`;
      } else {
        // Fall back to nth-of-type path
        selector = `[data-agent-index="${i}"]`;
        htmlEl.setAttribute("data-agent-index", String(i));
      }

      const text = (htmlEl.textContent ?? "").trim().slice(0, 100);
      const inputEl = htmlEl as HTMLInputElement;

      results.push({
        tag: htmlEl.tagName.toLowerCase(),
        text,
        inputType: inputEl.type || undefined,
        placeholder: inputEl.placeholder || undefined,
        ariaLabel: htmlEl.getAttribute("aria-label") || undefined,
        currentValue: inputEl.value || undefined,
        isVisible,
        selector,
      });
    });

    return results;
  });

  let elements: Awaited<ReturnType<typeof evaluateElements>>;
  try {
    elements = await evaluateElements();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Execution context was destroyed") ||
      message.includes("frame was detached") ||
      message.includes("Target closed")
    ) {
      console.warn(
        "[observer] page.evaluate interrupted by navigation, retrying after load",
      );
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(500);
      elements = await evaluateElements();
    } else {
      throw err;
    }
  }

  // Only include visible elements, add index
  const visibleElements: PageElement[] = elements
    .filter((el) => el.isVisible)
    .map((el, index) => ({
      index,
      tag: el.tag,
      selector: el.selector,
      text: el.text,
      inputType: el.inputType,
      placeholder: el.placeholder,
      ariaLabel: el.ariaLabel,
      currentValue: el.currentValue,
      isVisible: true,
    }));

  return {
    screenshotBase64,
    url: page.url(),
    title: await page.title(),
    elements: visibleElements,
  };
}
