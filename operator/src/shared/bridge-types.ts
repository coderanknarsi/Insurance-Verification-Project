// Shared types used by both main and renderer over IPC.
// Keep this file dependency-free.

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export type ChromeConnectionState =
  | { status: "idle" }
  | { status: "launching" }
  | { status: "connected"; debugPort: number; contextCount: number }
  | { status: "disconnected"; reason: string }
  | { status: "error"; message: string };

export type CarrierLoginStatus =
  | "unknown"
  | "checking"
  | "logged-in"
  | "logged-out"
  | "error";

export interface CarrierStatus {
  id: string;
  name: string;
  loginUrl: string;
  searchUrl: string;
  status: CarrierLoginStatus;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface AppStatus {
  chrome: ChromeConnectionState;
  appVersion: string;
}

// --- Run engine bridge types ---

export interface RunPolicyInput {
  policyId: string;
  vin: string;
  borrowerLastName: string;
  borrowerFirstName?: string;
  policyNumber?: string;
  insuranceProvider?: string;
  /** Per-policy carrier for mixed-carrier (portfolio) runs. Falls back to the run's carrierId. */
  carrierId?: string;
}

export interface RunPolicyRequest {
  runId: string;
  carrierId: string;
  policy: RunPolicyInput;
}

export type RunScrapeResult =
  | { status: "found"; data: { policyNumber?: string; raw?: Record<string, unknown> } }
  | { status: "not-found" }
  | { status: "error"; reason: string }
  | { status: "needs-review"; reviewId: string };

export interface RunPolicyResponse {
  result: RunScrapeResult;
  screenshots: Array<{ label: string; base64: string }>;
  logs: Array<{ ts: number; msg: string; data?: unknown }>;
  durationMs: number;
}

export interface HumanReviewIpcPrompt {
  requestId: string;
  runId: string;
  policyId: string;
  prompt: string;
  options: Array<{ id: string; label: string; description?: string }>;
  screenshotLabel?: string;
}

export interface HumanReviewIpcReply {
  requestId: string;
  choice: string;
}

export interface OperatorBridge {
  getFirebaseConfig: () => Promise<FirebaseConfig>;
  getAppStatus: () => Promise<AppStatus>;
  onAppStatus: (callback: (status: AppStatus) => void) => () => void;
  relaunchChrome: () => Promise<void>;
  getCarrierStatuses: () => Promise<CarrierStatus[]>;
  onCarrierStatuses: (callback: (statuses: CarrierStatus[]) => void) => () => void;
  openCarrierLogin: (carrierId: string) => Promise<void>;
  recheckCarrier: (carrierId: string) => Promise<void>;
  runPolicy: (req: RunPolicyRequest) => Promise<RunPolicyResponse>;
  onHumanReviewRequested: (
    callback: (prompt: HumanReviewIpcPrompt) => void,
  ) => () => void;
  resolveHumanReview: (reply: HumanReviewIpcReply) => Promise<void>;
}
