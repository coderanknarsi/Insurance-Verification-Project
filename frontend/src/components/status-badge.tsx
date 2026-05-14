"use client";

import { Badge } from "@/components/ui/badge";
import { DASHBOARD_STATUS_HELP } from "@/components/status-help";

type Status = "GREEN" | "YELLOW" | "RED";

const statusConfig = DASHBOARD_STATUS_HELP as Record<Status, (typeof DASHBOARD_STATUS_HELP)[string]>;

interface StatusBadgeProps {
  status: Status;
  size?: "sm" | "default";
}

export function StatusBadge({ status, size = "default" }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={`${config.className} ${size === "sm" ? "text-xs px-1.5 py-0" : ""}`}
      title={`${config.label}: ${config.description}`}
    >
      {config.label}
    </Badge>
  );
}

interface StatusDotProps {
  status: Status;
}

const dotColors: Record<Status, string> = {
  GREEN: "bg-green-400 text-green-400",
  YELLOW: "bg-yellow-400 text-yellow-400",
  RED: "bg-red-400 text-red-400",
};

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full pulse-glow ${dotColors[status]}`}
      title={`${statusConfig[status].label}: ${statusConfig[status].description}`}
    />
  );
}
