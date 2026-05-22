/**
 * AutoLienTracker Helper — content script.
 *
 * Each message type does ONE short step and returns immediately. The background
 * script orchestrates the flow and waits for navigation via chrome.tabs.onUpdated
 * between steps. This avoids the "message channel closed before a response was
 * received" failure mode that happens when a single message handler tries to
 * span a page navigation.
 *
 * Message types:
 *   - PROBE_STATE         → { state: "search"|"auto-selection"|"policy-info"|"no-results"|"unknown", url }
 *   - FILL_AND_SUBMIT     → { ok, error? }   (clicks Search; navigation follows)
 *   - PICK_AUTO_SELECTION → { ok, picked?, rowText?, checked?, error? }
 *   - CONTINUE_AUTO_SELECTION → { ok, error? }   (clicks Continue; navigation follows)
 *   - SCRAPE              → { ok, scraped?, error? }
 *   - BACK_TO_SEARCH      → { ok }   (navigates back)
 */

const POLICY_SEARCH_FRAGMENT = "InsuranceInquiry/policySearch";

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function humanClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    try {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(type, opts));
    } catch {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  }
}

function isOnSearchPage() {
  return location.href.includes(POLICY_SEARCH_FRAGMENT) && !!$("#vinID");
}

function isOnPolicyInfoPage() {
  const txt = document.body?.innerText ?? "";
  return /Policy\s+(Origin|Effective)\s+Date/i.test(txt);
}

function isOnAutoSelection() {
  const txt = document.body?.innerText ?? "";
  return /Auto\s+Selection/i.test(txt) && /click\s+Continue/i.test(txt);
}

function hasNoResultsMessage() {
  const txt = document.body?.innerText ?? "";
  return /no\s+(results|records|polic(?:y|ies))|not\s+found|unable\s+to\s+locate/i.test(txt);
}

function probeState() {
  if (isOnSearchPage()) return { state: "search", url: location.href };
  if (isOnAutoSelection()) return { state: "auto-selection", url: location.href };
  if (isOnPolicyInfoPage()) return { state: "policy-info", url: location.href };
  if (hasNoResultsMessage()) return { state: "no-results", url: location.href };
  return { state: "unknown", url: location.href };
}

function fillAndSubmit(vin) {
  const input = $("#vinID");
  if (!input) return { ok: false, error: "VIN input #vinID not found (are you on Policy Search?)" };
  input.focus();
  setNativeValue(input, "");
  setNativeValue(input, String(vin));
  input.blur();
  const button = $("#atpSearchButtonID");
  if (!button) return { ok: false, error: "Search button #atpSearchButtonID not found" };
  // Click on next tick so we can return before the navigation tears us down.
  setTimeout(() => button.click(), 50);
  return { ok: true };
}

function findSelectableRows() {
  // State Farm renders this screen differently by environment: sometimes a
  // real table, sometimes div/grid markup with radio inputs outside any <tr>.
  const directRadios = $$("input[type=radio], [role=radio]").filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (directRadios.length > 0) {
    return directRadios.map((selector) => {
      let container = selector.parentElement || selector;
      for (let depth = 0; container?.parentElement && depth < 8; depth += 1) {
        const text = (container.innerText || container.textContent || "").trim();
        if (/\b\d{5,}\b/.test(text) || /\b[A-Z]{2}\b/.test(text)) break;
        container = container.parentElement;
      }
      return { tr: container || selector, selector };
    });
  }

  // Look for any <tr> that contains something clickable in its first cell.
  const trs = $$("tr");
  const rows = [];
  for (const tr of trs) {
    if (tr.querySelector("th")) continue; // skip header
    const firstCell = tr.querySelector("td");
    if (!firstCell) continue;
    const selector =
      firstCell.querySelector("input[type=radio]") ||
      firstCell.querySelector("[role=radio]") ||
      firstCell.querySelector("button") ||
      firstCell.querySelector("input[type=checkbox]") ||
      firstCell.querySelector("a") ||
      firstCell.querySelector("label") ||
      firstCell.querySelector("span,div"); // last-resort: any visible widget
    if (selector) rows.push({ tr, selector });
  }
  return rows;
}

