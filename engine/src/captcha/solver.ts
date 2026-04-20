import type { Page } from "playwright";

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY ?? "";
const CAPSOLVER_BASE = "https://api.capsolver.com";

interface TaskResult {
  gRecaptchaResponse?: string;
  token?: string;
}

/**
 * Solves a CAPTCHA using CapSolver API.
 * Submits the task, polls for the result, then injects the solution into the page.
 */
export async function solveCaptcha(
  page: Page,
  type: "recaptcha_v2" | "recaptcha_v3" | "hcaptcha",
  siteKey: string
): Promise<boolean> {
  if (!CAPSOLVER_API_KEY) {
    console.error("[captcha] CAPSOLVER_API_KEY not configured");
    return false;
  }

  const pageUrl = page.url();
  console.log(`[captcha] Solving ${type} for ${pageUrl} (siteKey: ${siteKey})`);

  const taskTypeMap = {
    recaptcha_v2: "ReCaptchaV2TaskProxyLess",
    recaptcha_v3: "ReCaptchaV3TaskProxyLess",
    hcaptcha: "HCaptchaTaskProxyLess",
  };

  // Create task
  const createResponse = await fetch(`${CAPSOLVER_BASE}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: CAPSOLVER_API_KEY,
      task: {
        type: taskTypeMap[type],
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    }),
  });

  const createData = (await createResponse.json()) as {
    errorId: number;
    taskId?: string;
    errorDescription?: string;
  };

  if (createData.errorId !== 0 || !createData.taskId) {
    console.error("[captcha] Failed to create task:", createData.errorDescription);
    return false;
  }

  // Poll for result (max 120 seconds)
  const taskId = createData.taskId;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const resultResponse = await fetch(`${CAPSOLVER_BASE}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: CAPSOLVER_API_KEY,
        taskId,
      }),
    });

    const resultData = (await resultResponse.json()) as {
      errorId: number;
      status: string;
      solution?: TaskResult;
      errorDescription?: string;
    };

    if (resultData.status === "ready" && resultData.solution) {
      const token =
        resultData.solution.gRecaptchaResponse ?? resultData.solution.token;

      if (!token) {
        console.error("[captcha] Solution missing token");
        return false;
      }

      // Inject the solution token into the page
      await page.evaluate(
        ({ captchaType, solvedToken }) => {
          if (captchaType === "hcaptcha") {
            const textarea = document.querySelector(
              "textarea[name=h-captcha-response]"
            ) as HTMLTextAreaElement | null;
            if (textarea) textarea.value = solvedToken;
          } else {
            const textarea = document.querySelector(
              "textarea[name=g-recaptcha-response]"
            ) as HTMLTextAreaElement | null;
            if (textarea) textarea.value = solvedToken;
          }

          // Try to trigger the callback
          if (captchaType !== "hcaptcha" && typeof window !== "undefined") {
            const w = window as unknown as Record<string, unknown>;
            if (typeof w.___grecaptcha_cfg === "object") {
              // Attempt to call the registered callback
              const callbacks = (w.___grecaptcha_cfg as Record<string, unknown>)
                .clients as Record<string, Record<string, Record<string, unknown>>> | undefined;
              if (callbacks) {
                for (const client of Object.values(callbacks)) {
                  for (const component of Object.values(client)) {
                    if (typeof component.callback === "function") {
                      (component.callback as (t: string) => void)(solvedToken);
                    }
                  }
                }
              }
            }
          }
        },
        { captchaType: type, solvedToken: token }
      );

      console.log(`[captcha] Solved ${type} successfully`);
      return true;
    }

    if (resultData.errorId !== 0) {
      console.error("[captcha] Solve failed:", resultData.errorDescription);
      return false;
    }
  }

  console.error("[captcha] Timed out waiting for solution");
  return false;
}
