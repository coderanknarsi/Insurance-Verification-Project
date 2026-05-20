import assert from "node:assert/strict";
import test from "node:test";
import {
  findEmailMfaButton,
  findMfaSubmitButton,
  findOtpInputElement,
  resolveMfaCarrierId,
} from "../src/agent/loop.js";
import { extractOtpCodeFromEmail, getOtpPollTimeoutMs } from "../src/email/otp-reader.js";
import { parseAgentActionJson } from "../src/agent/reasoner.js";

test("MFA carrier resolution uses the carrier from the current task", () => {
  assert.equal(
    resolveMfaCarrierId({ type: "FETCH_MFA_CODE" }, { goal: "login", carrierId: "state_farm" }),
    "state_farm",
  );
});

test("State Farm OTP extraction accepts the 8 digit identity verification code", () => {
  const emailBody = `
    <html>
      <body>
        <p>Here's the code you requested to verify your identity.</p>
        <p style="font-size: 24px">2 3 3 4 2 2 6 3</p>
      </body>
    </html>
  `;

  assert.equal(extractOtpCodeFromEmail(emailBody, "state_farm"), "23342263");
});

test("State Farm OTP extraction ignores quoted-printable whitespace artifacts", () => {
  const emailBody = `
    <html>
      <body>
        <p>Here's the code you requested to verify your identity. This code expires in 10 minutes.</p>
=20=20=20 11592232
      </body>
    </html>
  `;

  assert.equal(extractOtpCodeFromEmail(emailBody, "state_farm"), "11592232");
});

test("Progressive OTP extraction still accepts 6 digit codes", () => {
  const emailBody = `<html><body><p>Verification Code</p><strong>123456</strong></body></html>`;

  assert.equal(extractOtpCodeFromEmail(emailBody, "progressive"), "123456");
});

test("State Farm OTP polling fails fast enough for admin callable sweeps", () => {
  assert.equal(getOtpPollTimeoutMs("state_farm"), 300_000);
  assert.equal(getOtpPollTimeoutMs("progressive"), 360_000);
});

test("MFA input detection waits for a real OTP code field", () => {
  assert.equal(
    findOtpInputElement([
      {
        index: 0,
        tag: "button",
        selector: "[data-testid='Email']",
        text: "Email code to I**O@A*****************M",
        isVisible: true,
      },
    ]),
    undefined,
  );

  assert.equal(
    findOtpInputElement([
      {
        index: 0,
        tag: "input",
        selector: "input[name='otc']",
        text: "",
        inputType: "text",
        isVisible: true,
      },
    ])?.selector,
    "input[name='otc']",
  );
});

test("MFA helper detects State Farm email and verify buttons", () => {
  assert.equal(
    findEmailMfaButton([
      {
        index: 0,
        tag: "button",
        selector: "[data-testid='Email']",
        text: "Email code to I**O@A*****************M",
        isVisible: true,
      },
    ])?.selector,
    "[data-testid='Email']",
  );

  assert.equal(
    findMfaSubmitButton([
      {
        index: 0,
        tag: "button",
        selector: "#oneTimeCodePrimaryButton",
        text: "Verify",
        isVisible: true,
      },
    ])?.selector,
    "#oneTimeCodePrimaryButton",
  );
});

test("parseAgentActionJson tolerates leading reasoning prose before JSON", () => {
  const text =
    'I should click the Sign in button now.\n' +
    '{"type": "CLICK", "selector": "#idSIButton9", "reasoning": "click sign in"}';
  const action = parseAgentActionJson(text);
  assert.ok(action, "expected action to be parsed");
  assert.equal(action!.type, "CLICK");
  assert.equal(action!.selector, "#idSIButton9");
});

test("parseAgentActionJson returns null for unrecoverable truncation", () => {
  const text = '{"type": "ERROR", "errorMessage": "The current page URL is already';
  assert.equal(parseAgentActionJson(text), null);
});