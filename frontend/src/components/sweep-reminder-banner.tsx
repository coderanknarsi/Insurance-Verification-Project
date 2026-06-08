"use client";

import { useEffect, useState } from "react";
import { Zap, X } from "lucide-react";
import {
  callGetSweepReminder,
  callAcknowledgeSweepReminder,
  type SweepReminder,
} from "@/lib/api";

interface SweepReminderBannerProps {
  organizationId: string;
  onSweepNow: () => void;
}

export function SweepReminderBanner({
  organizationId,
  onSweepNow,
}: SweepReminderBannerProps) {
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
      } ready to verify`
    );
  }
  if (reminder.manualCount > 0) {
    parts.push(`${reminder.manualCount} need manual verification`);
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-accent/10 border border-accent/25 rounded-2xl px-5 py-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-accent" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-offwhite">
            It&apos;s your weekly sweep day
          </p>
          <p className="text-xs text-carbon-light truncate">
            {parts.length > 0
              ? parts.join(" · ")
              : "Open the operator, log into your portals, and run a sweep."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onSweepNow}
          className="text-sm font-medium px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white transition-colors"
        >
          Sweep now
        </button>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label="Dismiss"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-carbon-light hover:text-offwhite hover:bg-white/[0.06] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
