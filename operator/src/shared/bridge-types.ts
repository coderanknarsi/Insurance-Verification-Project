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

export interface OperatorBridge {
  getFirebaseConfig: () => Promise<FirebaseConfig>;
  getAppStatus: () => Promise<AppStatus>;
  onAppStatus: (callback: (status: AppStatus) => void) => () => void;
  relaunchChrome: () => Promise<void>;
  getCarrierStatuses: () => Promise<CarrierStatus[]>;
  onCarrierStatuses: (callback: (statuses: CarrierStatus[]) => void) => () => void;
  openCarrierLogin: (carrierId: string) => Promise<void>;
  recheckCarrier: (carrierId: string) => Promise<void>;
}
