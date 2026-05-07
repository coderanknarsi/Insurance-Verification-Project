"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  MessageSquare,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Send,
  Loader2,
} from "lucide-react";
import { callGetVerifications, type VerificationRecord } from "@/lib/api";

interface BorrowerCommunicationTimelineProps {
  organizationId: string;
  borrowerId: string;
  /** Bump this number from a parent to force a refetch (e.g., after sending a message) */
  refreshKey?: number;
}

/** Human-readable labels for every NotificationTrigger we send. */
const TRIGGER_LABELS: Record<string, string> = {
  EXPIRING_SOON: "Expiry reminder",
  LAPSE_DETECTED: "Lapse — first notice",
  LAPSED_SECOND_NOTICE: "Lapse — second notice",
  LAPSED_FINAL_NOTICE: "Final notice (CPI/repo warning)",
  LAPSE_CURED: "Coverage restored",
  COVERAGE_FIRST_NOTICE: "Coverage update needed",
  COVERAGE_SECOND_NOTICE: "Coverage — second notice",
  COVERAGE_FINAL_NOTICE: "Final notice (CPI/repo warning)",
  COVERAGE_CURED: "Coverage compliant",
  REINSTATEMENT_REMINDER: "Reinstatement reminder",
  VERIFICATION_PROOF_REQUEST: "Proof requested",
  INTAKE_REQUESTED: "Intake link sent",
  INTAKE_COMPLETED: "Borrower submitted info",
  DEALER_SUBMITTED: "Dealer uploaded info",
};

/** Per-trigger semantic styling. */
function triggerStyle(trigger: string): {
  tone: "warning" | "danger" | "success" | "info";
} {
  switch (trigger) {
    case "LAPSED_FINAL_NOTICE":
    case "COVERAGE_FINAL_NOTICE":
      return { tone: "danger" };
    case "LAPSE_DETECTED":
    case "LAPSED_SECOND_NOTICE":
    case "COVERAGE_FIRST_NOTICE":
    case "COVERAGE_SECOND_NOTICE":
    case "EXPIRING_SOON":
    case "VERIFICATION_PROOF_REQUEST":
      return { tone: "warning" };
    case "LAPSE_CURED":
    case "COVERAGE_CURED":
    case "INTAKE_COMPLETED":
    case "DEALER_SUBMITTED":
      return { tone: "success" };
    default:
      return { tone: "info" };
  }
}

const TONE_CLASSES = {
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/20",
  },
  danger: {
    dot: "bg-red-500",
    text: "text-red-400",
    iconBg: "bg-red-500/10 border-red-500/20",
  },
  success: {
    dot: "bg-green-500",
    text: "text-green-400",
    iconBg: "bg-green-500/10 border-green-500/20",
  },
  info: {
    dot: "bg-accent",
    text: "text-accent",
    iconBg: "bg-accent/10 border-accent/20",
  },
} as const;

function channelIcon(channel: string, trigger: string) {
  if (channel === "SMS") return MessageSquare;
  if (channel === "EMAIL") return Mail;
  // PORTAL or unknown — fall back to trigger semantics
  if (trigger === "LAPSE_CURED" || trigger === "COVERAGE_CURED") return CheckCircle2;
  if (trigger.includes("FINAL")) return AlertOctagon;
  if (trigger.includes("LAPSE") || trigger.includes("COVERAGE")) return AlertTriangle;
  return Send;
}

function formatRelative(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const now = Date.now();
  const diffMs = now - ms;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  let relative: string;
  if (diffMin < 1) relative = "just now";
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffHr < 24) relative = `${diffHr}h ago`;
  else if (diffDay < 7) relative = `${diffDay}d ago`;
  else
    relative = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
    });

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${relative} · ${time}`;
}

export function BorrowerCommunicationTimeline({
  organizationId,
  borrowerId,
  refreshKey = 0,
}: BorrowerCommunicationTimelineProps) {
  const [items, setItems] = useState<VerificationRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    callGetVerifications({ organizationId, borrowerId, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data.verifications);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, borrowerId, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-carbon-light" />
        <span className="text-xs text-carbon-light">Loading history…</span>
      </div>
    );
  }

  if (error) {
    const friendly =
      error === "INTERNAL" || error.toLowerCase().includes("internal")
        ? "History is still indexing — please refresh in a minute."
        : error;
    return (
      <div className="text-xs text-red-400 py-2">{friendly}</div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 justify-center">
        <Clock className="w-3.5 h-3.5 text-carbon-light" />
        <span className="text-xs text-carbon-light">No messages sent yet</span>
      </div>
    );
  }

  return (
    <ol className="relative space-y-3 pl-4 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-border-subtle">
      {items.map((item) => {
        const { tone } = triggerStyle(item.trigger);
        const toneCls = TONE_CLASSES[tone];
        const Icon = channelIcon(item.channel, item.trigger);
        const label = TRIGGER_LABELS[item.trigger] ?? item.trigger;
        const failed = item.status === "FAILED";

        return (
          <li key={item.id} className="relative">
            {/* Dot on the timeline rail */}
            <span
              className={`absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-card-bg ${toneCls.dot}`}
              aria-hidden
            />
            <div className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 w-7 h-7 rounded-md border flex items-center justify-center flex-shrink-0 ${toneCls.iconBg}`}
              >
                <Icon className={`w-3.5 h-3.5 ${toneCls.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-xs font-medium truncate ${toneCls.text}`}>
                    {label}
                  </p>
                  <span className="text-[10px] text-carbon-light flex-shrink-0">
                    {formatRelative(item.createdAt)}
                  </span>
                </div>
                <p className="text-[11px] text-carbon-light mt-0.5">
                  <span className="uppercase tracking-wider">{item.channel}</span>
                  {" · "}
                  <span
                    className={
                      failed
                        ? "text-red-400"
                        : item.status === "SENT" || item.status === "DELIVERED"
                          ? "text-green-400/80"
                          : ""
                    }
                  >
                    {item.status.toLowerCase()}
                  </span>
                </p>
                {failed && (
                  <p className="text-[10px] text-red-400/80 mt-0.5 italic">
                    Delivery failed
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
