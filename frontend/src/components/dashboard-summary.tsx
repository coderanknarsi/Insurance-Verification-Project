"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, ShieldX, Bell } from "lucide-react";
import { callGetDashboardSummary } from "@/lib/api";

interface DashboardSummaryProps {
  organizationId: string;
}

interface Summary {
  green: number;
  yellow: number;
  red: number;
  actionRequired: number;
  totalBorrowers: number;
}

export function DashboardSummary({ organizationId }: DashboardSummaryProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    callGetDashboardSummary({ organizationId })
      .then((res) => {
        if (!cancelled) setSummary(res.data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load summary");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card-bg border border-border-subtle rounded-xl p-4 animate-pulse">
          <div className="h-4 bg-surface rounded w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card-bg border border-border-subtle rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-surface rounded w-20 mb-3" />
              <div className="h-8 bg-surface rounded w-12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card-bg border border-red-500/20 rounded-xl p-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const total = summary.green + summary.yellow + summary.red || 1;

  const cards = [
    {
      title: "Compliant",
      count: summary.green,
      subtitle: "Active & verified",
      icon: ShieldCheck,
      accent: "#22C55E",
      bgAccent: "rgba(34, 197, 94, 0.08)",
      borderAccent: "rgba(34, 197, 94, 0.2)",
      pct: Math.round((summary.green / total) * 100),
    },
    {
      title: "At Risk",
      count: summary.yellow,
      subtitle: "Expiring soon",
      icon: AlertTriangle,
      accent: "#EAB308",
      bgAccent: "rgba(234, 179, 8, 0.08)",
      borderAccent: "rgba(234, 179, 8, 0.2)",
      pct: Math.round((summary.yellow / total) * 100),
    },
    {
      title: "Non-Compliant",
      count: summary.red,
      subtitle: "Lapsed or unverified",
      icon: ShieldX,
      accent: "#EF4444",
      bgAccent: "rgba(239, 68, 68, 0.08)",
      borderAccent: "rgba(239, 68, 68, 0.2)",
      pct: Math.round((summary.red / total) * 100),
    },
  ];

  const actionPct = Math.round(
    ((summary.actionRequired) / (summary.totalBorrowers || 1)) * 100
  );

  return (
    <div className="space-y-4">
      {/* Action Required Banner */}
      <div
        className="relative overflow-hidden bg-card-bg border rounded-xl px-5 py-3.5 flex items-center justify-between"
        style={{ borderColor: "rgba(249, 115, 22, 0.25)" }}
      >
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{ background: "linear-gradient(90deg, #F97316 0%, transparent 60%)" }}
        />
        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(249, 115, 22, 0.1)" }}>
            <Bell className="w-4.5 h-4.5 text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-offwhite">
              <span className="text-orange-400">{summary.actionRequired}</span>{" "}
              borrower{summary.actionRequired !== 1 ? "s" : ""} need attention
            </p>
            <p className="text-[11px] text-carbon-light">
              {actionPct}% of {summary.totalBorrowers} monitored
            </p>
          </div>
        </div>
        {/* Mini progress */}
        <div className="relative flex items-center gap-3">
          <div className="w-32 h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${actionPct}%`, backgroundColor: "#F97316" }}
            />
          </div>
          <span className="text-xs font-mono text-orange-400">{actionPct}%</span>
        </div>
      </div>

      {/* Stoplight Cards — 3 columns */}
      <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className="bg-card-bg border rounded-xl p-5 transition-all duration-200 hover:translate-y-[-1px] hover:shadow-lg hover:shadow-black/20"
          style={{ borderColor: card.borderAccent }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: card.accent }}>
              {card.title}
            </span>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: card.bgAccent }}
            >
              <card.icon className="w-4 h-4" style={{ color: card.accent }} />
            </div>
          </div>
          <p className="text-3xl font-bold text-offwhite mb-1">{card.count}</p>
          <div className="flex items-center justify-between">
            <p className="text-xs text-carbon-light">{card.subtitle}</p>
            <span className="text-xs font-mono" style={{ color: card.accent }}>{card.pct}%</span>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-1 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${card.pct}%`, backgroundColor: card.accent }}
            />
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
