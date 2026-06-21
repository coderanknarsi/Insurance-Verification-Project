"use client";

import { useEffect, useState, useCallback } from "react";
import {
  callGetAdminBorrowerDetail,
  callAdminOverridePolicyStatus,
  callStartManualCarrierSweep,
  type AdminBorrowerDetailData,
  type AdminBorrowerPolicy,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Mail,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  GREEN: "bg-green-500/10 text-green-600 border-green-500/30",
  YELLOW: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  RED: "bg-red-500/10 text-red-600 border-red-500/30",
};

function fmt(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminBorrowerSupport({
  organizationId,
  borrowerId,
  open,
  onClose,
}: {
  organizationId: string;
  borrowerId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminBorrowerDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPolicy, setBusyPolicy] = useState<string | null>(null);
  const [overrideNote, setOverrideNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!borrowerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await callGetAdminBorrowerDetail({ organizationId, borrowerId });
      setDetail(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load borrower detail.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, borrowerId]);

  useEffect(() => {
    if (open && borrowerId) void load();
    if (!open) setDetail(null);
  }, [open, borrowerId, load]);

  const reVerify = async (policy: AdminBorrowerPolicy) => {
    if (!borrowerId || !policy.carrierName) return;
    setBusyPolicy(policy.id);
    try {
      await callStartManualCarrierSweep({
        organizationId,
        carrierId: policy.carrierName,
        borrowerId,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-verify failed.");
    } finally {
      setBusyPolicy(null);
    }
  };

  const override = async (
    policy: AdminBorrowerPolicy,
    dashboardStatus: "GREEN" | "YELLOW" | "RED",
  ) => {
    setBusyPolicy(policy.id);
    try {
      await callAdminOverridePolicyStatus({
        policyId: policy.id,
        organizationId,
        dashboardStatus,
        note: overrideNote[policy.id] || undefined,
      });
      setOverrideNote((m) => ({ ...m, [policy.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Override failed.");
    } finally {
      setBusyPolicy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {detail
              ? `${detail.borrower.firstName} ${detail.borrower.lastName}`
              : "Borrower support"}
          </DialogTitle>
          <DialogDescription>
            {detail?.borrower.email ?? ""}
            {detail?.borrower.phone ? ` · ${detail.borrower.phone}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="space-y-6">
            {/* Policies */}
            {detail.policies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No policies for this borrower.</p>
            ) : (
              detail.policies.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {p.dashboardStatus && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                            STATUS_COLORS[p.dashboardStatus] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {p.dashboardStatus}
                        </span>
                      )}
                      <span className="text-sm font-medium">
                        {p.carrierName ?? "Unknown carrier"}
                      </span>
                      {p.policyNumber && (
                        <span className="text-xs text-muted-foreground">
                          #{p.policyNumber}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyPolicy === p.id || !p.carrierName}
                      onClick={() => reVerify(p)}
                    >
                      {busyPolicy === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">Re-verify</span>
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Last verified: {fmt(p.lastVerifiedAtMs)}
                    {p.verificationSource ? ` · via ${p.verificationSource}` : ""}
                  </div>

                  {p.lastVerificationError && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600">
                      Last error: {p.lastVerificationError}
                    </div>
                  )}

                  {p.complianceIssues.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.complianceIssues.map((i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {i.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Attempt history */}
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      Verification attempts ({p.attempts.length})
                    </p>
                    {p.attempts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No attempts recorded.</p>
                    ) : (
                      <div className="space-y-1">
                        {p.attempts.map((a, i) => (
                          <div
                            key={`${a.policyId}-${a.createdAtMs}-${i}`}
                            className="flex items-center gap-2 text-xs"
                          >
                            {a.success ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                            )}
                            <span className="text-muted-foreground">{fmt(a.createdAtMs)}</span>
                            {a.durationMs != null && (
                              <span className="text-muted-foreground">
                                · {(a.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                            {a.errorReason && (
                              <span className="text-red-600 truncate">· {a.errorReason}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual override */}
                  <div className="flex items-center gap-2 pt-1">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      placeholder="Override note (optional)"
                      value={overrideNote[p.id] ?? ""}
                      onChange={(e) =>
                        setOverrideNote((m) => ({ ...m, [p.id]: e.target.value }))
                      }
                      className="h-8 text-xs"
                    />
                    <Select
                      onValueChange={(v) =>
                        override(p, v as "GREEN" | "YELLOW" | "RED")
                      }
                      disabled={busyPolicy === p.id}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue placeholder="Set status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GREEN">GREEN</SelectItem>
                        <SelectItem value="YELLOW">YELLOW</SelectItem>
                        <SelectItem value="RED">RED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))
            )}

            {/* Notifications */}
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">
                Notifications ({detail.notifications.length})
              </p>
              {detail.notifications.length === 0 ? (
                <p className="text-xs text-muted-foreground">No notifications sent.</p>
              ) : (
                <div className="space-y-1">
                  {detail.notifications.map((n) => (
                    <div key={n.id} className="flex items-center gap-2 text-xs">
                      {n.channel === "EMAIL" ? (
                        <Mail className="h-3 w-3 shrink-0" />
                      ) : (
                        <MessageSquare className="h-3 w-3 shrink-0" />
                      )}
                      <span className="text-muted-foreground">{fmt(n.createdAtMs)}</span>
                      <span>{n.trigger?.replace(/_/g, " ")}</span>
                      <Badge
                        variant={
                          n.status === "DELIVERED"
                            ? "default"
                            : n.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {n.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
