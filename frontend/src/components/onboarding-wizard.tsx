"use client";

import { useState } from "react";
import { Shield, Check, ChevronRight, Loader2, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  callUpdateComplianceRules,
  callUpdateOrganizationProfile,
  type ComplianceRules,
  type OrganizationType,
} from "@/lib/api";

interface OnboardingWizardProps {
  organizationId: string;
  initialName: string;
  initialType?: OrganizationType;
  initialRules: ComplianceRules;
  initialLienholderName: string;
  onComplete: () => void;
}

const TYPE_OPTIONS: { value: OrganizationType; label: string }[] = [
  { value: "BHPH_DEALER", label: "BHPH Dealership" },
  { value: "BANK", label: "Bank" },
  { value: "CREDIT_UNION", label: "Credit Union" },
  { value: "FINANCE_COMPANY", label: "Finance Company" },
];

const SHARED_FEATURES = [
  "Automated insurance verification",
  "Compliance dashboard",
  "Lapse detection & alerts",
  "Email & SMS notifications",
  "Borrower self-service links",
  "Team member access",
];

const PLANS = [
  { id: "STARTER", name: "Starter", price: 149, vehicles: 50, features: ["Up to 50 vehicles", ...SHARED_FEATURES] },
  { id: "GROWTH", name: "Growth", price: 349, vehicles: 150, popular: true, features: ["Up to 150 vehicles", ...SHARED_FEATURES] },
  { id: "SCALE", name: "Scale", price: 599, vehicles: 300, features: ["Up to 300 vehicles", ...SHARED_FEATURES] },
];

