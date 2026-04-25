"use client";

import { useState } from "react";
import { X, Shield, Car, FileText, AlertTriangle, Clock, Phone, Mail, User, Pencil, Trash2, Check, Loader2, MessageSquare, Image } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { callUpdateBorrower, callDeleteBorrower } from "@/lib/api";
import type { BorrowerWithVehicles, PolicyData } from "@/lib/api";

interface BorrowerDetailPanelProps {
  borrower: BorrowerWithVehicles;
  onClose: () => void;
  onUpdated?: () => void;
  onDeleted?: () => void;
}

const ISSUE_LABELS: Record<string, string> = {
  MISSING_LIENHOLDER: "Lienholder not listed on policy",
  NO_COMPREHENSIVE: "Missing comprehensive coverage",
  NO_COLLISION: "Missing collision coverage",
  DEDUCTIBLE_TOO_HIGH: "Deductible exceeds maximum",
  POLICY_CANCELLED: "Policy has been cancelled",
  POLICY_EXPIRED: "Policy has expired",
  PENDING_CANCELLATION: "Policy pending cancellation",
  VIN_MISMATCH: "VIN does not match records",
  VEHICLE_REMOVED: "Vehicle removed from policy",
  COVERAGE_EXPIRED: "Coverage period has expired",
  EXPIRING_SOON: "Policy expiring soon",
  UNVERIFIED: "Pending deep verification",
  AWAITING_CREDENTIALS: "Awaiting insurance info from borrower",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  PENDING_ACTIVATION: "Pending Verification",
  PENDING_CANCELLATION: "Pending Cancellation",
  PENDING_EXPIRATION: "Pending Expiration",
  CANCELLED: "Cancelled",
  UNVERIFIED: "Unverified",
  RESCINDED: "Rescinded",
  NOT_AVAILABLE: "Not Available",
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(ts?: { _seconds: number }): string {
  if (!ts?._seconds) return "Never";
  return new Date(ts._seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCurrency(amt?: { currency: string; amount: number }): string {
  if (!amt) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: amt.currency,
  }).format(amt.amount);
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-accent" />
        <h3 className="text-xs font-semibold text-offwhite uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-xs text-carbon-light">{label}</span>
      <span className={`text-xs font-medium text-offwhite ${className ?? ""}`}>{value}</span>
    </div>
  );
}

