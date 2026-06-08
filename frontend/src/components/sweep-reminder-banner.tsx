"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import {
  callGetSweepReminder,
  callAcknowledgeSweepReminder,
  type SweepReminder,
} from "@/lib/api";

interface SweepReminderBannerProps {
  organizationId: string;
}

export function SweepReminderBanner({ organizationId }: SweepReminderBannerProps) {
  const [reminder, setReminder] = useState<SweepReminder | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let active = true;
    callGetSweepReminder({ organizationId })
      .then((res) => {
        if (active) setReminder(res.data.reminder);
      })
      .catch(() => {
        // no banner on failure
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  if (!reminder) return null;

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await callAcknowledgeSweepReminder({ organizationId });
      setReminder(null);
    } catch {
      setDismissing(false);
    }
  };

  const parts: string[] = [];
  if (reminder.operatorReadyCount > 0) {
    parts.push(
      `${reminder.operatorReadyCount} ${
        reminder.operatorReadyCount === 1 ? "policy" : "policies"
      } being verified automatically`
    );
  }
  if (reminder.manualCount > 0) {
    parts.push(`${reminder.manualCount} awaiting manual confirmation below`);
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-accent/10 border border-accent/25 rounded-2xl px-5 py-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-accent" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-offwhite">
            Your portfolio is being verified today
          </p>
          <p className="text-xs text-carbon-light truncate">
            {parts.length > 0
              ? `AutoLien is running your weekly sweep — ${parts.join(" · ")}.`
              : "AutoLien runs your weekly verification sweep today — results will update automatically."}
          </p>
        </div>
      </div>
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        aria-label="Dismiss"
        className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-carbon-light hover:text-offwhite hover:bg-white/[0.06] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
