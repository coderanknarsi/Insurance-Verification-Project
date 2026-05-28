import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  type Firestore,
  type DocumentData,
  type QuerySnapshot,
  type DocumentSnapshot,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadString, type FirebaseStorage } from "firebase/storage";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";
import type {
  AppStatus,
  CarrierLoginStatus,
  CarrierStatus,
  HumanReviewIpcPrompt,
  OperatorBridge,
  RunPolicyInput,
  RunPolicyResponse,
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
let firebaseDb: Firestore | null = null;
let firebaseStorage: FirebaseStorage | null = null;
let firebaseFunctions: Functions | null = null;

async function initFirebase(): Promise<Auth> {
  if (firebaseAuth) return firebaseAuth;
  const config = await bridge.getFirebaseConfig();
  firebaseApp = initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  firebaseDb = getFirestore(firebaseApp);
  firebaseStorage = getStorage(firebaseApp);
  firebaseFunctions = getFunctions(firebaseApp, "us-central1");
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

async function handleGoogleSignIn(): Promise<void> {
  const errorEl = $("auth-error");
  errorEl.textContent = "";

  const auth = await initFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorEl.textContent = message.includes("operation-not-supported")
      ? "Google sign-in popup was blocked by this app window. Close and reopen the Operator, then try again."
      : message;
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

// ---------------------------------------------------------------------------
// Run engine (renderer-side orchestrator)
// ---------------------------------------------------------------------------

interface PendingRunDoc {
  runId: string;
  carrierId: string;
  status: string;
  totalPolicies?: number;
  organizationId?: string;
}

const runsInFlight = new Set<string>();
const reviewWatchers = new Map<string, () => void>(); // requestId -> unsubscribe
let runUnsub: (() => void) | null = null;

function renderRunStatus(msg: string): void {
  const el = document.getElementById("run-status");
  if (el) el.textContent = msg;
}

function refreshRunSubscription(user: User | null): void {
  if (runUnsub) {
    runUnsub();
    runUnsub = null;
  }
  if (!user || !firebaseDb) {
    renderRunStatus("Sign in to receive sweep runs.");
    return;
  }
  if (!user.email || !SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    renderRunStatus("Not a super admin — runs disabled.");
    return;
  }

  const q = query(
    collection(firebaseDb, "dataFeedRuns"),
    where("mode", "==", "manual-operator"),
    where("createdBy", "==", user.uid),
    where("status", "==", "awaiting_operator"),
  );
  renderRunStatus("Listening for sweep runs…");
  runUnsub = onSnapshot(
    q,
    (snap: QuerySnapshot<DocumentData>) => {
      for (const d of snap.docs) {
        const data = d.data() as PendingRunDoc;
        if (!runsInFlight.has(data.runId)) {
          void processRun(data, user);
        }
      }
    },
    (err) => {
      renderRunStatus(`Firestore listener error: ${err.message}`);
    },
  );
}

async function processRun(run: PendingRunDoc, user: User): Promise<void> {
  if (!firebaseDb || !firebaseFunctions) return;
  runsInFlight.add(run.runId);
  renderRunStatus(`Claiming run ${run.runId}…`);

  try {
    const runRef = doc(firebaseDb, "dataFeedRuns", run.runId);
    await updateDoc(runRef, {
      status: "running",
      operatorMachineId: getMachineId(),
      operatorClaimedAt: serverTimestamp(),
    });
  } catch (err) {
    renderRunStatus(`Failed to claim run: ${err instanceof Error ? err.message : err}`);
    runsInFlight.delete(run.runId);
    return;
  }

  // Fetch policy queue from the run doc. The backend's startManualCarrierSweep
  // returns policies inline; if a run reaches us via Firestore alone we need
  // another source. For now we store the policy queue on the run itself.
  const runSnap = await getDocOnce(doc(firebaseDb, "dataFeedRuns", run.runId));
  const policies = (runSnap?.data()?.policyQueue ?? []) as RunPolicyInput[];

  if (policies.length === 0) {
    renderRunStatus(`Run ${run.runId} has no policies queued.`);
  }

  let ok = 0;
  let err = 0;

  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i];
    renderRunStatus(
      `Run ${run.runId}: ${i + 1}/${policies.length} — ${policy.vin}`,
    );
    try {
      const resp = await bridge.runPolicy({
        runId: run.runId,
        carrierId: run.carrierId,
        policy,
      });
      const screenshotPaths = await uploadScreenshots(run.runId, policy.policyId, resp.screenshots);
      await recordResult(run.runId, policy.policyId, resp, screenshotPaths);
      if (resp.result.status === "found") ok++;
      else err++;
    } catch (e) {
      err++;
      renderRunStatus(
        `Policy ${policy.policyId} failed: ${e instanceof Error ? e.message : e}`,
      );
      try {
        await callRecordManualSweepResult({
          runId: run.runId,
          policyId: policy.policyId,
          error: e instanceof Error ? e.message : String(e),
        });
      } catch {
        // ignore
      }
    }
  }

  try {
    const finalize = httpsCallable(firebaseFunctions, "finalizeManualSweep");
    await finalize({ runId: run.runId, status: "completed" });
  } catch (e) {
    renderRunStatus(
      `Finalize failed: ${e instanceof Error ? e.message : e}`,
    );
  }
  renderRunStatus(
    `Run ${run.runId} finished — ${ok} ok, ${err} errors. Listening for next run.`,
  );
  runsInFlight.delete(run.runId);
  void user; // silence unused
}

async function getDocOnce(
  ref: ReturnType<typeof doc>,
): Promise<DocumentSnapshot<DocumentData> | null> {
  // Light wrapper using onSnapshot for a single read so we don't pull getDoc.
  return new Promise((resolve) => {
    const unsub = onSnapshot(
      ref,
      (snap) => {
        unsub();
        resolve(snap);
      },
      () => {
        resolve(null);
      },
    );
  });
}

async function uploadScreenshots(
  runId: string,
  policyId: string,
  shots: Array<{ label: string; base64: string }>,
): Promise<string[]> {
  if (!firebaseStorage || shots.length === 0) return [];
  const paths: string[] = [];
  for (const s of shots) {
    const safe = s.label.replace(/[^a-z0-9\-_.]/gi, "_");
    const path = `dataFeedRuns/${runId}/results/${policyId}/${safe}.png`;
    const ref = storageRef(firebaseStorage, path);
    try {
      await uploadString(ref, s.base64, "base64", {
        contentType: "image/png",
      });
      paths.push(path);
    } catch (err) {
      console.warn("Screenshot upload failed", path, err);
    }
  }
  return paths;
}

async function recordResult(
  runId: string,
  policyId: string,
  resp: RunPolicyResponse,
  screenshotPaths: string[],
): Promise<void> {
  const payload: Record<string, unknown> = {
    runId,
    policyId,
    durationMs: resp.durationMs,
    screenshotPaths,
  };
  if (resp.result.status === "found") {
    payload.scraped = resp.result.data.raw ?? {};
  } else if (resp.result.status === "not-found") {
    payload.error = "Policy not found";
  } else if (resp.result.status === "error") {
    payload.error = resp.result.reason;
  } else if (resp.result.status === "needs-review") {
    payload.error = `Needs review: ${resp.result.reviewId}`;
  }
  await callRecordManualSweepResult(payload);
}

async function callRecordManualSweepResult(
  payload: Record<string, unknown>,
): Promise<void> {
  if (!firebaseFunctions) return;
  const fn = httpsCallable(firebaseFunctions, "recordManualSweepResult");
  await fn(payload);
}

function getMachineId(): string {
  let id = localStorage.getItem("operator.machineId");
  if (!id) {
    id = `op-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("operator.machineId", id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Human review prompts (mid-policy)
// ---------------------------------------------------------------------------

async function handleHumanReviewPrompt(p: HumanReviewIpcPrompt): Promise<void> {
  if (!firebaseFunctions || !firebaseDb) {
    await bridge.resolveHumanReview({ requestId: p.requestId, choice: "" });
    return;
  }
  let reviewId: string | undefined;
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { reviewId: string }
    >(firebaseFunctions, "requestHumanReview");
    const res = await fn({
      runId: p.runId,
      policyId: p.policyId,
      prompt: p.prompt,
      options: p.options,
      screenshotPath: p.screenshotLabel,
    });
    reviewId = res.data?.reviewId;
  } catch (err) {
    console.error("requestHumanReview failed", err);
    await bridge.resolveHumanReview({ requestId: p.requestId, choice: "" });
    return;
  }

  if (!reviewId) {
    await bridge.resolveHumanReview({ requestId: p.requestId, choice: "" });
    return;
  }

  // Subscribe to the review doc until it's resolved.
  const reviewRef = doc(
    firebaseDb,
    "dataFeedRuns",
    p.runId,
    "humanReviews",
    reviewId,
  );
  const unsub = onSnapshot(reviewRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === "resolved" && typeof data.choice === "string") {
      unsub();
      reviewWatchers.delete(p.requestId);
      await bridge.resolveHumanReview({
        requestId: p.requestId,
        choice: data.choice,
      });
    }
  });
  reviewWatchers.set(p.requestId, unsub);
  renderRunStatus(
    `Waiting for human review on policy ${p.policyId}: ${p.prompt.slice(0, 80)}`,
  );
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
  onAuthStateChanged(auth, (user) => {
    renderUser(user);
    refreshRunSubscription(user);
  });

  ($("signin-form") as HTMLFormElement).addEventListener("submit", handleSignIn);
  $("google-signin-btn").addEventListener("click", handleGoogleSignIn);
  $("signout-btn").addEventListener("click", handleSignOut);
  $("relaunch-chrome-btn").addEventListener("click", handleRelaunchChrome);

  // Human-review prompts from main process.
  bridge.onHumanReviewRequested(handleHumanReviewPrompt);
}

main().catch((err) => {
  const el = document.getElementById("fatal-error");
  if (el) el.textContent = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(err);
});