function PolicySection({ policy }: { policy: PolicyData }) {
  // Find the lienholder from interested parties
  const lienholder = policy.interestedParties?.find(
    (ip) => ip.type === "LIEN_HOLDER"
  );

  return (
    <>
      {/* Coverage & Deductibles — FIRST so lenders see it immediately */}
      {policy.coverageItems && policy.coverageItems.length > 0 && (
        <Section title="Coverage & Deductibles" icon={Shield}>
          <div
            className="space-y-2"
            style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
          >
            {policy.coverageItems.map((ci, idx) => (
              <div key={idx} className="bg-surface rounded-lg p-2.5">
                <p className="text-xs font-semibold text-offwhite mb-1">
                  {ci.name ?? ci.type}
                </p>
                {ci.limits.map((l, li) => (
                  <div key={li} className="flex justify-between py-0.5">
                    <span className="text-xs text-carbon-light">Limit ({l.type})</span>
                    <span className="text-xs font-semibold text-offwhite">
                      {l.amount ? `$${l.amount.toLocaleString()}` : l.text ?? "—"}
                    </span>
                  </div>
                ))}
                {ci.deductibles.map((d, di) => (
                  <div key={di} className="flex justify-between py-0.5">
                    <span className="text-xs text-carbon-light">
                      Deductible{d.isWaiver ? " (Waiver)" : ""}
                    </span>
                    <span className="text-xs font-semibold text-offwhite">
                      {d.amount ? `$${d.amount.toLocaleString()}` : d.text ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Lienholder / Interested Parties — SECOND so lenders see who's listed */}
      <Section title="Lienholder" icon={User}>
        {lienholder ? (
          <div className="bg-surface rounded-lg p-2.5">
            <div className="flex justify-between items-start">
              <p className="text-xs font-medium text-offwhite">{lienholder.name}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">
                Listed
              </span>
            </div>
            {lienholder.loanNumber && (
              <p className="text-[10px] text-carbon-light mt-0.5">Loan: {lienholder.loanNumber}</p>
            )}
            {lienholder.address && (
              <p className="text-[10px] text-carbon-light mt-0.5">
                {[lienholder.address.addr1, lienholder.address.city, lienholder.address.state, lienholder.address.zipcode]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {lienholder.phone && (
              <p className="text-[10px] text-carbon-light mt-0.5">{lienholder.phone}</p>
            )}
          </div>
        ) : (
          <div className="bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-red-400">Not listed on policy</p>
          </div>
        )}
        {/* Other interested parties (non-lienholder) */}
        {policy.interestedParties && policy.interestedParties.filter((ip) => ip.type !== "LIEN_HOLDER").length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[10px] text-carbon-light uppercase tracking-wider">Other Parties</p>
            {policy.interestedParties.filter((ip) => ip.type !== "LIEN_HOLDER").map((ip, idx) => (
              <div key={idx} className="bg-surface rounded-lg p-2.5">
                <div className="flex justify-between items-start">
                  <p className="text-xs font-medium text-offwhite">{ip.name}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                    {ip.type.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Policy Details — THIRD */}
      <Section title="Policy Details" icon={FileText}>
        <InfoRow label="Policy #" value={policy.policyNumber ?? "—"} />
        <InfoRow label="Status" value={STATUS_LABELS[policy.status] ?? policy.status} />
        <InfoRow label="Insurer" value={policy.insuranceProvider ?? "—"} />
        {policy.insuranceProviderDetail?.naicCode && (
          <InfoRow label="NAIC Code" value={policy.insuranceProviderDetail.naicCode} />
        )}
        {policy.insuranceProviderDetail?.phone && (
          <InfoRow label="Insurer Phone" value={policy.insuranceProviderDetail.phone} />
        )}
        <InfoRow label="Policy Type" value={policy.policyTypes?.join(", ") ?? "—"} />
        <InfoRow label="Premium" value={formatCurrency(policy.premiumAmount)} />
        <InfoRow label="Payment" value={policy.paymentFrequency?.replace(/_/g, " ") ?? "—"} />
        <InfoRow label="Effective" value={formatDate(policy.coveragePeriod?.startDate)} />
        <InfoRow label="Expires" value={formatDate(policy.coveragePeriod?.endDate)} />
        {policy.cancelledDate && (
          <InfoRow label="Cancelled" value={formatDate(policy.cancelledDate)} className="text-red-400" />
        )}
        <InfoRow label="Last Verified" value={formatTimestamp(policy.lastVerifiedAt)} />
      </Section>

      {/* Drivers */}
      {policy.drivers && policy.drivers.length > 0 && (
        <Section title="Listed Drivers" icon={Car}>
          {policy.drivers.map((d, idx) => (
            <p key={idx} className="text-xs text-offwhite py-0.5">
              {d.fullName ?? `${d.firstName ?? ""} ${d.lastName ?? ""}`}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

export function BorrowerDetailPanel({ borrower, onClose, onUpdated, onDeleted }: BorrowerDetailPanelProps) {
  const vehicle = borrower.vehicles[0];
  const policy = vehicle?.policy;
  const issues = policy?.complianceIssues ?? [];

  // Edit state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState({
    firstName: borrower.firstName,
    lastName: borrower.lastName,
    email: borrower.email ?? "",
    phone: borrower.phone ?? "",
    smsConsentStatus: borrower.smsConsentStatus ?? "NOT_SET",
  });

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await callUpdateBorrower({
        organizationId: borrower.organizationId,
        borrowerId: borrower.id,
        updates: editFields,
      });
      setEditing(false);
      onUpdated?.();
    } catch {
      // stay in edit mode on error
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await callDeleteBorrower({
        organizationId: borrower.organizationId,
        borrowerId: borrower.id,
      });
      onDeleted?.();
      onClose();
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-card-bg border-l border-border-subtle shadow-2xl shadow-black/50 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <StatusBadge status={borrower.overallStatus} size="sm" />
          <div>
            <h2 className="text-sm font-semibold text-offwhite">
              {borrower.firstName} {borrower.lastName}
            </h2>
            <p className="text-xs text-carbon-light">{borrower.loanNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              title="Edit borrower"
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-carbon-light" />
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete borrower"
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-carbon-light hover:text-red-400" />
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface transition-colors"
          >
            <X className="w-4 h-4 text-carbon-light" />
          </button>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="px-5 py-3 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400 font-medium mb-2">
            Delete {borrower.firstName} {borrower.lastName}?
          </p>
          <p className="text-[10px] text-carbon-light mb-3">
            This will permanently remove this borrower and all their vehicle, policy, and notification data.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
              {deleting ? "Deleting..." : "Yes, Delete"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface text-carbon-light hover:bg-border-subtle"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-0">
        {/* Contact info */}
        <Section title="Contact" icon={Mail}>
          {editing ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-carbon-light mb-0.5 block">First Name</label>
                  <input
                    value={editFields.firstName}
                    onChange={(e) => setEditFields({ ...editFields, firstName: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-offwhite focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-carbon-light mb-0.5 block">Last Name</label>
                  <input
                    value={editFields.lastName}
                    onChange={(e) => setEditFields({ ...editFields, lastName: e.target.value })}
                    className="w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-offwhite focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-carbon-light mb-0.5 block">Email</label>
                <input
                  value={editFields.email}
                  onChange={(e) => setEditFields({ ...editFields, email: e.target.value })}
                  type="email"
                  className="w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-offwhite focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] text-carbon-light mb-0.5 block">Phone</label>
                <input
                  value={editFields.phone}
                  onChange={(e) => setEditFields({ ...editFields, phone: e.target.value })}
                  type="tel"
                  className="w-full px-2 py-1.5 text-xs bg-surface border border-border-subtle rounded-md text-offwhite focus:outline-none focus:border-accent"
                />
              </div>
              {editFields.phone && (
                <div
                  className="flex items-center justify-between px-2.5 py-2 rounded-md bg-surface border border-border-subtle cursor-pointer"
                  onClick={() =>
                    setEditFields({
                      ...editFields,
                      smsConsentStatus: editFields.smsConsentStatus === "OPTED_IN" ? "OPTED_OUT" : "OPTED_IN",
                    })
                  }
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-carbon-light" />
                    <span className="text-xs text-offwhite">SMS Consent</span>
                  </div>
                  <div
                    className={`w-8 h-[18px] rounded-full transition-colors relative ${
                      editFields.smsConsentStatus === "OPTED_IN" ? "bg-accent" : "bg-border-subtle"
                    }`}
                  >
                    <div
                      className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                        editFields.smsConsentStatus === "OPTED_IN" ? "translate-x-[16px]" : "translate-x-[2px]"
                      }`}
                    />
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditFields({
                      firstName: borrower.firstName,
                      lastName: borrower.lastName,
                      email: borrower.email ?? "",
                      phone: borrower.phone ?? "",
                      smsConsentStatus: borrower.smsConsentStatus ?? "NOT_SET",
                    });
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface text-carbon-light hover:bg-border-subtle"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 py-0.5">
                <Mail className="w-3 h-3 text-carbon-light" />
                <span className="text-xs text-offwhite">{borrower.email || "—"}</span>
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <Phone className="w-3 h-3 text-carbon-light" />
                <span className="text-xs text-offwhite">{borrower.phone || "—"}</span>
              </div>
              {borrower.phone && (
                <div className="flex items-center gap-2 py-0.5">
                  <MessageSquare className="w-3 h-3 text-carbon-light" />
                  <span className={`text-xs ${borrower.smsConsentStatus === "OPTED_IN" ? "text-green-400" : "text-carbon-light"}`}>
                    SMS {borrower.smsConsentStatus === "OPTED_IN" ? "Enabled" : "Disabled"}
                  </span>
                </div>
              )}
            </>
          )}
        </Section>

        {/* Vehicle */}
        {vehicle && (
          <Section title="Vehicle" icon={Car}>
            <InfoRow
              label="Vehicle"
              value={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            />
            <InfoRow label="VIN" value={vehicle.vin} className="font-mono" />
            {policy?.vehicleRemovedFromPolicy && (
              <div className="mt-1 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
                <p className="text-[10px] text-red-400 font-medium">Vehicle removed from policy</p>
              </div>
            )}
          </Section>
        )}

        {/* Compliance Issues */}
        {issues.length > 0 && (
          <Section title="Compliance Issues" icon={AlertTriangle}>
            <div className="space-y-1.5">
              {issues.map((issue) => {
                const isInfo = issue === "UNVERIFIED";
                return (
                  <div
                    key={issue}
                    className={`flex items-start gap-2 px-2.5 py-2 rounded-lg ${
                      isInfo
                        ? "bg-blue-500/5 border border-blue-500/15"
                        : "bg-red-500/5 border border-red-500/15"
                    }`}
                  >
                    <AlertTriangle className={`w-3 h-3 mt-0.5 flex-shrink-0 ${
                      isInfo ? "text-blue-400" : "text-red-400"
                    }`} />
                    <div>
                      <p className={`text-xs font-medium ${
                        isInfo ? "text-blue-400" : "text-red-400"
                      }`}>
                        {ISSUE_LABELS[issue] ?? issue}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Insurance Card */}
        {policy?.insuranceCardUrl && (
          <Section title="Insurance Card" icon={Image}>
            <a
              href={policy.insuranceCardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 hover:bg-accent/15 transition-colors"
            >
              <FileText className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="text-xs font-medium text-accent">View Uploaded Insurance Card</span>
            </a>
          </Section>
        )}

        {/* Policy Details */}
        {policy ? (
          <PolicySection policy={policy} />
        ) : (
          <Section title="Policy" icon={FileText}>
            <div className="flex items-center gap-2 py-4 justify-center">
              <Clock className="w-4 h-4 text-carbon-light" />
              <p className="text-xs text-carbon-light">No policy data available</p>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
