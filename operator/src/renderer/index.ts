import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { AppStatus, OperatorBridge } from "../shared/bridge-types";

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

async function main(): Promise<void> {
  // Wire status updates.
  const initial = await bridge.getAppStatus();
  renderChromeStatus(initial);
  bridge.onAppStatus(renderChromeStatus);

  // Wire Firebase Auth.
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
