const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadContentScript(fakeDocument) {
  const code = fs.readFileSync(path.join(__dirname, "content-script.js"), "utf8");
  let listener = null;
  const sandbox = {
    console,
    document: fakeDocument,
    Event,
    MouseEvent: class MouseEvent {},
    PointerEvent: class PointerEvent {},
    NodeFilter: { SHOW_ELEMENT: 1 },
    setTimeout: (fn) => fn(),
    window: {},
    location: { href: "https://lenders.apps.pcrosa01.redk8s.statefarm.com/InsuranceInquiry/autoSelection" },
    chrome: {
      runtime: {
        onMessage: {
          addListener(cb) {
            listener = cb;
          },
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "content-script.js" });
  assert.equal(typeof listener, "function", "content script should register a message listener");
  return listener;
}

function send(listener, message) {
  let response;
  listener(message, {}, (value) => {
    response = value;
  });
  return response;
}

test("CONTINUE_AUTO_SELECTION refuses to submit when no policy radio is checked", () => {
  let clickedContinue = false;
  const continueButton = {
    innerText: "Continue",
    value: "",
    click() {
      clickedContinue = true;
    },
    dispatchEvent() {
      clickedContinue = true;
      return true;
    },
  };
  const fakeDocument = {
    body: { innerText: "Auto Selection Please select from the details below and click Continue." },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "input[type=radio]") return [];
      if (selector === "button, input[type=submit], input[type=button]") return [continueButton];
      return [];
    },
    createTreeWalker() {
      return { nextNode: () => null };
    },
  };

  const listener = loadContentScript(fakeDocument);
  const response = send(listener, { type: "CONTINUE_AUTO_SELECTION" });

  assert.equal(response.ok, false);
  assert.match(response.error, /No policy row is selected/i);
  assert.equal(clickedContinue, false, "Continue must not be clicked without a checked radio");
});
