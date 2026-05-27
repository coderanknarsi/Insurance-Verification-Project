import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import type {
  AppStatus,
  CarrierLoginStatus,
  CarrierStatus,
  OperatorBridge,
} from "../shared/bridge-types";

declare global {
  interface Window {
    operator: OperatorBridge;
  }
}

const bridge = window.operator;

const SUPER_ADMIN_EMAILS = ["info@autolientracker.com"];

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

async function initFirebase(): Promise<Auth> {
  if (firebaseAuth) return firebaseAuth;
  const config = await bridge.getFirebaseConfig();
  firebaseApp = initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function renderChromeStatus(status: AppStatus): void {
  const dot = $("chrome-dot");
  const label = $("chrome-label");
  const detail = $("chrome-detail");
  const c = status.chrome;
  dot.className = "dot " + chromeDotClass(c.status);
  switch (c.status) {
    case "idle":
      label.textContent = "Idle";
      detail.textContent = "Chrome not started yet.";
      break;
    case "launching":
      label.textContent = "Launching";
      detail.textContent = "Starting managed Chrome window…";
      break;
    case "connected":
      label.textContent = "Connected";
      detail.textContent = `CDP on port ${c.debugPort} · ${c.contextCount} context(s)`;
      break;
    case "disconnected":
      label.textContent = "Disconnected";
      detail.textContent = c.reason;
      break;
    case "error":
      label.textContent = "Error";
      detail.textContent = c.message;
      break;
  }
}

function chromeDotClass(state: string): string {
  switch (state) {
    case "connected":
      return "green";
    case "launching":
      return "yellow";
    case "error":
    case "disconnected":
      return "red";
    default:
      return "grey";
  }
}

function renderUser(user: User | null): void {
  const signedIn = $("signed-in");
  const signedOut = $("signed-out");
  const email = $("user-email");
  const guard = $("guard-msg");

  if (!user) {
    signedIn.style.display = "none";
    signedOut.style.display = "block";
    guard.style.display = "none";
    return;
  }

  signedIn.style.display = "block";
  signedOut.style.display = "none";
  email.textContent = user.email ?? "(no email)";

  if (!user.email || !SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    guard.style.display = "block";
    guard.textContent = "This account is not a super admin. Sweeps will not run.";
  } else {
    guard.style.display = "none";
  }
}

async function handleSignIn(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const emailInput = $("email") as HTMLInputElement;
  const passwordInput = $("password") as HTMLInputElement;
  const errorEl = $("auth-error");
  errorEl.textContent = "";

  const auth = await initFirebase();
  try {
    await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    passwordInput.value = "";
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function handleSignOut(): Promise<void> {
  if (firebaseAuth) await fbSignOut(firebaseAuth);
}

async function handleRelaunchChrome(): Promise<void> {
  await bridge.relaunchChrome();
}

function carrierPillClass(status: CarrierLoginStatus): string {
  switch (status) {
    case "logged-in": return "green";
    case "checking": return "yellow";
    case "logged-out": return "red";
    case "error": return "red";
    default: return "grey";
  }
}

function carrierPillLabel(status: CarrierLoginStatus): string {
  switch (status) {
    case "logged-in": return "Logged in";
    case "checking": return "Checking…";
    case "logged-out": return "Login needed";
    case "error": return "Error";
    default: return "Unknown";
  }
}

function renderCarriers(statuses: CarrierStatus[]): void {
  const container = $("carriers-list");
  if (statuses.length === 0) {
    container.innerHTML = '<div class="detail">No carriers configured.</div>';
    return;
  }
  container.innerHTML = "";
  for (const c of statuses) {
    const row = document.createElement("div");
    row.className = "carrier-row";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "label";
    name.textContent = c.name;
    const sub = document.createElement("div");
    sub.className = "detail";
    sub.textContent = formatCarrierSub(c);
    left.appendChild(name);
    left.appendChild(sub);

    const pill = document.createElement("span");
    pill.className = "pill " + carrierPillClass(c.status);
    pill.textContent = carrierPillLabel(c.status);

    const actions = document.createElement("div");
    actions.className = "actions";

    const loginBtn = document.createElement("button");
    loginBtn.className = "secondary";
    loginBtn.textContent = "Open login";
    loginBtn.onclick = () => {
      bridge.openCarrierLogin(c.id).catch((err) => {
        sub.textContent = err instanceof Error ? err.message : String(err);
      });
    };

    const recheckBtn = document.createElement("button");
    recheckBtn.className = "secondary";
    recheckBtn.textContent = "Recheck";
    recheckBtn.onclick = () => {
      bridge.recheckCarrier(c.id).catch(() => {});
    };

    actions.appendChild(loginBtn);
    actions.appendChild(recheckBtn);

    row.appendChild(left);
    row.appendChild(pill);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

function formatCarrierSub(c: CarrierStatus): string {
  if (c.lastError) return c.lastError;
  if (!c.lastCheckedAt) return "Not checked yet";
  const secs = Math.max(0, Math.round((Date.now() - c.lastCheckedAt) / 1000));
  return `Last checked ${secs}s ago`;
}

async function main(): Promise<void> {
  // Wire status updates.
  const initial = await bridge.getAppStatus();
  renderChromeStatus(initial);
  bridge.onAppStatus(renderChromeStatus);

  // Carrier statuses.
  const initialCarriers = await bridge.getCarrierStatuses();
  renderCarriers(initialCarriers);
  bridge.onCarrierStatuses(renderCarriers);

  // Firebase Auth.
  const auth = await initFirebase();
  onAuthStateChanged(auth, renderUser);

  ($("signin-form") as HTMLFormElement).addEventListener("submit", handleSignIn);
  $("signout-btn").addEventListener("click", handleSignOut);
  $("relaunch-chrome-btn").addEventListener("click", handleRelaunchChrome);
}

main().catch((err) => {
  const el = document.getElementById("fatal-error");
  if (el) el.textContent = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(err);
});
