import { CheckCircle2, Clock, ShieldOff, KeyRound } from "lucide-react";
import type { VerificationState } from "@/lib/api";
import { VERIFICATION_STATUS_HELP } from "@/components/status-help";

interface BorrowerVerificationBadgeProps {
  state: VerificationState | undefined;
  lastVerifiedAt?: number | null;
  className?: string;
}

const CONFIG: Record<
  VerificationState,
  { Icon: typeof CheckCircle2 }
> = {
  INSURED_SUPPORTED: {
    Icon: CheckCircle2,
  },
  PENDING_UPLOAD: {
    Icon: Clock,
  },
  INSURED_UNSUPPORTED: {
    Icon: ShieldOff,
  },
  INSURED_NO_CREDS: {
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
  const help = VERIFICATION_STATUS_HELP[state];
  const title =
    state === "INSURED_SUPPORTED" && lastVerifiedAt
      ? `${help.label}: ${help.description} Last verified ${new Date(lastVerifiedAt).toLocaleDateString()}.`
      : `${help.label}: ${help.description}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${help.className} ${className}`}
    >
      <cfg.Icon className="h-3 w-3" />
      {help.label}
    </span>
  );
}