function StepHeader({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
              n < current
                ? "bg-accent text-white"
                : n === current
                ? "bg-accent/20 text-accent border border-accent"
                : "bg-surface text-carbon-light border border-border-subtle"
            }`}
          >
            {n < current ? <Check className="w-3.5 h-3.5" /> : n}
          </div>
          {n < total && (
            <div
              className={`w-8 h-px ${n < current ? "bg-accent" : "bg-border-subtle"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function OnboardingWizard({
  organizationId,
  initialName,
  initialType,
  initialRules,
  initialLienholderName,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivedInitialName = (() => {
    const trimmed = initialName.trim();
    if (!trimmed) return "";
    if (trimmed.endsWith("'s Organization")) return "";
    return trimmed;
  })();

  const [name, setName] = useState(derivedInitialName);
  const [orgType, setOrgType] = useState<OrganizationType>(initialType ?? "BHPH_DEALER");

  const [requireFullCoverage, setRequireFullCoverage] = useState(
    initialRules.requireComprehensive && initialRules.requireCollision
  );
  const [maxCompDeductible, setMaxCompDeductible] = useState<string>(
    initialRules.maxCompDeductible != null ? String(initialRules.maxCompDeductible) : ""
  );
  const [maxCollisionDeductible, setMaxCollisionDeductible] = useState<string>(
    initialRules.maxCollisionDeductible != null ? String(initialRules.maxCollisionDeductible) : ""
  );

  const [lienholderName, setLienholderName] = useState(initialLienholderName);
  const [requireLienholder, setRequireLienholder] = useState(initialRules.requireLienholder);
  const [autoSendReminder, setAutoSendReminder] = useState(initialRules.autoSendReminder);
  const [reminderDays, setReminderDays] = useState<string>(
    String(initialRules.reminderDaysBeforeExpiry ?? 10)
  );

  const saveProfile = async (opts: { completed: boolean }) => {
    await callUpdateOrganizationProfile({
      organizationId,
      name: name.trim(),
      type: orgType,
      lienholderName: lienholderName.trim(),
      onboardingCompleted: opts.completed,
    });
  };

  const saveRules = async () => {
    const parsedComp = maxCompDeductible.trim() === "" ? undefined : Number(maxCompDeductible);
    const parsedCollision =
      maxCollisionDeductible.trim() === "" ? undefined : Number(maxCollisionDeductible);

    const rules: ComplianceRules = {
      ...initialRules,
      requireComprehensive: requireFullCoverage,
      requireCollision: requireFullCoverage,
      requireLienholder,
      maxCompDeductible: Number.isFinite(parsedComp as number) ? (parsedComp as number) : undefined,
      maxCollisionDeductible: Number.isFinite(parsedCollision as number)
        ? (parsedCollision as number)
        : undefined,
      autoSendReminder,
      reminderDaysBeforeExpiry: Number(reminderDays) || 10,
    };

    await callUpdateComplianceRules({ organizationId, rules });
  };

  const handleNext = async () => {
    setError(null);
    if (step === 1) {
      if (!name.trim()) {
        setError("Company name is required.");
        return;
      }
      setSaving(true);
      try {
        await saveProfile({ completed: false });
        setStep(2);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save company info.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (step === 2) {
      setSaving(true);
      try {
        await saveRules();
        setStep(3);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save coverage settings.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (step === 3) {
      setSaving(true);
      try {
        await Promise.all([saveRules(), saveProfile({ completed: false })]);
        setStep(4);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save lienholder settings.");
      } finally {
        setSaving(false);
      }
      return;
    }
  };

  const handleFinish = async () => {
    setError(null);
    setSaving(true);
    try {
      await saveProfile({ completed: true });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding.");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setError(null);
    setSaving(true);
    try {
      await saveProfile({ completed: true });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip onboarding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <span className="text-xl font-semibold text-offwhite tracking-tight">
            Auto Lien Tracker
          </span>
        </div>

        <div className="bg-card-bg border border-border-subtle rounded-2xl p-8">
          <StepHeader current={step} total={4} />

          {step === 1 && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-offwhite mb-1">
                  Tell us about your company
                </h2>
                <p className="text-sm text-carbon-light">
                  We&apos;ll personalize your dashboard.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgName" className="text-sm text-carbon-light">
                  Company / dealership / lender name
                </Label>
                <Input
                  id="orgName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Auto Finance"
                  className="bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-carbon-light">Business type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setOrgType(opt.value)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                        orgType === opt.value
                          ? "bg-accent/15 text-accent border-accent"
                          : "bg-surface text-carbon-light border-border-subtle hover:text-offwhite"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-offwhite mb-1">
                  Coverage requirements
                </h2>
                <p className="text-sm text-carbon-light">
                  Set the minimum insurance you require from borrowers.
                </p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface border border-border-subtle">
                <div className="mr-4">
                  <p className="text-sm text-offwhite font-medium">Require full coverage</p>
                  <p className="text-xs text-carbon-light mt-0.5">
                    Requires both comprehensive and collision.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireFullCoverage(!requireFullCoverage)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    requireFullCoverage ? "bg-accent" : "bg-border-subtle"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      requireFullCoverage ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxComp" className="text-sm text-carbon-light">
                  Max comprehensive deductible (optional)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-carbon-light text-sm">
                    $
                  </span>
                  <Input
                    id="maxComp"
                    type="number"
                    min="0"
                    value={maxCompDeductible}
                    onChange={(e) => setMaxCompDeductible(e.target.value)}
                    placeholder="1000"
                    className="pl-7 bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxCollision" className="text-sm text-carbon-light">
                  Max collision deductible (optional)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-carbon-light text-sm">
                    $
                  </span>
                  <Input
                    id="maxCollision"
                    type="number"
                    min="0"
                    value={maxCollisionDeductible}
                    onChange={(e) => setMaxCollisionDeductible(e.target.value)}
                    placeholder="1000"
                    className="pl-7 bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-offwhite mb-1">
                  Lienholder &amp; notifications
                </h2>
                <p className="text-sm text-carbon-light">
                  We&apos;ll verify borrowers list you as the lienholder.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lienholder" className="text-sm text-carbon-light">
                  Lienholder name (as shown on policies)
                </Label>
                <Input
                  id="lienholder"
                  type="text"
                  value={lienholderName}
                  onChange={(e) => setLienholderName(e.target.value)}
                  placeholder={name || "Acme Auto Finance"}
                  className="bg-surface border-border-subtle text-offwhite placeholder:text-carbon focus:border-accent focus:ring-accent/30"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-surface border border-border-subtle">
                <div className="mr-4">
                  <p className="text-sm text-offwhite font-medium">Require lienholder on policy</p>
                  <p className="text-xs text-carbon-light mt-0.5">
                    Flag policies that don&apos;t list your company.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireLienholder(!requireLienholder)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    requireLienholder ? "bg-accent" : "bg-border-subtle"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      requireLienholder ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 rounded-lg bg-surface border border-border-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <div className="mr-4">
                    <p className="text-sm text-offwhite font-medium">Auto-send expiry reminders</p>
                    <p className="text-xs text-carbon-light mt-0.5">
                      Automatically notify borrowers via <strong className="text-carbon-light">email and SMS</strong> when
                      their policy is about to expire, giving them time to renew before a lapse occurs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSendReminder(!autoSendReminder)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      autoSendReminder ? "bg-accent" : "bg-border-subtle"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        autoSendReminder ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {autoSendReminder && (
                  <div className="space-y-2 pt-1 border-t border-border-subtle">
                    <Label htmlFor="reminderDays" className="text-sm text-carbon-light">
                      Days before expiry to send reminder
                    </Label>
                    <Input
                      id="reminderDays"
                      type="number"
                      min="1"
                      max="60"
                      value={reminderDays}
                      onChange={(e) => setReminderDays(e.target.value)}
                      className="w-24 bg-surface border-border-subtle text-offwhite focus:border-accent focus:ring-accent/30"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-offwhite mb-1">
                  You&apos;re all set
                </h2>
                <p className="text-sm text-carbon-light">
                  Review your settings. You can change these anytime in Settings.
                </p>
              </div>

              {/* Settings summary */}
              <div className="rounded-lg bg-surface border border-border-subtle divide-y divide-border-subtle">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Company</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {name || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Business type</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {TYPE_OPTIONS.find((o) => o.value === orgType)?.label ?? orgType}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Full coverage</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {requireFullCoverage ? "Required" : "Not required"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Max comp deductible</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {maxCompDeductible ? `$${maxCompDeductible}` : "Any"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Max collision deductible</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {maxCollisionDeductible ? `$${maxCollisionDeductible}` : "Any"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Lienholder</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {lienholderName || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Require lienholder</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {requireLienholder ? "Required" : "Not required"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs text-carbon-light">Expiry reminders</span>
                  <span className="text-sm text-offwhite font-medium text-right">
                    {autoSendReminder ? `${reminderDays} days before (email + SMS)` : "Off"}
                  </span>
                </div>
              </div>

              {/* Plan comparison */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <h3 className="text-sm font-semibold text-offwhite">Your Plan</h3>
                </div>
                <div className="rounded-lg bg-accent/10 border border-accent/30 px-4 py-3 mb-4 flex items-start gap-3">
                  <Zap className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <p className="text-sm text-carbon-light">
                    You&apos;re starting with a <strong className="text-offwhite">14-day free trial</strong> on the Starter plan. No credit card required. Upgrade anytime from Billing.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {PLANS.map((plan) => {
                    const isCurrent = plan.id === "STARTER";
                    return (
                      <div
                        key={plan.id}
                        className={`rounded-lg border p-3 relative ${
                          isCurrent
                            ? "bg-accent/5 border-accent"
                            : "bg-surface border-border-subtle"
                        }`}
                      >
                        {plan.popular && (
                          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                            Popular
                          </span>
                        )}
                        <div className="mb-2">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-offwhite">{plan.name}</p>
                            {isCurrent && (
                              <Check className="w-3.5 h-3.5 text-accent" />
                            )}
                          </div>
                          <p className="text-lg font-bold text-offwhite mt-1">
                            ${plan.price}<span className="text-xs font-normal text-carbon-light">/mo</span>
                          </p>
                          <p className="text-[11px] text-carbon-light">Up to {plan.vehicles} vehicles</p>
                        </div>
                        <ul className="space-y-1">
                          {plan.features.slice(1).map((f) => (
                            <li key={f} className="flex items-start gap-1.5 text-[11px] text-carbon-light">
                              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-accent/60" />
                              {f}
                            </li>
                          ))}
                        </ul>
                        {isCurrent && (
                          <div className="mt-2 text-center">
                            <span className="text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                              Current Plan
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400 mt-4 text-center">{error}</p>}

          <div className="flex items-center justify-between mt-8 gap-3">
            {step > 1 && step < 4 ? (
              <button
                type="button"
                onClick={handleSkip}
                disabled={saving}
                className="text-xs text-carbon-light hover:text-offwhite transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            ) : (
              <span />
            )}

            {step < 4 ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="bg-accent hover:bg-accent-hover text-white font-medium rounded-lg"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleFinish}
                disabled={saving}
                className="bg-accent hover:bg-accent-hover text-white font-medium rounded-lg"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Finishing...
                  </>
                ) : (
                  <>Go to Dashboard</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