function pickAutoSelection(lastName, policyNumber) {
  const rows = findSelectableRows();
  if (rows.length === 0) {
    // Dump a snippet of the auto-selection table so we can fix selectors.
    const tableHtml = (document.querySelector("table")?.outerHTML ?? "(no table)").slice(0, 2000);
    return { ok: false, error: "No selectable rows on Auto Selection page", debugTable: tableHtml };
  }

  let target = null;
  let pickedBy = "first";

  if (policyNumber) {
    const digits = String(policyNumber).replace(/\D/g, "");
    if (digits) {
      target = rows.find(({ tr }) => tr.innerText.replace(/\D/g, "").includes(digits)) || null;
      if (target) pickedBy = "policy-number";
    }
  }
  if (!target && lastName) {
    const lower = String(lastName).trim().toLowerCase();
    const matches = rows.filter(({ tr }) => tr.innerText.toLowerCase().includes(lower));
    if (matches.length === 1) {
      target = matches[0];
      pickedBy = "last-name";
    }
  }
  if (!target) target = rows[0];

  // Select only. Background sends CONTINUE_AUTO_SELECTION after a short delay
  // so State Farm has time to register the selected radio in its form state.
  const sel = target.selector;
  const realInput = target.tr.querySelector("input[type=radio], input[type=checkbox]");
  if (realInput && "checked" in realInput) {
    humanClick(realInput);
    realInput.checked = true;
    realInput.dispatchEvent(new Event("input", { bubbles: true }));
    realInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  humanClick(sel);
  if ("checked" in sel) {
    sel.checked = true;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const checked = !!($$("input[type=radio]").find((radio) => radio.checked));
  return {
    ok: true,
    picked: pickedBy,
    rowText: target.tr.innerText.replace(/\s+/g, " ").trim(),
    selectorTag: sel.tagName,
    checked,
  };
}

function continueAutoSelection() {
  const continueBtn =
    $$("button, input[type=submit], input[type=button]").find((b) => {
      const t = (b.innerText || b.value || "").trim();
      return /^continue$/i.test(t);
    }) || null;
  if (!continueBtn) {
    return { ok: false, error: "Continue button not found on Auto Selection page" };
  }
  setTimeout(() => humanClick(continueBtn), 50);
  return { ok: true };
}

function getTextAfterLabel(labelRegex) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = (node.innerText || node.textContent || "").trim();
    if (!txt) continue;
    if (labelRegex.test(txt) && txt.length < 200) {
      const inlineMatch = txt.match(labelRegex);
      if (inlineMatch && inlineMatch.index === 0) {
        const after = txt.slice(inlineMatch[0].length).replace(/^[:\s]+/, "").trim();
        if (after) return after;
      }
      let sib = node.nextElementSibling;
      while (sib) {
        const sibTxt = (sib.innerText || sib.textContent || "").trim();
        if (sibTxt) return sibTxt;
        sib = sib.nextElementSibling;
      }
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
  const text = bodyText();
  const lines = text.split(/\n+/).map((l) => l.trim());
  const idx = lines.findIndex((l) =>
    new RegExp(`^${letter}\\b.*${name}`, "i").test(l) ||
    new RegExp(`\\b${name}\\b`, "i").test(l),
  );
  if (idx === -1) return { present: false };
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
    lienholderName: getTextAfterLabel(/^Lien\s*holder\b/i) ?? getTextAfterLabel(/^Lienholder\s+Name\b/i),
    lienholderAddress: getTextAfterLabel(/^Lien\s*holder\s+Address\b/i),
    lossPaye: getTextAfterLabel(/^Loss\s*Pay(ee|e)\b/i),
  };
  const collision = scrapeCoverageBlock("A", "Collision");
  result.hasCollision = collision.present;
  if (collision.deductible) result.collisionDeductible = collision.deductible;
  const comprehensive = scrapeCoverageBlock("D", "Comprehensive");
  result.hasComprehensive = comprehensive.present;
  if (comprehensive.deductible) result.comprehensiveDeductible = comprehensive.deductible;
  const bodyTxt = bodyText();
  const biMatch = bodyTxt.match(/Bodily\s+Injury[^$\n]*\$?\s*([0-9][\d,]*)\s*\/\s*\$?\s*([0-9][\d,]*)/i);
  if (biMatch) result.bodilyInjuryLimitPerAccident = biMatch[2].replace(/,/g, "");
  const pdMatch = bodyTxt.match(/Property\s+Damage[^$\n]*\$?\s*([0-9][\d,]*)/i);
  if (pdMatch) result.propertyDamageLimitPerAccident = pdMatch[1].replace(/,/g, "");
  return result;
}

function backToSearch() {
  const link =
    $$("a, button").find((el) => /new\s+search|policy\s+search|return\s+to\s+search/i.test(el.innerText || "")) || null;
  if (link) {
    setTimeout(() => link.click(), 50);
    return { ok: true, via: "link" };
  }
  setTimeout(() => history.back(), 50);
  return { ok: true, via: "history.back" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return false;
    }
    switch (message.type) {
      case "PROBE_STATE":
        sendResponse(probeState());
        return false;
      case "FILL_AND_SUBMIT":
        sendResponse(fillAndSubmit(message.vin));
        return false;
      case "PICK_AUTO_SELECTION":
        sendResponse(pickAutoSelection(message.lastName, message.policyNumber));
        return false;
      case "CONTINUE_AUTO_SELECTION":
        sendResponse(continueAutoSelection());
        return false;
      case "SCRAPE":
        if (!isOnPolicyInfoPage()) {
          sendResponse({ ok: false, error: "Not on Policy Information page" });
          return false;
        }
        sendResponse({ ok: true, scraped: scrapePolicyInfo() });
        return false;
      case "BACK_TO_SEARCH":
        sendResponse(backToSearch());
        return false;
      default:
        sendResponse({ ok: false, error: `Unknown message type ${message.type}` });
        return false;
    }
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
});
