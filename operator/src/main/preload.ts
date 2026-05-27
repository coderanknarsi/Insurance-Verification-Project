import { contextBridge, ipcRenderer } from "electron";
import type {
  AppStatus,
  CarrierStatus,
  FirebaseConfig,
  OperatorBridge,
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
};

contextBridge.exposeInMainWorld("operator", bridge);
