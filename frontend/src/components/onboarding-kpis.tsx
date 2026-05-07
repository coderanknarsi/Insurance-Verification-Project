"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle2,
  Clock,
  HandHelping,
  Timer,
  Phone,
  Mail,
  Loader2,
  ChevronRight,
  X,
} from "lucide-react";
import {
  callGetDashboardSummary,
  callGetStaffTasks,
  callResolveStaffTask,
  type DashboardSummary,
  type StaffTaskRow,
} from "@/lib/api";

interface OnboardingKpisProps {
  organizationId: string;
  /** Bumped by parent to force refetch (e.g. after import). */
  refreshKey?: number;
}

function formatHours(h: number): string {
  if (h >= 100) return `${Math.round(h)} h`;
  return `${h.toFixed(1)} h`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function OnboardingKpis({ organizationId, refreshKey = 0 }: OnboardingKpisProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tasks, setTasks] = useState<StaffTaskRow[]>([]);
  const [tasksAvailable, setTasksAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQueue, setShowQueue] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setLoadError(null);

    // Summary is the primary data; tasks are admin/manager-only and may fail
    // with permission-denied for other roles — handle them independently.
    const [summaryResult, tasksResult] = await Promise.allSettled([
      callGetDashboardSummary({ organizationId }),
      callGetStaffTasks({ organizationId, status: "OPEN", limit: 100 }),
    ]);

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value.data);
    } else {
      setLoadError("Could not load dashboard summary. Please refresh.");
    }

    if (tasksResult.status === "fulfilled") {
      setTasks(tasksResult.value.data.tasks);
      setTasksAvailable(true);
    } else {
      setTasks([]);
      setTasksAvailable(false);
    }

    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleResolve = async (taskId: string) => {
    setResolvingId(taskId);
    try {
      await callResolveStaffTask({
        organizationId,
        taskId,
        clearBorrowerNeedsHelp: true,
      });
      // optimistic remove
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      // refresh summary in background
      callGetDashboardSummary({ organizationId })
        .then((r) => setSummary(r.data))
        .catch(() => {});
    } finally {
      setResolvingId(null);
    }
  };

  if (loading && !summary) {
    return (
      <div className="grid gap-3 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-card-bg border border-border-subtle rounded-xl p-4 animate-pulse"
          >
            <div className="h-3 bg-surface rounded w-24 mb-3" />
            <div className="h-7 bg-surface rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    if (loadError) {
      return (
        <div className="bg-card-bg border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          {loadError}
        </div>
      );
    }
    return null;
  }

  const cards = [
    {
      key: "completion",
      title: "Onboarding Complete",
      value: `${summary.onboardingCompletionRate}%`,
      sub: `${summary.onboardingComplete} of ${summary.totalPolicies} policies`,
      icon: CheckCircle2,
      accent: "#22C55E",
      bgAccent: "rgba(34, 197, 94, 0.08)",
      borderAccent: "rgba(34, 197, 94, 0.2)",
    },
    {
      key: "pending",
      title: "Awaiting Insurance",
      value: String(summary.pendingIntake),
      sub: "Auto-reminders running",
      icon: Clock,
      accent: "#3B82F6",
      bgAccent: "rgba(59, 130, 246, 0.08)",
      borderAccent: "rgba(59, 130, 246, 0.2)",
    },
    {
      key: "help",
      title: "Needs Staff Help",
      value: String(summary.needsHelp),
      sub: !tasksAvailable
        ? "Restricted to admins"
        : tasks.length > 0
        ? "Click to review queue"
        : "All clear",
      icon: HandHelping,
      accent: summary.needsHelp > 0 ? "#F97316" : "#6b7a99",
      bgAccent:
        summary.needsHelp > 0
          ? "rgba(249, 115, 22, 0.08)"
          : "rgba(107, 122, 153, 0.08)",
      borderAccent:
        summary.needsHelp > 0
          ? "rgba(249, 115, 22, 0.25)"
          : "rgba(107, 122, 153, 0.2)",
      onClick: tasksAvailable && tasks.length > 0 ? () => setShowQueue((v) => !v) : undefined,
    },
    {
      key: "saved",
      title: "Staff Hours Saved",
      value: formatHours(summary.estimatedHoursSaved),
      sub: "vs. legacy phone follow-up",
      icon: Timer,
      accent: "#A855F7",
      bgAccent: "rgba(168, 85, 247, 0.08)",
      borderAccent: "rgba(168, 85, 247, 0.2)",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.key}
            onClick={c.onClick}
            role={c.onClick ? "button" : undefined}
            tabIndex={c.onClick ? 0 : undefined}
            className={`bg-card-bg border rounded-xl p-4 transition-all duration-200 ${
              c.onClick ? "cursor-pointer hover:translate-y-[-1px] hover:shadow-lg hover:shadow-black/20" : ""
            }`}
            style={{ borderColor: c.borderAccent }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: c.accent }}
              >
                {c.title}
              </span>
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: c.bgAccent }}
              >
                <c.icon className="w-3.5 h-3.5" style={{ color: c.accent }} />
              </div>
            </div>
            <p className="text-2xl font-bold text-offwhite">{c.value}</p>
            <p className="text-[11px] text-carbon-light mt-0.5 flex items-center gap-1">
              {c.sub}
              {c.onClick && <ChevronRight className="w-3 h-3" />}
            </p>
          </div>
        ))}
      </div>

      {showQueue && tasks.length > 0 && (
        <div className="bg-card-bg border border-orange-500/25 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HandHelping className="w-3.5 h-3.5 text-orange-400" />
              <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider">
                Needs Help Queue
              </h3>
              <span className="text-[11px] text-carbon-light">
                ({tasks.length} open)
              </span>
            </div>
            <button
              onClick={() => setShowQueue(false)}
              className="text-carbon-light hover:text-offwhite"
              aria-label="Close queue"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border-subtle max-h-[420px] overflow-y-auto">
            {tasks.map((t) => (
              <div key={t.id} className="px-4 py-3 hover:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider ${
                          t.priority === "HIGH"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-yellow-500/10 text-yellow-400"
                        }`}
                      >
                        {t.priority}
                      </span>
                      <span className="text-[10px] text-carbon-light">
                        {t.type === "BORROWER_HELP_REQUEST"
                          ? "Replied HELP"
                          : t.type === "INTAKE_NO_RESPONSE"
                            ? "No Response"
                            : t.type}
                      </span>
                      <span className="text-[10px] text-carbon-light">
                        · {timeAgo(t.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-offwhite mb-0.5">
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="text-[11px] text-carbon-light leading-relaxed line-clamp-2">
                        {t.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      {t.borrowerPhone && (
                        <a
                          href={`tel:${t.borrowerPhone}`}
                          className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                        >
                          <Phone className="w-3 h-3" />
                          {t.borrowerPhone}
                        </a>
                      )}
                      {t.borrowerEmail && (
                        <a
                          href={`mailto:${t.borrowerEmail}`}
                          className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                        >
                          <Mail className="w-3 h-3" />
                          {t.borrowerEmail}
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleResolve(t.id)}
                    disabled={resolvingId === t.id}
                    className="flex-shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md bg-accent/10 border border-accent/20 text-accent hover:bg-accent/15 disabled:opacity-50 flex items-center gap-1"
                  >
                    {resolvingId === t.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    Mark Resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
