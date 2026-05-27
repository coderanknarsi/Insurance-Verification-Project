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

export interface AppStatus {
  chrome: ChromeConnectionState;
  appVersion: string;
}

export interface OperatorBridge {
  getFirebaseConfig: () => Promise<FirebaseConfig>;
  getAppStatus: () => Promise<AppStatus>;
  onAppStatus: (callback: (status: AppStatus) => void) => () => void;
  relaunchChrome: () => Promise<void>;
}
