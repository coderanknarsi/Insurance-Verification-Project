import { contextBridge, ipcRenderer } from "electron";
import type { AppStatus, FirebaseConfig, OperatorBridge } from "../shared/bridge-types";

const bridge: OperatorBridge = {
  getFirebaseConfig: () => ipcRenderer.invoke("operator:get-firebase-config") as Promise<FirebaseConfig>,
  getAppStatus: () => ipcRenderer.invoke("operator:get-app-status") as Promise<AppStatus>,
  onAppStatus: (callback) => {
    const listener = (_e: unknown, status: AppStatus) => callback(status);
    ipcRenderer.on("operator:app-status", listener);
    return () => ipcRenderer.removeListener("operator:app-status", listener);
  },
  relaunchChrome: () => ipcRenderer.invoke("operator:relaunch-chrome") as Promise<void>,
};

contextBridge.exposeInMainWorld("operator", bridge);
