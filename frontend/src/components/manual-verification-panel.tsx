"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  callGetManualVerifications,
  callMarkPolicyManuallyVerified,
  type ManualVerificationRow,
} from "@/lib/api";

interface ManualVerificationPanelProps {
  organizationId: string;
}

export function ManualVerificationPanel({ organizationId }: ManualVerificationPanelProps) {
  const [rows, setRows] = useState<ManualVerificationRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const res = await callGetManualVerifications({ organizationId });
      setRows(res.data.rows);
    } catch {
      // stay empty
    } finally {
      setLoadingRows(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleMarkVerified = async (policyId: string) => {
    setSavingId(policyId);
    try {
      await callMarkPolicyManuallyVerified({
        organizationId,
        policyId,
        note: note.trim() || undefined,
        confirmedExpirationDate: expiry || undefined,
      });
      setExpanded(null);
      setNote("");
      setExpiry("");
      await fetchRows();
    } catch {
      // ignore — row stays
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-card-bg border border-border-subtle rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-yellow-400" />
          <h3 className="text-base font-semibold text-offwhite">Needs Manual Verification</h3>
          <span className="text-xs text-carbon-light bg-surface px-2 py-0.5 rounded-full">
            {rows.length}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchRows}
          disabled={loadingRows}
          className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingRows ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="px-6 py-3 border-b border-border-subtle bg-surface/40">
        <p className="text-xs text-carbon-light">
          These policies are with carriers we can&apos;t verify automatically. Confirm coverage from
          the insurer&apos;s lienholder notice / Evidence of Insurance, then mark them verified here.
        </p>
      </div>

      {loadingRows ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-carbon-light">
          <CheckCircle className="w-8 h-8 mb-3 opacity-40" />
          <p className="text-sm">Nothing needs manual verification</p>
          <p className="text-xs mt-1 opacity-60">
            Policies on unsupported carriers will appear here
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <div key={row.policyId} className="px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-offwhite truncate">
                      {row.borrowerName}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
                      {row.insuranceProvider ?? "Unknown carrier"}
                    </span>
                    {row.reason === "unsupported_carrier" && (
                      <span className="text-[10px] uppercase tracking-wide text-carbon-light flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No portal automation
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-carbon-light mt-0.5 truncate">
                    {row.vehicleLabel ?? row.vin ?? "—"}
                    {row.policyNumber ? ` · #${row.policyNumber}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setExpanded((cur) => (cur === row.policyId ? null : row.policyId))
                  }
                  className="bg-transparent border-border-subtle text-offwhite hover:bg-white/[0.04] shrink-0"
                >
                  {expanded === row.policyId ? "Cancel" : "Mark Verified"}
                </Button>
              </div>

              {expanded === row.policyId && (
                <div className="mt-3 bg-surface border border-border-subtle rounded-lg p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-carbon-light">Note (optional)</label>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Confirmed via carrier EOI mailer"
                        className="mt-1 w-full bg-card-bg border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-carbon-light">
                        Confirmed expiration (optional)
                      </label>
                      <input
                        type="date"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        className="mt-1 w-full bg-card-bg border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => handleMarkVerified(row.policyId)}
                      disabled={savingId === row.policyId}
                      className="bg-accent hover:bg-accent-hover text-white border-0"
                    >
                      {savingId === row.policyId ? "Saving…" : "Confirm Verified"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
