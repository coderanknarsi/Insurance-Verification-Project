import { contextBridge, ipcRenderer } from "electron";
import type {
  AppStatus,
  CarrierStatus,
  FirebaseConfig,
  HumanReviewIpcPrompt,
  HumanReviewIpcReply,
  OperatorBridge,
  RunPolicyRequest,
  RunPolicyResponse,
} from "../shared/bridge-types";

const bridge: OperatorBridge = {
  getFirebaseConfig: () =>
    ipcRenderer.invoke("operator:get-firebase-config") as Promise<FirebaseConfig>,
  getAppStatus: () =>
    ipcRenderer.invoke("operator:get-app-status") as Promise<AppStatus>,
  onAppStatus: (callback) => {
    const listener = (_e: unknown, status: AppStatus) => callback(status);
    ipcRenderer.on("operator:app-status", listener);
    return () => ipcRenderer.removeListener("operator:app-status", listener);
  },
  relaunchChrome: () =>
    ipcRenderer.invoke("operator:relaunch-chrome") as Promise<void>,
  getCarrierStatuses: () =>
    ipcRenderer.invoke("operator:get-carrier-statuses") as Promise<CarrierStatus[]>,
  onCarrierStatuses: (callback) => {
    const listener = (_e: unknown, statuses: CarrierStatus[]) => callback(statuses);
    ipcRenderer.on("operator:carrier-statuses", listener);
    return () => ipcRenderer.removeListener("operator:carrier-statuses", listener);
  },
  openCarrierLogin: (carrierId) =>
    ipcRenderer.invoke("operator:open-carrier-login", carrierId) as Promise<void>,
  recheckCarrier: (carrierId) =>
    ipcRenderer.invoke("operator:recheck-carrier", carrierId) as Promise<void>,
  runPolicy: (req: RunPolicyRequest) =>
    ipcRenderer.invoke("operator:run-policy", req) as Promise<RunPolicyResponse>,
  onHumanReviewRequested: (callback) => {
    const listener = (_e: unknown, prompt: HumanReviewIpcPrompt) => callback(prompt);
    ipcRenderer.on("operator:human-review-requested", listener);
    return () =>
      ipcRenderer.removeListener("operator:human-review-requested", listener);
  },
  resolveHumanReview: (reply: HumanReviewIpcReply) =>
    ipcRenderer.invoke("operator:resolve-human-review", reply) as Promise<void>,
};

contextBridge.exposeInMainWorld("operator", bridge);
