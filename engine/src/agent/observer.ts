import type { Page } from "playwright";
import type { AgentObservation, PageElement } from "./types.js";

/**
 * Observes the current page state:
 * 1. Takes a JPEG screenshot (compressed for LLM input)
 * 2. Extracts visible interactive elements with their text/attributes
 */
export async function observe(page: Page): Promise<AgentObservation> {
  // Take compressed screenshot
  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 75,
    fullPage: false,
  });
  const screenshotBase64 = screenshotBuffer.toString("base64");

  // Extract interactive elements from the page
  const elements = await page.evaluate(() => {
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
