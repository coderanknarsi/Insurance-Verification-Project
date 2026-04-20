import type { Page } from "playwright";

/**
 * Checks the current page for common CAPTCHA indicators.
 */
export async function detectCaptcha(page: Page): Promise<{
  detected: boolean;
  type?: "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "unknown";
  siteKey?: string;
}> {
  return page.evaluate(() => {
    // Check for reCAPTCHA v2 iframe
    const recaptchaFrame = document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]'
    );
    if (recaptchaFrame) {
      const src = recaptchaFrame.getAttribute("src") ?? "";
      const keyMatch = src.match(/[?&]k=([^&]+)/);
      return {
        detected: true,
        type: "recaptcha_v2" as const,
        siteKey: keyMatch?.[1],
      };
    }

    // Check for hCaptcha
    const hcaptchaFrame = document.querySelector(
      'iframe[src*="hcaptcha.com"]'
    );
    if (hcaptchaFrame) {
      const siteKeyEl = document.querySelector("[data-sitekey]");
      return {
        detected: true,
        type: "hcaptcha" as const,
        siteKey: siteKeyEl?.getAttribute("data-sitekey") ?? undefined,
      };
    }

    // Check for reCAPTCHA v3 script
    const recaptchaScript = document.querySelector(
      'script[src*="recaptcha/api.js"], script[src*="recaptcha/enterprise.js"]'
    );
    if (recaptchaScript) {
      const siteKeyEl = document.querySelector("[data-sitekey]");
      return {
        detected: true,
        type: "recaptcha_v3" as const,
        siteKey: siteKeyEl?.getAttribute("data-sitekey") ?? undefined,
      };
    }

    // Check for generic CAPTCHA indicators
    const bodyText = document.body.innerText.toLowerCase();
    if (
      bodyText.includes("verify you are human") ||
      bodyText.includes("captcha") ||
      bodyText.includes("i'm not a robot")
    ) {
      return { detected: true, type: "unknown" as const };
    }

    return { detected: false };
  });
}
