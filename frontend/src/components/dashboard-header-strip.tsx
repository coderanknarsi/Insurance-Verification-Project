"use client";
import { useEffect, useState } from "react";
import { Calendar, Clock, ShieldCheck, AlertTriangle } from "lucide-react";
import { callGetOrgVerificationStatus, type OrgVerificationStatus } from "@/lib/api";

interface DashboardHeaderStripProps {
  organizationId: string;
  /** Fired once the verification status loads, so the parent can surface
   *  overdue policy IDs (per-row badges) without a second network call. */
  onStatusLoaded?: (status: OrgVerificationStatus) => void;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const days = Math.round(abs / (1000 * 60 * 60 * 24));
  if (diff > 0) {
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  }
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function DashboardHeaderStrip({ organizationId, onStatusLoaded }: DashboardHeaderStripProps) {
  const [status, setStatus] = useState<OrgVerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    callGetOrgVerificationStatus({ organizationId })
      .then(({ data }) => {
        if (!cancelled) {
          setStatus(data);
          onStatusLoaded?.(data);
        }
      })
      .catch((err) => {
        console.error("[DashboardHeaderStrip] failed", err);
        if (!cancelled) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, onStatusLoaded]);

  if (loading || !status) {
    // If data cannot be loaded, hide this optional strip instead of showing
    // an indefinite shimmer that looks broken.
    if (hasError && !status) {
      return null;
    }

    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 mb-4">
        <div className="h-5 w-64 rounded bg-white/5" />
      </div>
    );
  }

  const dayLabel = WEEKDAY_LABELS[status.verificationDayOfWeek - 1];
  const inScope = status.inScopeCounts.insuredSupported;
  const total =
    status.inScopeCounts.insuredSupported +
    status.inScopeCounts.insuredUnsupported +
    status.inScopeCounts.insuredNoCreds +
    status.inScopeCounts.pendingUpload;

  return (
    <div className="mb-4 space-y-2">
      {status.staleCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
          <div>
            <span className="font-medium text-amber-300">
              {status.staleCount} {status.staleCount === 1 ? "policy is" : "policies are"} overdue for verification.
            </span>{" "}
            <span className="text-carbon-light">
              Their last successful check is more than 8 days old, so the status shown may be stale.
            </span>
          </div>
        </div>
      )}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2 text-foreground">
          <Calendar className="h-4 w-4 text-blue-400" />
          <span className="text-carbon">Sweep day:</span>
          <span className="font-medium">{dayLabel}</span>
          {status.isOverride && (
            <span className="text-[10px] uppercase tracking-wide text-blue-400">
              (override)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-foreground">
          <Clock className="h-4 w-4 text-amber-400" />
          <span className="text-carbon">Last sweep:</span>
          <span className="font-medium">{formatRelative(status.lastSweepAt)}</span>
          <span className="text-carbon">·</span>
          <span className="text-carbon">Next:</span>
          <span className="font-medium">{formatRelative(status.nextSweepAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-carbon">In scope:</span>
          <span className="font-medium">
            {inScope} of {total}
          </span>
        </div>
      </div>
    </div>
  );
}
