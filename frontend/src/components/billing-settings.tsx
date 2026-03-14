"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CreditCard,
  Zap,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  callGetSubscriptionStatus,
  callCreateSubscription,
  callChangePlan,
  callCancelSubscription,
  callResumeSubscription,
  callCreateBillingPortalSession,
} from "@/lib/api";
import type { SubscriptionStatus } from "@/lib/api";

interface BillingSettingsProps {
  organizationId: string;
}

const PLANS = [
  {
    id: "STARTER",
    name: "Starter",
    price: 149,
    vehicles: 50,
    features: ["Up to 50 vehicles", "Email verifications", "Compliance dashboard"],
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: 349,
    vehicles: 150,
    popular: true,
    features: [
      "Up to 150 vehicles",
      "Email & SMS verifications",
      "Compliance dashboard",
      "Priority support",
    ],
  },
  {
    id: "SCALE",
    name: "Scale",
    price: 599,
    vehicles: 300,
    features: [
      "Up to 300 vehicles",
      "Email & SMS verifications",
      "Compliance dashboard",
      "Priority support",
      "API access",
    ],
  },
];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: "bg-green-500/15", text: "text-green-400", label: "Active" },
    trialing: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Trial" },
    past_due: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Past Due" },
    canceled: { bg: "bg-red-500/15", text: "text-red-400", label: "Canceled" },
    incomplete: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Incomplete" },
    unpaid: { bg: "bg-red-500/15", text: "text-red-400", label: "Unpaid" },
  };
  const c = config[status] ?? { bg: "bg-carbon/15", text: "text-carbon-light", label: status };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

