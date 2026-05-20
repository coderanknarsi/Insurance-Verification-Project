const phaseEl = document.getElementById("phase");
const counterEl = document.getElementById("counter");
const barEl = document.getElementById("bar");
const successEl = document.getElementById("success");
const errorsEl = document.getElementById("errors");
const messageEl = document.getElementById("message");

function render(state) {
  if (!state) {
    phaseEl.textContent = "Idle";
    phaseEl.className = "phase idle";
    counterEl.textContent = "—";
    barEl.value = 0;
    barEl.max = 1;
    successEl.textContent = "0";
    errorsEl.textContent = "0";
    messageEl.textContent = "Start a State Farm sweep from your admin dashboard.";
    return;
  }
  const phase = state.phase || "idle";
  phaseEl.textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
  phaseEl.className = `phase ${phase}`;
  counterEl.textContent = `${state.done}/${state.total}`;
  barEl.value = state.done;
  barEl.max = Math.max(state.total, 1);
  successEl.textContent = String(state.success ?? 0);
  errorsEl.textContent = String(state.errors ?? 0);
  if (state.message) messageEl.textContent = state.message;
}

async function refresh() {
  chrome.runtime.sendMessage({ type: "POPUP_GET_STATE" }, (resp) => {
    render(resp?.state ?? null);
  });
}

document.getElementById("open-sf").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "POPUP_OPEN_STATE_FARM" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.popupState) {
    render(changes.popupState.newValue ?? null);
  }
});

refresh();
