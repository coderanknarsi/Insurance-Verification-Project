"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  callStartPortfolioSweep,
  callGetManualVerifications,
  callMarkPolicyManuallyVerified,
  type StartPortfolioSweepResult,
  type ManualVerificationRow,
} from "@/lib/api";

interface PortfolioSweepPanelProps {
  organizationId: string;
}

function carrierLabel(id: string): string {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PortfolioSweepPanel({ organizationId }: PortfolioSweepPanelProps) {
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<StartPortfolioSweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleSweep = async () => {
    setSweeping(true);
    setError(null);
    setSweepResult(null);
    try {
      const res = await callStartPortfolioSweep({ organizationId });
      setSweepResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sweep");
    } finally {
      setSweeping(false);
    }
  };

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
    <div className="space-y-6">
      {/* Sweep card */}
      <div className="bg-card-bg border border-border-subtle rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-offwhite">Sweep Entire Portfolio</h3>
              <p className="text-xs text-carbon-light mt-1 max-w-xl">
                Verifies every supported policy in one pass. Open the AutoLien Operator and log
                into the carrier portals it asks for — the sweep starts automatically once you&apos;re
                logged in. Carriers without portal automation are listed below for manual
                verification from the insurer&apos;s lienholder notices.
              </p>
            </div>
          </div>
          <Button
            onClick={handleSweep}
            disabled={sweeping}
            className="bg-accent hover:bg-accent-hover text-white border-0 shrink-0"
          >
            {sweeping ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Queuing…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" /> Sweep Portfolio
              </>
            )}
          </Button>
        </div>

        {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {sweepResult && (
          <div className="mt-4 bg-surface border border-border-subtle rounded-lg px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <p className="text-sm text-offwhite">
                Queued <span className="font-semibold">{sweepResult.totalPolicies}</span>{" "}
                {sweepResult.totalPolicies === 1 ? "policy" : "policies"} for the operator.
              </p>
            </div>
            {sweepResult.carriersToLogin.length > 0 && (
              <p className="text-xs text-carbon-light pl-6">
                Log into:{" "}
                <span className="text-offwhite">
                  {sweepResult.carriersToLogin.map(carrierLabel).join(", ")}
                </span>
              </p>
            )}
            {sweepResult.manualReviewCount > 0 && (
              <p className="text-xs text-carbon-light pl-6 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-yellow-400" />
                {sweepResult.manualReviewCount} need manual verification (see below).
              </p>
            )}
          </div>
        )}
      </div>

      {/* Manual verification worklist */}
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
    </div>
  );
}
