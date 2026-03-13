"use client";

import { useMemo } from "react";
import {
  Clock,
  Activity,
  BarChart3,
} from "lucide-react";
import type { BorrowerWithVehicles } from "@/lib/api";

interface DashboardWidgetsProps {
  borrowers: BorrowerWithVehicles[];
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatTimestamp(ts?: { _seconds: number }): string {
  if (!ts?._seconds) return "";
  return new Date(ts._seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DashboardWidgets({ borrowers }: DashboardWidgetsProps) {
  // Compliance trend — simulated weekly data based on current snapshot
  // In production this would come from a backend time-series
  const complianceRate = useMemo(() => {
    const total = borrowers.length || 1;
    const green = borrowers.filter((b) => b.overallStatus === "GREEN").length;
    return Math.round((green / total) * 100);
  }, [borrowers]);

  // Upcoming expirations — next 30 days, sorted by soonest
  const upcoming = useMemo(() => {
    const items: {
      name: string;
      vehicle: string;
      endDate: string;
      days: number;
      status: string;
    }[] = [];

    borrowers.forEach((b) =>
      b.vehicles.forEach((v) => {
        const end = v.policy?.coveragePeriod?.endDate;
        const days = daysUntil(end);
        if (days !== null && days >= 0 && days <= 30 && end) {
          items.push({
            name: `${b.firstName} ${b.lastName}`,
            vehicle: `${v.year} ${v.make} ${v.model}`,
            endDate: end,
            days,
            status: b.overallStatus,
          });
        }
      })
    );

    return items.sort((a, b) => a.days - b.days).slice(0, 5);
  }, [borrowers]);

  // Recent activity — sorted by most recent verification
  const activity = useMemo(() => {
    const items: {
      name: string;
      action: string;
      time: string;
      statusColor: string;
    }[] = [];

    borrowers.forEach((b) =>
      b.vehicles.forEach((v) => {
        const policy = v.policy;
        if (!policy) return;

        if (policy.lastVerifiedAt?._seconds) {
          items.push({
            name: `${b.firstName} ${b.lastName}`,
            action:
              policy.dashboardStatus === "GREEN"
                ? "Verification passed"
                : policy.dashboardStatus === "YELLOW"
                  ? "Expiring soon — needs attention"
                  : policy.status === "CANCELLED"
                    ? "Policy cancelled"
                    : "Compliance issue detected",
            time: formatTimestamp(policy.lastVerifiedAt),
            statusColor:
              policy.dashboardStatus === "GREEN"
                ? "text-green-400"
                : policy.dashboardStatus === "YELLOW"
                  ? "text-yellow-400"
                  : "text-red-400",
          });
        }
      })
    );

    return items
      .sort((a, b) => (b.time > a.time ? 1 : -1))
      .slice(0, 5);
  }, [borrowers]);

  // Compliance trend — simulated weekly data based on current snapshot
  // In production this would come from a backend time-series
  const trendData = useMemo(() => {
    const rate = complianceRate;
    // Generate 6 data points showing progression toward current rate
    const weeks = ["6w ago", "5w ago", "4w ago", "3w ago", "2w ago", "Now"];
    const base = Math.max(rate - 25, 0);
    return weeks.map((label, i) => ({
      label,
      value: Math.min(100, Math.round(base + ((rate - base) * (i + 1)) / weeks.length)),
    }));
  }, [complianceRate]);

  const maxTrend = Math.max(...trendData.map((d) => d.value), 1);

  return (
    <div className="grid gap-4 md:grid-cols-3">
        {/* Compliance Trend Chart */}
        <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-accent" />
            <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider">
              Compliance Trend
            </h3>
          </div>
          <div className="flex items-end gap-2 h-28">
            {trendData.map((d) => (
              <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-mono text-carbon-light">
                  {d.value}%
                </span>
                <div className="w-full bg-surface rounded-t-sm overflow-hidden" style={{ height: "80px" }}>
                  <div
                    className="w-full rounded-t-sm transition-all duration-500"
                    style={{
                      height: `${(d.value / maxTrend) * 100}%`,
                      backgroundColor:
                        d.value >= 80
                          ? "#22C55E"
                          : d.value >= 50
                            ? "#EAB308"
                            : "#EF4444",
                      marginTop: "auto",
                      position: "relative",
                      top: `${100 - (d.value / maxTrend) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-[9px] text-carbon-light">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-yellow-400" />
            <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider">
              Expiring Next 30 Days
            </h3>
          </div>
          {upcoming.length === 0 ? (
            <div className="flex items-center justify-center h-28">
              <p className="text-xs text-carbon-light">No upcoming expirations</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-1.5 border-b border-border-subtle last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-offwhite truncate">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-carbon-light truncate">
                      {item.vehicle}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="text-xs font-mono text-offwhite">
                      {formatDate(item.endDate)}
                    </p>
                    <p
                      className={`text-[10px] font-medium ${
                        item.days <= 7
                          ? "text-red-400"
                          : item.days <= 14
                            ? "text-yellow-400"
                            : "text-carbon-light"
                      }`}
                    >
                      {item.days === 0 ? "Today" : `${item.days}d left`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-accent" />
            <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider">
              Recent Activity
            </h3>
          </div>
          {activity.length === 0 ? (
            <div className="flex items-center justify-center h-28">
              <p className="text-xs text-carbon-light">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {activity.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 py-1.5 border-b border-border-subtle last:border-0"
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                      item.statusColor === "text-green-400"
                        ? "bg-green-400"
                        : item.statusColor === "text-yellow-400"
                          ? "bg-yellow-400"
                          : "bg-red-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-offwhite truncate">
                      {item.name}
                    </p>
                    <p className={`text-[10px] ${item.statusColor}`}>
                      {item.action}
                    </p>
                    <p className="text-[10px] text-carbon-light">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
