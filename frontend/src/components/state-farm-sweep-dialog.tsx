"use client";

import { useEffect, useRef, useState } from "react";
import { getIdToken } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientAuth, getClientFirestore } from "@/lib/firebase";
import {
  callStartStateFarmSweep,
  callFinalizeStateFarmSweep,
} from "@/lib/api";
import {
  getExtensionId,
  isChromeAvailable,
  pingExtension,
  setExtensionId,
  startSweepInExtension,
} from "@/lib/extension-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";

interface Props {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

type Phase =
  | "checking-extension"
  | "missing-extension"
  | "ready"
  | "starting"
  | "running"
  | "done"
  | "error";

interface RunDocSnapshot {
  status?: string;
  totalPolicies?: number;
  successCount?: number;
  errorCount?: number;
  completedAt?: unknown;
  startedAt?: unknown;
}

const FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "insurance-track-os";

export function StateFarmSweepDialog({
  orgId,
  orgName,
  open,
  onOpenChange,
  onCompleted,
}: Props) {
  const [phase, setPhase] = useState<Phase>("checking-extension");
  const [error, setError] = useState<string | null>(null);
  const [extensionIdInput, setExtensionIdInputState] = useState("");
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runDoc, setRunDoc] = useState<RunDocSnapshot | null>(null);
  const [policyCount, setPolicyCount] = useState<number | null>(null);
  const completedRef = useRef(false);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setRunId(null);
    setRunDoc(null);
    setPolicyCount(null);
    setExtensionVersion(null);
    setExtensionIdInputState(getExtensionId() ?? "");
    completedRef.current = false;
    void checkExtension();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Subscribe to the run doc once we have a runId.
  useEffect(() => {
    if (!runId) return;
    const db = getClientFirestore();
    const ref = doc(db, "dataFeedRuns", runId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as RunDocSnapshot;
        setRunDoc(data);
        if (
          !completedRef.current &&
          (data.status === "completed" ||
            data.status === "failed" ||
            data.status === "cancelled")
        ) {
          completedRef.current = true;
          setPhase(data.status === "completed" ? "done" : "error");
          if (data.status !== "completed") {
            setError(`Sweep ended with status: ${data.status}`);
          }
          onCompleted?.();
        }
      },
      (err) => {
        setError(err.message);
        setPhase("error");
      },
    );
    return () => unsub();
  }, [runId, onCompleted]);

  async function checkExtension() {
    setPhase("checking-extension");
    if (!isChromeAvailable()) {
      setError(
        "This feature requires Google Chrome. Please open the dashboard in Chrome.",
      );
      setPhase("missing-extension");
      return;
    }
    const result = await pingExtension();
    if (!result) {
      setPhase("missing-extension");
      return;
    }
    setExtensionVersion(result.version ?? null);
    setPhase("ready");
  }

  function saveExtensionId() {
    setExtensionId(extensionIdInput);
    void checkExtension();
  }

  async function startSweep() {
    setError(null);
    setPhase("starting");
    try {
      const auth = getClientAuth();
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const idToken = await getIdToken(user, /* forceRefresh */ false);

      const startRes = await callStartStateFarmSweep({ organizationId: orgId });
      const { runId: newRunId, policies } = startRes.data;
      setRunId(newRunId);
      setPolicyCount(policies.length);

      if (policies.length === 0) {
        await callFinalizeStateFarmSweep({
          runId: newRunId,
          status: "completed",
        });
        return;
      }

      const ext = await startSweepInExtension({
        runId: newRunId,
        policies,
        idToken,
        projectId: FIREBASE_PROJECT_ID,
        organizationId: orgId,
      });
      if (!ext.ok) {
        await callFinalizeStateFarmSweep({
          runId: newRunId,
          status: "failed",
        }).catch(() => {});
        throw new Error(ext.error);
      }
      setPhase("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start sweep");
      setPhase("error");
    }
  }

  const isRunning = phase === "starting" || phase === "running";
  const total = runDoc?.totalPolicies ?? policyCount ?? 0;
  const success = runDoc?.successCount ?? 0;
  const errors = runDoc?.errorCount ?? 0;
  const done = success + errors;

  return (
    <Dialog open={open} onOpenChange={(o) => !isRunning && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>State Farm sweep — {orgName}</DialogTitle>
          <DialogDescription>
            Runs verification on every State Farm policy in this org using a
            Chrome tab you have already logged in to.
          </DialogDescription>
        </DialogHeader>

        {phase === "checking-extension" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Looking for the AutoLienTracker Helper extension…
          </div>
        )}

        {phase === "missing-extension" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 text-yellow-500">
              <ShieldAlert className="h-4 w-4 mt-0.5" />
              <span>
                The AutoLienTracker Helper extension was not found in this
                Chrome profile.
              </span>
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>
                Open <code>chrome://extensions</code> in a new tab.
              </li>
              <li>
                Turn on <strong>Developer mode</strong> (top right).
              </li>
              <li>
                Click <strong>Load unpacked</strong> and choose the{" "}
                <code>extension/</code> folder shipped with this dashboard.
              </li>
              <li>
                Copy the ID shown on the extension card and paste it below.
              </li>
            </ol>
            <div className="space-y-1">
              <Label htmlFor="ext-id">Extension ID</Label>
              <div className="flex gap-2">
                <Input
                  id="ext-id"
                  value={extensionIdInput}
                  onChange={(e) => setExtensionIdInputState(e.target.value)}
                  placeholder="e.g. abcdefghijklmnopabcdefghijklmnop"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <Button onClick={saveExtensionId} disabled={!extensionIdInput.trim()}>
                  Save
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}

        {phase === "ready" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              Extension connected
              {extensionVersion ? ` (v${extensionVersion})` : ""}.
            </div>
            <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-300 text-xs">
              <strong>Before you click Start:</strong>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                <li>Open State Farm B2B and sign in.</li>
                <li>
                  Go to the <em>Insurance Inquiry Tool → Policy Search</em>{" "}
                  page (the one with the VIN field).
                </li>
                <li>Leave that tab open while the sweep runs.</li>
              </ul>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}

        {phase === "starting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing run…
          </div>
        )}

        {phase === "running" && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              Sweep in progress — keep the State Farm tab open and visible.
            </div>
            <ProgressBar done={done} total={total} />
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Verified: {success}</div>
              <div>Errors: {errors}</div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              Sweep complete
            </div>
            <ul className="text-muted-foreground text-xs space-y-0.5">
              <li>Policies: {total}</li>
              <li>Verified: {success}</li>
              <li>Errors: {errors}</li>
              {runId && <li className="truncate">Run ID: {runId}</li>}
            </ul>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 text-red-500">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>{error ?? "Sweep failed"}</span>
            </div>
            {runId && (
              <p className="text-xs text-muted-foreground">Run ID: {runId}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "ready" && (
            <Button onClick={startSweep}>Start sweep</Button>
          )}
          {phase === "missing-extension" && (
            <Button variant="outline" onClick={() => void checkExtension()}>
              I&apos;ve installed it — re-check
            </Button>
          )}
          {(phase === "done" || phase === "error") && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
          {!isRunning && phase !== "done" && phase !== "error" && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="h-2 w-full rounded bg-muted overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {done} / {total} policies ({pct}%)
      </div>
    </div>
  );
}
