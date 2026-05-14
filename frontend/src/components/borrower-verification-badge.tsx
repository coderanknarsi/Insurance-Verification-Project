import { CheckCircle2, Clock, ShieldOff } from "lucide-react";
import type { VerificationState } from "@/lib/api";
import { COMPLETED_VERIFICATION_HELP, VERIFICATION_STATUS_HELP } from "@/components/status-help";

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
    Icon: Clock,
  },
  PENDING_UPLOAD: {
    Icon: Clock,
  },
  INSURED_UNSUPPORTED: {
    Icon: ShieldOff,
  },
  INSURED_NO_CREDS: {
    Icon: Clock,
  },
};

export function BorrowerVerificationBadge({
  state,
  lastVerifiedAt,
  className = "",
}: BorrowerVerificationBadgeProps) {
  if (!state) return null;
  const cfg = CONFIG[state];
  const isCompletedVerification = state === "INSURED_SUPPORTED" && !!lastVerifiedAt;
  const help = isCompletedVerification ? COMPLETED_VERIFICATION_HELP : VERIFICATION_STATUS_HELP[state];
  const title =
    isCompletedVerification
      ? `${help.label}: ${help.description} Last verified ${new Date(lastVerifiedAt).toLocaleDateString()}.`
      : `${help.label}: ${help.description}`;
  const Icon = isCompletedVerification ? CheckCircle2 : cfg.Icon;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${help.className} ${className}`}
    >
      <Icon className="h-3 w-3" />
      {help.label}
    </span>
  );
}
