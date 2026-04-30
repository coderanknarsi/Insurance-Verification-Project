import { CheckCircle2, Clock, ShieldOff, KeyRound } from "lucide-react";
import type { VerificationState } from "@/lib/api";

interface BorrowerVerificationBadgeProps {
  state: VerificationState | undefined;
  lastVerifiedAt?: number | null;
  className?: string;
}

const CONFIG: Record<
  VerificationState,
  { label: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  INSURED_SUPPORTED: {
    label: "Verified",
    tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  PENDING_UPLOAD: {
    label: "Awaiting upload",
    tone: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    Icon: Clock,
  },
  INSURED_UNSUPPORTED: {
    label: "Manual",
    tone: "text-slate-300 bg-slate-500/10 border-slate-500/30",
    Icon: ShieldOff,
  },
  INSURED_NO_CREDS: {
    label: "Add credentials",
    tone: "text-orange-400 bg-orange-500/10 border-orange-500/30",
    Icon: KeyRound,
  },
};

export function BorrowerVerificationBadge({
  state,
  lastVerifiedAt,
  className = "",
}: BorrowerVerificationBadgeProps) {
  if (!state) return null;
  const cfg = CONFIG[state];
  const title =
    state === "INSURED_SUPPORTED" && lastVerifiedAt
      ? `Last verified ${new Date(lastVerifiedAt).toLocaleDateString()}`
      : cfg.label;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.tone} ${className}`}
    >
      <cfg.Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
