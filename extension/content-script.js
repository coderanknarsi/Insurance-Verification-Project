/**
 * AutoLienTracker Helper — content script.
 *
 * Injected into State Farm pages. On VERIFY_POLICY:
 *   1. Confirm we're on the Policy Search page (#vinID present).
 *   2. Fill VIN, click search.
 *   3. Handle optional Auto Selection page (match by last name; fall back to user pick).
 *   4. Scrape the Policy Information page into a flat object.
 *   5. Navigate back to Policy Search so the next VIN can run.
 */

const POLICY_SEARCH_FRAGMENT = "InsuranceInquiry/policySearch";
const POLICY_INFO_FRAGMENT = "InsuranceInquiry";

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = predicate();
      if (v) return v;
    } catch {
      /* ignore */
    }
    await SLEEP(intervalMs);
  }
  throw new Error("Timed out waiting for page condition");
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function fillVinAndSubmit(vin) {
  const vinInput = await waitFor(() => $("#vinID"), { timeoutMs: 15_000 });
  vinInput.focus();
  setNativeValue(vinInput, "");
  setNativeValue(vinInput, vin);
  vinInput.blur();
  await SLEEP(300);

  const button = $("#atpSearchButtonID");
  if (!button) throw new Error("Search button #atpSearchButtonID not found");
  button.click();
  // wait either for navigation or for results table to appear
  await SLEEP(1500);
}

function isOnSearchPage() {
  return location.href.includes(POLICY_SEARCH_FRAGMENT) && !!$("#vinID");
}

function isOnAutoSelection() {
  // Heuristic: still under InsuranceInquiry, has a table with radio buttons,
  // and not the Policy Info page.
  if (!location.href.includes(POLICY_INFO_FRAGMENT)) return false;
  if (isOnSearchPage()) return false;
  if (isOnPolicyInfoPage()) return false;
  const radios = $$("input[type=radio]");
  return radios.length > 1;
}

function isOnPolicyInfoPage() {
  // Heuristic: page text contains "Policy Origin Date" or "Policy Effective Date"
  // labels that only appear on the Policy Information screen.
  const txt = document.body?.innerText ?? "";
  return /Policy\s+(Origin|Effective)\s+Date/i.test(txt);
}

function hasNoResultsMessage() {
  const txt = document.body?.innerText ?? "";
  return /no\s+(results|records|polic(?:y|ies))|not\s+found|unable\s+to\s+locate/i.test(txt);
}

async function handleAutoSelection(lastName) {
  // Try to auto-pick the row whose text contains the borrower's last name.
  const lower = (lastName ?? "").trim().toLowerCase();
  const rows = $$("tr").filter((tr) => $("input[type=radio]", tr));

  let target = null;
  if (lower && rows.length > 0) {
    const matches = rows.filter((tr) => tr.innerText.toLowerCase().includes(lower));
    if (matches.length === 1) target = matches[0];
  }

  if (!target) {
    // Ambiguous → throw a structured error so background can surface it.
    // V1: skip the VIN and continue. (Future v1.1: render an overlay
    // and let the user click the right row.)
    throw new Error(
      `Auto Selection page shows ${rows.length} rows and we could not pick by last name "${lastName}". Skipped — open the row manually if you want it verified.`,
    );
  }

  const radio = $("input[type=radio]", target);
  radio.click();
  await SLEEP(200);

  // Click whatever Continue/Select button is visible.
  const continueBtn =
    $$("button, input[type=submit]").find((b) =>
      /continue|select|view/i.test(b.innerText || b.value || ""),
    ) ?? null;
  if (continueBtn) continueBtn.click();
  await SLEEP(1500);
}

function getTextAfterLabel(labelRegex) {
  // Search the entire body for a label-like node, return the trimmed text
  // of the next text-bearing sibling/descendant. State Farm uses dt/dd-ish
  // structures; fall back to "label: value" inline patterns.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = (node.innerText || node.textContent || "").trim();
    if (!txt) continue;
    if (labelRegex.test(txt) && txt.length < 200) {
      // Same-element "Label: Value" pattern.
      const inlineMatch = txt.match(labelRegex);
      if (inlineMatch && inlineMatch.index === 0) {
        const after = txt.slice(inlineMatch[0].length).replace(/^[:\s]+/, "").trim();
        if (after) return after;
      }
      // Adjacent sibling.
      let sib = node.nextElementSibling;
      while (sib) {
        const sibTxt = (sib.innerText || sib.textContent || "").trim();
        if (sibTxt) return sibTxt;
        sib = sib.nextElementSibling;
      }
      // Parent's next sibling.
      const parentSib = node.parentElement?.nextElementSibling;
      const parentTxt = (parentSib?.innerText || parentSib?.textContent || "").trim();
      if (parentTxt) return parentTxt;
    }
  }
  return undefined;
}

