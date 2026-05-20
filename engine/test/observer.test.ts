import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";
import { observe } from "../src/agent/observer.js";

test("observe retries a transient screenshot capture failure", async () => {
  let screenshotCalls = 0;
  let loadStateWaits = 0;

  const page = {
    screenshot: async () => {
      screenshotCalls++;
      if (screenshotCalls === 1) {
        throw new Error(
          "page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
        );
      }
      return Buffer.from("jpeg-bytes");
    },
    waitForLoadState: async () => {
      loadStateWaits++;
    },
    waitForTimeout: async () => {},
    evaluate: async () => [
      {
        tag: "a",
        text: "Continue",
        isVisible: true,
        selector: "#continue",
      },
    ],
    url: () => "https://apps.b2b.statefarm.com/login",
    title: async () => "State Farm Login",
  };

  const observation = await observe(page as unknown as Page);

  assert.equal(screenshotCalls, 2);
  assert.equal(loadStateWaits, 1);
  assert.equal(observation.screenshotBase64, Buffer.from("jpeg-bytes").toString("base64"));
  assert.equal(observation.url, "https://apps.b2b.statefarm.com/login");
  assert.equal(observation.elements.length, 1);
});