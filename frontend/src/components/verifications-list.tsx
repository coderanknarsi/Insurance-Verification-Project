"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShieldCheck,
  Mail,
  Smartphone,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Send,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { callGetVerifications, callSeedVerificationData } from "@/lib/api";
import type { VerificationRecord } from "@/lib/api";

interface VerificationsListProps {
  organizationId: string;
}

const triggerLabels: Record<string, string> = {
  LAPSE_DETECTED: "Lapse Detected",
  EXPIRING_SOON: "Expiring Soon",
  REINSTATEMENT_REMINDER: "Reinstatement Reminder",
  INTAKE_REQUESTED: "Intake Request Sent",
  DEALER_SUBMITTED: "Dealer Upload",
  INTAKE_COMPLETED: "Borrower Submitted",
};

const statusConfig: Record<string, { icon: typeof CheckCircle; bg: string; text: string; label: string }> = {
  SENT: { icon: CheckCircle, bg: "bg-green-500/15", text: "text-green-400", label: "Sent" },
  DELIVERED: { icon: CheckCircle, bg: "bg-blue-500/15", text: "text-blue-400", label: "Delivered" },
  PENDING: { icon: Clock, bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Pending" },
  FAILED: { icon: XCircle, bg: "bg-red-500/15", text: "text-red-400", label: "Failed" },
  COMPLETED: { icon: CheckCircle, bg: "bg-accent/15", text: "text-accent", label: "Completed" },
};

export function VerificationsList({ organizationId }: VerificationsListProps) {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("ALL");
  const [seeding, setSeeding] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callGetVerifications({ organizationId });
      setRecords(result.data.verifications);
    } catch {
      // stay empty
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await callSeedVerificationData({ organizationId });
      await fetchData();
    } catch {
      // ignore
    } finally {
      setSeeding(false);
    }
  };

  const filtered = filter === "ALL" ? records : records.filter((r) => r.status === filter);

  const counts = {
    ALL: records.length,
    SENT: records.filter((r) => r.status === "SENT").length,
    DELIVERED: records.filter((r) => r.status === "DELIVERED").length,
    PENDING: records.filter((r) => r.status === "PENDING").length,
    FAILED: records.filter((r) => r.status === "FAILED").length,
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Sent"
          value={counts.SENT + counts.DELIVERED}
          icon={<Send className="w-5 h-5 text-green-400" />}
          accent="green"
        />
        <SummaryCard
          label="Delivered"
          value={counts.DELIVERED}
          icon={<CheckCircle className="w-5 h-5 text-blue-400" />}
          accent="blue"
        />
        <SummaryCard
          label="Pending"
          value={counts.PENDING}
          icon={<Clock className="w-5 h-5 text-yellow-400" />}
          accent="yellow"
        />
        <SummaryCard
          label="Failed"
          value={counts.FAILED}
          icon={<XCircle className="w-5 h-5 text-red-400" />}
          accent="red"
        />
      </div>

      {/* Verification Records Table */}
      <div className="bg-card-bg border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-accent" />
            <h3 className="text-base font-semibold text-offwhite">
              Verification Requests
            </h3>
            <span className="text-xs text-carbon-light bg-surface px-2 py-0.5 rounded-full">
              {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Filter pills */}
            {(["ALL", "SENT", "PENDING", "FAILED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${
                  filter === f
                    ? "bg-accent/15 text-accent"
                    : "text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
                }`}
              >
                {f === "ALL" ? "All" : statusConfig[f]?.label ?? f}
                <span className="ml-1 opacity-60">{counts[f]}</span>
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={loading}
              className="ml-2 bg-transparent border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-carbon-light">Loading verifications...</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-carbon-light">
            <ShieldCheck className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-sm">No verification requests found</p>
            <p className="text-xs mt-1 opacity-60">
              Send verification links from the Dashboard to see them here
            </p>
            {organizationId === "demo-org" && (
              <Button
                size="sm"
                onClick={handleSeed}
                disabled={seeding}
                className="mt-4 bg-accent hover:bg-accent-hover text-white border-0"
              >
                {seeding ? "Seeding..." : "Load Sample Data"}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left py-3 px-6 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Borrower
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Channel
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Sent
                  </th>
                  <th className="text-left py-3 px-6 font-medium text-carbon-light text-xs uppercase tracking-wider">
                    Recipient
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => {
                  const sc = statusConfig[v.status] ?? statusConfig.PENDING;
                  const StatusIcon = sc.icon;
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-border-subtle/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 px-6">
                        <span className="text-offwhite font-medium">{v.borrowerName}</span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {v.channel === "EMAIL" ? (
                            <Mail className="w-3.5 h-3.5 text-blue-400" />
                          ) : v.channel === "PORTAL" ? (
                            <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                          ) : (
                            <Smartphone className="w-3.5 h-3.5 text-green-400" />
                          )}
                          <span className="text-xs text-carbon-light">{v.channel === "PORTAL" ? "Portal" : v.channel}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {v.trigger === "DEALER_SUBMITTED" || v.trigger === "INTAKE_COMPLETED" ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                          ) : v.trigger === "INTAKE_REQUESTED" ? (
                            <Send className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                          )}
                          <span className="text-xs text-carbon-light">
                            {triggerLabels[v.trigger] ?? v.trigger}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.bg} ${sc.text}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {sc.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-carbon-light">
                        {v.sentAt
                          ? new Date(v.sentAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : v.createdAt
                            ? new Date(v.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                      </td>
                      <td className="py-3 px-6 text-xs text-carbon-light">
                        {v.channel === "PORTAL" ? v.content : v.channel === "EMAIL" ? v.borrowerEmail : v.borrowerPhone || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  const borderColor =
    accent === "green"
      ? "border-green-500/20"
      : accent === "blue"
        ? "border-blue-500/20"
        : accent === "yellow"
          ? "border-yellow-500/20"
          : "border-red-500/20";

  return (
    <div className={`bg-card-bg border ${borderColor} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-carbon-light uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <span className="text-2xl font-bold text-offwhite">{value}</span>
    </div>
  );
}