export function BillingSettings({ organizationId }: BillingSettingsProps) {
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await callGetSubscriptionStatus({ organizationId });
      setSub(result.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load billing info";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSubscribe = async (planId: string) => {
    setActionLoading(planId);
    setError(null);
    try {
      await callCreateSubscription({ organizationId, plan: planId });
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create subscription";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (newPlan: string) => {
    setActionLoading(newPlan);
    setError(null);
    try {
      await callChangePlan({ organizationId, newPlan });
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change plan";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    setActionLoading("cancel");
    setError(null);
    try {
      await callCancelSubscription({ organizationId });
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to cancel subscription";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    setActionLoading("resume");
    setError(null);
    try {
      await callResumeSubscription({ organizationId });
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resume subscription";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleManageBilling = async () => {
    setActionLoading("portal");
    setError(null);
    try {
      const result = await callCreateBillingPortalSession({
        organizationId,
        returnUrl: window.location.href,
      });
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open billing portal";
      setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-carbon-light">Loading billing...</span>
        </div>
      </div>
    );
  }

  const hasActiveSub =
    sub?.hasSubscription &&
    (sub.status === "active" || sub.status === "trialing");

  return (
    <div className="max-w-4xl space-y-6">
      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Current Subscription Card */}
      <div className="bg-card-bg border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-accent" />
          <h3 className="text-base font-semibold text-offwhite">Subscription</h3>
        </div>
        <div className="p-6">
          {sub?.hasSubscription ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h4 className="text-lg font-semibold text-offwhite">
                      {sub.planName ?? sub.plan} Plan
                    </h4>
                    <StatusBadge status={sub.status!} />
                  </div>
                  <p className="text-sm text-carbon-light mt-1">
                    ${sub.priceMonthly}/month &middot; {sub.activeVehicles}/{sub.maxVehicles} vehicles
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManageBilling}
                  disabled={actionLoading === "portal"}
                  className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
                >
                  {actionLoading === "portal" ? "Opening..." : "Manage Billing"}
                  <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>

              {/* Trial Banner */}
              {sub.status === "trialing" && sub.trialDaysRemaining !== null && (
                <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                  <Zap className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-blue-300 font-medium">
                      Free trial &middot; {sub.trialDaysRemaining} day{sub.trialDaysRemaining !== 1 ? "s" : ""} remaining
                    </p>
                    <p className="text-xs text-blue-400/70 mt-0.5">
                      Add a payment method to continue after your trial ends
                    </p>
                  </div>
                </div>
              )}

              {/* Past Due Warning */}
              {sub.status === "past_due" && (
                <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-yellow-300 font-medium">Payment past due</p>
                    <p className="text-xs text-yellow-400/70 mt-0.5">
                      Please update your payment method to avoid service interruption
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleManageBilling}
                    className="bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border-0"
                  >
                    Update Payment
                  </Button>
                </div>
              )}

              {/* Cancellation pending */}
              {sub.cancelAtPeriodEnd && (
                <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3">
                  <XCircle className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-orange-300 font-medium">Cancellation scheduled</p>
                    <p className="text-xs text-orange-400/70 mt-0.5">
                      Access continues until{" "}
                      {sub.currentPeriodEnd
                        ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString()
                        : "the end of your billing period"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleResume}
                    disabled={actionLoading === "resume"}
                    className="bg-accent hover:bg-accent-hover text-white border-0"
                  >
                    {actionLoading === "resume" ? "Resuming..." : "Resume"}
                  </Button>
                </div>
              )}

              {/* Usage meter */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-carbon-light">Vehicle Usage</span>
                  <span className="text-xs text-carbon-light">
                    {sub.activeVehicles} / {sub.maxVehicles}
                  </span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      sub.activeVehicles / sub.maxVehicles > 0.9
                        ? "bg-red-400"
                        : sub.activeVehicles / sub.maxVehicles > 0.7
                          ? "bg-yellow-400"
                          : "bg-accent"
                    }`}
                    style={{
                      width: `${Math.min(100, (sub.activeVehicles / sub.maxVehicles) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Cancel / Resume actions */}
              {hasActiveSub && !sub.cancelAtPeriodEnd && (
                <div className="pt-2 border-t border-border-subtle">
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading === "cancel"}
                    className="text-xs text-carbon-light hover:text-red-400 transition-colors"
                  >
                    {actionLoading === "cancel" ? "Canceling..." : "Cancel subscription"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-carbon-light">No active subscription</p>
              <p className="text-xs text-carbon mt-1">Choose a plan below to get started</p>
            </div>
          )}
        </div>
      </div>

      {/* Plan Cards */}
      <div className="bg-card-bg border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
          <Zap className="w-5 h-5 text-accent" />
          <h3 className="text-base font-semibold text-offwhite">
            {hasActiveSub ? "Change Plan" : "Choose a Plan"}
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map((plan) => {
              const isCurrent = sub?.plan === plan.id;
              const isDowngrade =
                hasActiveSub &&
                sub?.priceMonthly != null &&
                plan.price < sub.priceMonthly;

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-xl border p-5 transition-all ${
                    isCurrent
                      ? "border-accent bg-accent/5"
                      : "border-border-subtle hover:border-accent/40"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full">
                      Popular
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute top-3 right-3">
                      <CheckCircle className="w-4 h-4 text-accent" />
                    </span>
                  )}
                  <h4 className="text-sm font-semibold text-offwhite">{plan.name}</h4>
                  <div className="mt-2">
                    <span className="text-2xl font-bold text-offwhite">${plan.price}</span>
                    <span className="text-xs text-carbon-light">/mo</span>
                  </div>
                  <p className="text-xs text-carbon-light mt-1">
                    Up to {plan.vehicles} vehicles
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-carbon-light">
                        <ChevronRight className="w-3 h-3 text-accent flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    {isCurrent ? (
                      <Button
                        disabled
                        size="sm"
                        className="w-full bg-accent/10 text-accent border-0 cursor-default"
                      >
                        Current Plan
                      </Button>
                    ) : hasActiveSub ? (
                      <Button
                        size="sm"
                        onClick={() => handleChangePlan(plan.id)}
                        disabled={actionLoading === plan.id}
                        className={`w-full border-0 ${
                          isDowngrade
                            ? "bg-surface text-carbon-light hover:bg-white/[0.06]"
                            : "bg-accent hover:bg-accent-hover text-white"
                        }`}
                      >
                        {actionLoading === plan.id
                          ? "Switching..."
                          : isDowngrade
                            ? "Downgrade"
                            : "Upgrade"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={actionLoading === plan.id}
                        className="w-full bg-accent hover:bg-accent-hover text-white border-0"
                      >
                        {actionLoading === plan.id ? "Starting..." : "Start Free Trial"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Enterprise CTA */}
          <div className="mt-4 bg-surface rounded-xl border border-border-subtle p-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-offwhite">Enterprise</h4>
              <p className="text-xs text-carbon-light mt-0.5">
                300+ vehicles &middot; Custom pricing &middot; Dedicated support
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.open("https://autolientracker.com/#contact", "_blank", "noopener,noreferrer")
              }
              className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
            >
              Contact Sales
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
