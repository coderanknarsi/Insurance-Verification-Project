"use client";

import { AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldCheck, ShieldOff } from "lucide-react";

type HelpItem = {
  label: string;
  description: string;
  className: string;
};

export const DASHBOARD_STATUS_HELP: Record<string, HelpItem> = {
  GREEN: {
    label: "Compliant",
    description: "Coverage information meets your configured rules based on the latest available document or verification result.",
    className: "border-green-500/30 bg-green-500/10 text-green-400",
  },
  YELLOW: {
    label: "At Risk",
    description: "Coverage is present, but the policy has an upcoming expiration or another item that needs monitoring.",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  },
  RED: {
    label: "Non-Compliant",
    description: "Coverage is missing, expired, cancelled, or does not meet one or more compliance rules.",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
  },
};

export const VERIFICATION_STATUS_HELP: Record<string, HelpItem> = {
  INSURED_SUPPORTED: {
    label: "Verified",
    description: "The carrier is supported and portal credentials are available, so this policy is eligible for automated deep verification.",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  PENDING_UPLOAD: {
    label: "Awaiting upload",
    description: "The borrower has not uploaded proof of insurance yet. Intake reminders can request the missing information.",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  INSURED_UNSUPPORTED: {
    label: "Manual",
    description: "Insurance was submitted, but this carrier is not currently supported for automated portal verification.",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  },
  INSURED_NO_CREDS: {
    label: "Add credentials",
    description: "The carrier is supported, but active portal credentials are missing, so automated verification cannot run yet.",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  },
};

export const COMPLIANCE_ISSUE_HELP: Record<string, HelpItem> = {
  MISSING_LIENHOLDER: {
    label: "No Lienholder",
    description: "The required lienholder is not listed on the policy document.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  NO_COMPREHENSIVE: {
    label: "No Comp",
    description: "Comprehensive coverage is required but was not found.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  NO_COLLISION: {
    label: "No Collision",
    description: "Collision coverage is required but was not found.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  DEDUCTIBLE_TOO_HIGH: {
    label: "High Deductible",
    description: "One or more deductibles exceed your configured maximum.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  POLICY_CANCELLED: {
    label: "Cancelled",
    description: "The policy appears to be cancelled.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  POLICY_EXPIRED: {
    label: "Expired",
    description: "The policy coverage period has ended.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  PENDING_CANCELLATION: {
    label: "Pending Cancel",
    description: "The carrier indicates this policy is pending cancellation.",
    className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
  },
  VIN_MISMATCH: {
    label: "VIN Mismatch",
    description: "The VIN on the policy does not match the vehicle record.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  VEHICLE_REMOVED: {
    label: "Removed",
    description: "The vehicle appears to have been removed from the policy.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  COVERAGE_EXPIRED: {
    label: "Coverage Expired",
    description: "The uploaded proof shows an expiration date in the past.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  EXPIRING_SOON: {
    label: "Expiring Soon",
    description: "The policy is approaching its expiration warning window.",
    className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
  },
  UNVERIFIED: {
    label: "Pending Verification",
    description: "Proof was submitted and is provisionally accepted, but deep carrier verification has not completed yet.",
    className: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  },
  AWAITING_CREDENTIALS: {
    label: "Awaiting Info",
    description: "The borrower still needs to provide insurance details or documents.",
    className: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  },
};

export function getComplianceIssueHelp(issue: string): HelpItem {
  return COMPLIANCE_ISSUE_HELP[issue] ?? {
    label: issue,
    description: "This compliance item needs review.",
    className: "border-red-500/20 bg-red-500/10 text-red-400",
  };
}

function StatusKeyRow({ item, icon: Icon }: { item: HelpItem; icon: typeof CheckCircle2 }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md border ${item.className}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div>
        <p className="text-xs font-semibold text-offwhite">{item.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-carbon-light">{item.description}</p>
      </div>
    </div>
  );
}

export function StatusKey() {
  return (
    <div className="relative group/statuskey">
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2.5 text-xs font-medium text-carbon-light transition-colors hover:text-offwhite focus:outline-none focus:ring-2 focus:ring-accent/40"
        aria-label="Show status key"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Status Key
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border-subtle bg-card-bg p-4 text-left shadow-2xl shadow-black/40 opacity-0 transition-opacity group-hover/statuskey:opacity-100 group-focus-within/statuskey:opacity-100 sm:w-[360px]">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-carbon-light">Compliance</p>
            <div className="space-y-3">
              <StatusKeyRow item={DASHBOARD_STATUS_HELP.GREEN} icon={CheckCircle2} />
              <StatusKeyRow item={DASHBOARD_STATUS_HELP.YELLOW} icon={AlertTriangle} />
              <StatusKeyRow item={DASHBOARD_STATUS_HELP.RED} icon={ShieldOff} />
            </div>
          </div>
          <div className="border-t border-border-subtle pt-4">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-carbon-light">Verification</p>
            <div className="space-y-3">
              <StatusKeyRow item={VERIFICATION_STATUS_HELP.INSURED_SUPPORTED} icon={ShieldCheck} />
              <StatusKeyRow item={COMPLIANCE_ISSUE_HELP.UNVERIFIED} icon={Clock} />
              <StatusKeyRow item={VERIFICATION_STATUS_HELP.PENDING_UPLOAD} icon={Clock} />
              <StatusKeyRow item={VERIFICATION_STATUS_HELP.INSURED_UNSUPPORTED} icon={ShieldOff} />
            </div>
          </div>
          <div className="border-t border-border-subtle pt-4">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-wider text-carbon-light">Common Issues</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-carbon-light">
              <span>No Lienholder: required lender is missing</span>
              <span>High Deductible: deductible exceeds rules</span>
              <span>VIN Mismatch: policy VIN differs</span>
              <span>Awaiting Info: borrower follow-up needed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}