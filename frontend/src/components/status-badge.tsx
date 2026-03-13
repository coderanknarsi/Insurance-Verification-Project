"use client";

import { Badge } from "@/components/ui/badge";

type Status = "GREEN" | "YELLOW" | "RED";

const statusConfig: Record<Status, { label: string; className: string }> = {
  GREEN: {
    label: "Compliant",
    className: "border-green-500/30 bg-green-500/10 text-green-400",
  },
  YELLOW: {
    label: "At Risk",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  },
  RED: {
    label: "Non-Compliant",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
  },
};

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
      title={statusConfig[status].label}
    />
  );
}
