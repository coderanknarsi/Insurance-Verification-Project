"use client";

import { useEffect, useState } from "react";
import { Settings, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  callGetComplianceRules,
  callGetOrganizationProfile,
  callUpdateComplianceRules,
  callUpdateOrganizationProfile,
} from "@/lib/api";
import type { ComplianceRules, OrganizationProfile, OrganizationType } from "@/lib/api";

interface ComplianceSettingsProps {
  organizationId: string;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  onLabel = "Required",
  offLabel = "Not Required",
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="mr-4">
        <p className="text-sm text-offwhite font-medium">{label}</p>
        <p className="text-xs text-carbon-light mt-0.5">{description}</p>
      </div>
      <div className="flex-shrink-0 flex rounded-lg bg-surface border border-border-subtle overflow-hidden">
        <button
          onClick={() => onChange(false)}
          className={`px-3 py-1.5 text-xs font-medium transition-all ${
            !checked
              ? "bg-red-500/15 text-red-400 border-r border-red-500/20"
              : "text-carbon-light hover:text-offwhite border-r border-border-subtle"
          }`}
        >
          {offLabel}
        </button>
        <button
          onClick={() => onChange(true)}
          className={`px-3 py-1.5 text-xs font-medium transition-all ${
            checked
              ? "bg-green-500/15 text-green-400"
              : "text-carbon-light hover:text-offwhite"
          }`}
        >
          {onLabel}
        </button>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  description,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  description: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="py-3">
      <p className="text-sm text-offwhite font-medium">{label}</p>
      <p className="text-xs text-carbon-light mt-0.5 mb-2">{description}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
          placeholder={placeholder}
          className="w-28 bg-surface border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-offwhite placeholder:text-carbon focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        {suffix && <span className="text-xs text-carbon-light">{suffix}</span>}
      </div>
    </div>
  );
}