function bodyText() {
  return document.body?.innerText ?? "";
}

function scrapeCoverageBlock(letter, name) {
  // Find a coverage row like "A  Collision  500" or "D Comprehensive 500"
  // Look for lines that start with the letter then the coverage name.
  const text = bodyText();
  const lines = text.split(/\n+/).map((l) => l.trim());
  const idx = lines.findIndex((l) =>
    new RegExp(`^${letter}\\b.*${name}`, "i").test(l) ||
    new RegExp(`\\b${name}\\b`, "i").test(l),
  );
  if (idx === -1) return { present: false, deductible: undefined };
  // Look at this line and the next 4 for a deductible-like number.
  const window = lines.slice(idx, idx + 5).join(" ");
  const m = window.match(/(?:Deductible|Ded)[^\d$]*\$?\s*([0-9][\d,]*)/i)
    ?? window.match(/\$\s*([0-9][\d,]*)/);
  const deductible = m ? m[1].replace(/,/g, "") : undefined;
  return { present: true, deductible };
}

function scrapePolicyInfo() {
  const result = {
    policyNumber: getTextAfterLabel(/^Policy\s+Number\b/i),
    policyStatus: getTextAfterLabel(/^Policy\s+Status\b/i),
    policyOriginDate: getTextAfterLabel(/^Policy\s+Origin\s+Date\b/i),
    policyEffectiveDate: getTextAfterLabel(/^Policy\s+Effective\s+Date\b/i),
    lienholderName: getTextAfterLabel(/^Lien\s*holder\b/i)
      ?? getTextAfterLabel(/^Lienholder\s+Name\b/i),
    lienholderAddress: getTextAfterLabel(/^Lien\s*holder\s+Address\b/i),
    lossPaye: getTextAfterLabel(/^Loss\s*Pay(ee|e)\b/i),
  };

  const collision = scrapeCoverageBlock("A", "Collision");
  result.hasCollision = collision.present;
  if (collision.deductible) result.collisionDeductible = collision.deductible;

  const comprehensive = scrapeCoverageBlock("D", "Comprehensive");
  result.hasComprehensive = comprehensive.present;
  if (comprehensive.deductible) result.comprehensiveDeductible = comprehensive.deductible;

  // Liability limits — best-effort, optional.
  const bodyTxt = bodyText();
  const biMatch = bodyTxt.match(/Bodily\s+Injury[^$\n]*\$?\s*([0-9][\d,]*)\s*\/\s*\$?\s*([0-9][\d,]*)/i);
  if (biMatch) {
    result.bodilyInjuryLimitPerAccident = biMatch[2].replace(/,/g, "");
  }
  const pdMatch = bodyTxt.match(/Property\s+Damage[^$\n]*\$?\s*([0-9][\d,]*)/i);
  if (pdMatch) {
    result.propertyDamageLimitPerAccident = pdMatch[1].replace(/,/g, "");
  }

  return result;
}

async function navigateBackToSearch() {
  if (isOnSearchPage()) return;
  // Try the in-page "New Search" / "Policy Search" link first.
  const link =
    $$("a, button").find((el) => /new\s+search|policy\s+search/i.test(el.innerText || "")) ?? null;
  if (link) {
    link.click();
    await SLEEP(1500);
  }
  if (isOnSearchPage()) return;
  // Otherwise hard-navigate.
  history.back();
  await SLEEP(2000);
}

async function verifyOnePolicy(policy) {
  if (!isOnSearchPage()) {
    await navigateBackToSearch();
  }
  if (!isOnSearchPage()) {
    throw new Error("Not on State Farm Policy Search page. Navigate there and retry.");
  }

  await fillVinAndSubmit(policy.vin);

  // Wait for one of: Policy Info, Auto Selection, no-results, or still on search.
  await waitFor(
    () =>
      isOnPolicyInfoPage() ||
      isOnAutoSelection() ||
      hasNoResultsMessage() ||
      (!isOnSearchPage() && document.readyState === "complete"),
    { timeoutMs: 25_000 },
  ).catch(() => {});

  if (hasNoResultsMessage()) {
    throw new Error(`State Farm returned no policy results for VIN ${policy.vin}`);
  }

  if (isOnAutoSelection()) {
    await handleAutoSelection(policy.borrowerLastName);
    await waitFor(() => isOnPolicyInfoPage(), { timeoutMs: 20_000 }).catch(() => {});
  }

  if (!isOnPolicyInfoPage()) {
    throw new Error(
      "Did not land on Policy Information page (post-search). Page may need manual review.",
    );
  }

  const scraped = scrapePolicyInfo();
  await navigateBackToSearch();
  return scraped;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type !== "VERIFY_POLICY") {
      return sendResponse({ ok: false, error: "Unknown message" });
    }
    try {
      const scraped = await verifyOnePolicy(message.policy);
      sendResponse({ ok: true, scraped });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // async
});
