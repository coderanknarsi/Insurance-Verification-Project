"use client";

import { Badge } from "@/components/ui/badge";

type Status = "GREEN" | "YELLOW" | "RED";

const statusConfig: Record<Status, { label: string; className: string }> = {
  GREEN: {
    label: "Compliant",
    className: "border-green-600 bg-green-50 text-green-700",
  },
  YELLOW: {
    label: "At Risk",
    className: "border-yellow-500 bg-yellow-50 text-yellow-700",
  },
  RED: {
    label: "Non-Compliant",
    className: "border-red-600 bg-red-50 text-red-700",
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
  GREEN: "bg-green-500",
  YELLOW: "bg-yellow-400",
  RED: "bg-red-500",
};

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${dotColors[status]}`}
      title={statusConfig[status].label}
    />
  );
}