export function ComplianceSettings({ organizationId }: ComplianceSettingsProps) {
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [original, setOriginal] = useState<ComplianceRules | null>(null);
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<OrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    Promise.all([
      callGetOrganizationProfile({ organizationId }),
      callGetComplianceRules({ organizationId }),
    ])
      .then(([profileRes, rulesRes]) => {
        setProfile(profileRes.data);
        setOriginalProfile(profileRes.data);
        setRules(rulesRes.data);
        setOriginal(rulesRes.data);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load settings")
      )
      .finally(() => setLoading(false));
  }, [organizationId]);

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    setError(null);
    setProfileSuccess(false);
    try {
      const res = await callUpdateOrganizationProfile({
        organizationId,
        name: profile.name,
        type: profile.type,
      });
      setProfile({ name: res.data.name, type: res.data.type });
      setOriginalProfile({ name: res.data.name, type: res.data.type });
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save organization profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSave = async () => {
    if (!rules) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await callUpdateComplianceRules({ organizationId, rules });
      setOriginal(rules);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rules");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (original) setRules({ ...original });
  };

  const handleProfileReset = () => {
    if (originalProfile) setProfile({ ...originalProfile });
  };

  const isDirty = JSON.stringify(rules) !== JSON.stringify(original);
  const isProfileDirty = JSON.stringify(profile) !== JSON.stringify(originalProfile);

  if (loading) {
    return (
      <div className="bg-card-bg border border-border-subtle rounded-xl p-8">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-carbon-light">Loading compliance rules...</p>
        </div>
      </div>
    );
  }

  if (!rules || !profile) {
    return (
      <div className="bg-card-bg border border-red-500/20 rounded-xl p-4">
        <p className="text-sm text-red-400">{error ?? "No settings available"}</p>
      </div>
    );
  }

  const update = (patch: Partial<ComplianceRules>) =>
    setRules((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
              Organization Profile
            </h3>
            <p className="text-xs text-carbon-light">
              Borrower emails and intake links use this company name.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isProfileDirty && (
              <Button
                onClick={handleProfileReset}
                variant="outline"
                size="sm"
                className="bg-surface border-border-subtle text-carbon-light hover:text-offwhite text-xs h-8"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset
              </Button>
            )}
            <Button
              onClick={handleSaveProfile}
              disabled={!isProfileDirty || savingProfile}
              size="sm"
              className="bg-accent hover:bg-accent-hover text-white text-xs h-8"
            >
              <Save className="w-3 h-3 mr-1" />
              {savingProfile ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>

        {profileSuccess && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2 mb-4">
            <p className="text-xs text-green-400">Organization profile saved successfully</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <p className="text-sm text-offwhite font-medium">Company Name</p>
            <p className="text-xs text-carbon-light mt-0.5 mb-2">
              This appears in borrower outreach, including intake emails.
            </p>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              placeholder="Acme Auto Finance"
              className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>

          <div>
            <p className="text-sm text-offwhite font-medium">Organization Type</p>
            <p className="text-xs text-carbon-light mt-0.5 mb-2">
              Use the type that best matches your business.
            </p>
            <select
              value={profile.type}
              onChange={(e) => setProfile((prev) => (prev ? { ...prev, type: e.target.value as OrganizationType } : prev))}
              className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            >
              <option value="BHPH_DEALER">BHPH Dealer</option>
              <option value="BANK">Bank</option>
              <option value="CREDIT_UNION">Credit Union</option>
              <option value="FINANCE_COMPANY">Finance Company</option>
            </select>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
            <Settings className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-offwhite">Compliance Rules</h2>
            <p className="text-xs text-carbon-light">
              Configure what constitutes a compliant policy for your portfolio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              onClick={handleReset}
              variant="outline"
              size="sm"
              className="bg-surface border-border-subtle text-carbon-light hover:text-offwhite text-xs h-8"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!isDirty || saving}
            size="sm"
            className="bg-accent hover:bg-accent-hover text-white text-xs h-8"
          >
            <Save className="w-3 h-3 mr-1" />
            {saving ? "Saving..." : "Save Rules"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2">
          <p className="text-xs text-green-400">Rules saved successfully</p>
        </div>
      )}

      {/* Required Coverages */}
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
          Required Coverage Types
        </h3>
        <p className="text-xs text-carbon-light mb-3">
          Policies missing required coverages will be flagged non-compliant
        </p>
        <div className="divide-y divide-border-subtle">
          <Toggle
            label="Require Lienholder Listing"
            description="Dealership must be listed as lienholder/interested party"
            checked={rules.requireLienholder}
            onChange={(v) => update({ requireLienholder: v })}
          />
          <Toggle
            label="Require Comprehensive Coverage"
            description="Policy must include comprehensive (other-than-collision) coverage"
            checked={rules.requireComprehensive}
            onChange={(v) => update({ requireComprehensive: v })}
          />
          <Toggle
            label="Require Collision Coverage"
            description="Policy must include collision coverage"
            checked={rules.requireCollision}
            onChange={(v) => update({ requireCollision: v })}
          />
        </div>
      </div>

      {/* Deductible Limits */}
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
          Maximum Deductibles
        </h3>
        <p className="text-xs text-carbon-light mb-3">
          Flag policies with deductibles exceeding these limits. Leave blank for no limit.
        </p>
        <div className="divide-y divide-border-subtle">
          <NumberInput
            label="Max Comprehensive Deductible"
            description="Maximum allowed deductible for comprehensive coverage"
            value={rules.maxCompDeductible}
            onChange={(v) => update({ maxCompDeductible: v })}
            suffix="USD"
            placeholder="1000"
          />
          <NumberInput
            label="Max Collision Deductible"
            description="Maximum allowed deductible for collision coverage"
            value={rules.maxCollisionDeductible}
            onChange={(v) => update({ maxCollisionDeductible: v })}
            suffix="USD"
            placeholder="1000"
          />
        </div>
      </div>

      {/* Timing */}
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
          Expiration & Grace Periods
        </h3>
        <div className="divide-y divide-border-subtle">
          <NumberInput
            label="Expiration Warning"
            description="Flag policies expiring within this many days"
            value={rules.expirationWarningDays}
            onChange={(v) => update({ expirationWarningDays: v ?? 15 })}
            suffix="days"
          />
          <NumberInput
            label="Lapse Grace Period"
            description="Days after expiration before marking non-compliant"
            value={rules.lapseGracePeriodDays}
            onChange={(v) => update({ lapseGracePeriodDays: v ?? 5 })}
            suffix="days"
          />
        </div>
      </div>

      {/* Automation */}
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
          Automated Reminders
        </h3>
        <div className="divide-y divide-border-subtle">
          <Toggle
            label="Auto-send Expiry Reminders"
            description="Automatically notify borrowers via email and SMS when their policy is about to expire, giving them time to renew before a lapse occurs"
            checked={rules.autoSendReminder}
            onChange={(v) => update({ autoSendReminder: v })}
            onLabel="Enabled"
            offLabel="Disabled"
          />
          {rules.autoSendReminder && (
            <NumberInput
              label="Reminder Lead Time"
              description="Send reminder this many days before expiry"
              value={rules.reminderDaysBeforeExpiry}
              onChange={(v) => update({ reminderDaysBeforeExpiry: v ?? 10 })}
              suffix="days"
            />
          )}
        </div>
      </div>

      {/* SMS Quiet Hours / Timezone */}
      <div className="bg-card-bg border border-border-subtle rounded-xl p-5">
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider mb-1">
          SMS Sending Hours
        </h3>
        <p className="text-xs text-carbon-light mb-3">
          Texts are only sent between 8:00 AM and 9:00 PM in your portfolio&apos;s
          timezone, in line with TCPA-style quiet-hours rules. Requests made
          outside these hours still go out by email; SMS is held back.
        </p>
        <div className="py-3">
          <p className="text-sm text-offwhite font-medium">Portfolio Timezone</p>
          <p className="text-xs text-carbon-light mt-0.5 mb-2">
            Applied to every borrower in this organization.
          </p>
          <select
            value={rules.timezone ?? "America/Chicago"}
            onChange={(e) => update({ timezone: e.target.value })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          >
            <option value="America/New_York">Eastern (America/New_York)</option>
            <option value="America/Chicago">Central (America/Chicago)</option>
            <option value="America/Denver">Mountain (America/Denver)</option>
            <option value="America/Phoenix">Mountain &mdash; no DST (America/Phoenix)</option>
            <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
            <option value="America/Anchorage">Alaska (America/Anchorage)</option>
            <option value="Pacific/Honolulu">Hawaii (Pacific/Honolulu)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
