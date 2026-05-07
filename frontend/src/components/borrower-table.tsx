"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { BorrowerVerificationBadge } from "@/components/borrower-verification-badge";
import { callGetBorrowers } from "@/lib/api";
import type { BorrowerWithVehicles } from "@/lib/api";
import { Search, Send, Upload, UserPlus, Loader2, X } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { AddBorrowerDialog } from "@/components/add-borrower-dialog";
import { callRequestBorrowerIntake, callGetComplianceRules } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

/** Mirror of the server-side TCPA quiet-hours check. 8 AM – 9 PM in the given IANA timezone. */
function isWithinSendingHours(timezone?: string): boolean {
  const tz = timezone || "America/Chicago";
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
      10,
    );
    return hour >= 8 && hour < 21;
  } catch {
    return true; // fail-open
  }
}

export type StatusFilter = "ALL" | "GREEN" | "YELLOW" | "RED" | "ACTION_REQUIRED" | "AWAITING_INFO";

interface BorrowerTableProps {
  organizationId: string;
  onSelectBorrower?: (borrower: BorrowerWithVehicles) => void;
  onBorrowersLoaded?: (borrowers: BorrowerWithVehicles[]) => void;
  externalFilter?: StatusFilter;
  onFilterChange?: (filter: StatusFilter) => void;
  refreshKey?: number;
  /** When true, highlight the Add Borrower button with a pulsing ring (demo first-run guidance). */
  spotlightAddBorrower?: boolean;
}

const filterTabs: { value: StatusFilter; label: string; dotColor?: string }[] = [
  { value: "ALL", label: "All" },
  { value: "GREEN", label: "Compliant", dotColor: "bg-green-400" },
  { value: "YELLOW", label: "At Risk", dotColor: "bg-yellow-400" },
  { value: "RED", label: "Non-Compliant", dotColor: "bg-red-400" },
  { value: "AWAITING_INFO", label: "Awaiting Info", dotColor: "bg-orange-400" },
];

const ISSUE_LABELS: Record<string, string> = {
  MISSING_LIENHOLDER: "No Lienholder",
  NO_COMPREHENSIVE: "No Comp",
  NO_COLLISION: "No Collision",
  DEDUCTIBLE_TOO_HIGH: "High Deductible",
  POLICY_CANCELLED: "Cancelled",
  POLICY_EXPIRED: "Expired",
  PENDING_CANCELLATION: "Pending Cancel",
  VIN_MISMATCH: "VIN Mismatch",
  VEHICLE_REMOVED: "Removed",
  COVERAGE_EXPIRED: "Coverage Expired",
  EXPIRING_SOON: "Expiring Soon",
  UNVERIFIED: "Pending Verification",
  AWAITING_CREDENTIALS: "Awaiting Info",
};

const CONTACT_TRIGGER_LABELS: Record<string, string> = {
  EXPIRING_SOON: "Expiry reminder",
  LAPSE_DETECTED: "Lapse notice",
  LAPSED_SECOND_NOTICE: "2nd lapse notice",
  LAPSED_FINAL_NOTICE: "Final notice",
  LAPSE_CURED: "Cure confirmation",
  COVERAGE_FIRST_NOTICE: "Coverage notice",
  COVERAGE_SECOND_NOTICE: "2nd coverage notice",
  COVERAGE_FINAL_NOTICE: "Final notice",
  COVERAGE_CURED: "Cure confirmation",
  REINSTATEMENT_REMINDER: "Reinstatement",
  VERIFICATION_PROOF_REQUEST: "Proof requested",
  INTAKE_REQUESTED: "Intake link",
  INTAKE_COMPLETED: "Intake submitted",
  DEALER_SUBMITTED: "Dealer upload",
};

const CONTACT_FINAL_TRIGGERS = new Set([
  "LAPSED_FINAL_NOTICE",
  "COVERAGE_FINAL_NOTICE",
]);
const CONTACT_WARNING_TRIGGERS = new Set([
  "LAPSE_DETECTED",
  "LAPSED_SECOND_NOTICE",
  "COVERAGE_FIRST_NOTICE",
  "COVERAGE_SECOND_NOTICE",
  "EXPIRING_SOON",
  "VERIFICATION_PROOF_REQUEST",
]);
const CONTACT_SUCCESS_TRIGGERS = new Set([
  "LAPSE_CURED",
  "COVERAGE_CURED",
  "INTAKE_COMPLETED",
  "DEALER_SUBMITTED",
]);

function relativeDays(ms: number): string {
  if (!ms) return "—";
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 60) return diffMin <= 1 ? "just now" : `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  const months = Math.floor(diffDay / 30);
  return `${months}mo ago`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function BorrowerTable({ organizationId, onSelectBorrower, onBorrowersLoaded, externalFilter, onFilterChange, refreshKey, spotlightAddBorrower }: BorrowerTableProps) {
  const { user: currentUser } = useAuth();
  const [borrowers, setBorrowers] = useState<BorrowerWithVehicles[]>([]);
  const [internalFilter, setInternalFilter] = useState<StatusFilter>("ALL");
  const filter = externalFilter ?? internalFilter;
  const setFilter = (f: StatusFilter) => {
    setInternalFilter(f);
    onFilterChange?.(f);
  };
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [addBorrowerOpen, setAddBorrowerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // Allow other components (e.g. the demo welcome modal) to programmatically
  // open the Add Borrower dialog by dispatching `window.dispatchEvent(new Event("open-add-borrower"))`.
  useEffect(() => {
    const handler = () => setAddBorrowerOpen(true);
    window.addEventListener("open-add-borrower", handler);
    return () => window.removeEventListener("open-add-borrower", handler);
  }, []);

  const fetchBorrowers = useCallback(
    async (startAfter?: string) => {
      const isInitial = !startAfter;
      if (isInitial) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const res = await callGetBorrowers({
          organizationId,
          dashboardStatus: filter === "ALL" || filter === "ACTION_REQUIRED" || filter === "AWAITING_INFO" ? undefined : filter,
          limit: 50,
          startAfter,
        });
        const data = res.data;

        // For ACTION_REQUIRED, filter to only YELLOW + RED client-side
        // For AWAITING_INFO, filter to borrowers with awaitingCredentials policies
        const results = filter === "ACTION_REQUIRED"
          ? data.borrowers.filter((b: BorrowerWithVehicles) => b.overallStatus === "YELLOW" || b.overallStatus === "RED")
          : filter === "AWAITING_INFO"
            ? data.borrowers.filter((b: BorrowerWithVehicles) =>
                b.vehicles.some((v) => v.policy?.awaitingCredentials === true))
            : data.borrowers;

        if (isInitial) {
          setBorrowers(results);
          setSelectedIds(new Set());
          onBorrowersLoaded?.(results);
        } else {
          const merged = [...borrowers, ...results];
          setBorrowers(merged);
          onBorrowersLoaded?.(merged);
        }
        setHasMore(data.hasMore);
        setLastId(data.lastId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load borrowers");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [organizationId, filter]
  );

  useEffect(() => {
    if (!organizationId) return;
    fetchBorrowers();
  }, [fetchBorrowers, organizationId, refreshKey]);

  const handleLoadMore = () => {
    if (lastId) fetchBorrowers(lastId);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === borrowers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(borrowers.map((b) => b.id)));
    }
  };

  const [orgTimezone, setOrgTimezone] = useState<string>("America/Chicago");
  const [withinSendingHours, setWithinSendingHours] = useState<boolean>(() => isWithinSendingHours("America/Chicago"));

  // Fetch org timezone once and recheck every minute so the button state stays current.
  useEffect(() => {
    if (!organizationId) return;
    callGetComplianceRules({ organizationId })
      .then((res) => {
        const tz = res.data.timezone || "America/Chicago";
        setOrgTimezone(tz);
        setWithinSendingHours(isWithinSendingHours(tz));
      })
      .catch(() => { /* keep defaults */ });
  }, [organizationId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setWithinSendingHours(isWithinSendingHours(orgTimezone));
    }, 60_000);
    return () => clearInterval(interval);
  }, [orgTimezone]);

  const [bulkVerifying, setBulkVerifying] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; skipped: number; quietHours: number; errored: number; lastError: string } | null>(null);

  const handleBulkVerify = async () => {
    if (selectedIds.size === 0 || bulkVerifying) return;

    setBulkVerifying(true);
    setBulkResult(null);

    const selectedBorrowers = borrowers.filter((borrower) => selectedIds.has(borrower.id));
    let sent = 0;
    let skipped = 0;
    let quietHours = 0;
    let errored = 0;
    let lastError = "";

    for (const borrower of selectedBorrowers) {
      const targetVehicle = borrower.vehicles.find((vehicle) => vehicle.policy?.awaitingCredentials === true);
      const canReachBorrower = Boolean(
        borrower.email || (borrower.phone && borrower.smsConsentStatus === "OPTED_IN")
      );

      if (!targetVehicle?.policy || !canReachBorrower) {
        skipped++;
        continue;
      }

      try {
        const res = await callRequestBorrowerIntake({
          organizationId: borrower.organizationId,
          borrowerId: borrower.id,
          vehicleId: targetVehicle.id,
          policyId: targetVehicle.policy.id,
        });

        if (res.data.delivered) {
          sent++;
        } else {
          errored++;
          lastError = res.data.deliveryError ?? "Delivery failed";
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send intake request";
        if (message.toLowerCase().includes("quiet hours")) {
          quietHours++;
          lastError = message;
        } else {
          errored++;
          lastError = message;
        }
      }
    }

    const result = { sent, skipped, quietHours, errored, lastError };
    setBulkResult(result);

    if (sent > 0 && errored === 0 && quietHours === 0) {
      toast.success(`Sent ${sent} intake request${sent !== 1 ? "s" : ""}${skipped > 0 ? ` · ${skipped} skipped` : ""}`);
    } else if (sent > 0 && quietHours > 0 && errored === 0) {
      toast.warning(`Sent ${sent} intake request${sent !== 1 ? "s" : ""}; ${quietHours} phone-only borrower${quietHours !== 1 ? "s" : ""} paused until 8 AM`);
    } else if (sent > 0) {
      toast.warning(`Sent ${sent} intake request${sent !== 1 ? "s" : ""}; ${errored} failed`);
    } else if (quietHours > 0 && errored === 0) {
      toast.warning(lastError || "SMS is paused until 8 AM due to quiet hours.");
    } else if (errored > 0) {
      toast.error(lastError || "Bulk verify failed");
    } else {
      toast.warning("No selected borrowers have an eligible verification request to send.");
    }

    setBulkVerifying(false);
    if (sent > 0) {
      await fetchBorrowers();
    }
  };

  return (
    <div className="bg-card-bg border border-border-subtle rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          {searchOpen ? (
            <div className="flex items-center gap-2 bg-surface border border-border-subtle rounded-lg px-3 py-1.5 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-carbon-light flex-shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search name, email, loan #, VIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-sm text-offwhite placeholder:text-carbon-light outline-none w-full"
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                className="text-carbon-light hover:text-offwhite transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setSearchOpen(true)}
                className="text-carbon-light hover:text-offwhite transition-colors"
                title="Search borrowers"
              >
                <Search className="w-4 h-4" />
              </button>
              <h2 className="text-sm font-semibold text-offwhite">Borrowers</h2>
              <span className="text-xs font-mono text-carbon-light bg-surface px-2 py-0.5 rounded-full">
                {borrowers.length}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Add Borrower button */}
          <Button
            size="sm"
            onClick={() => setAddBorrowerOpen(true)}
            data-tour="add-borrower"
            className={`bg-accent hover:bg-accent-hover text-white border-0 text-xs h-7 px-3 ${
              spotlightAddBorrower ? "ring-2 ring-accent ring-offset-2 ring-offset-card-bg animate-pulse" : ""
            }`}
          >
            <UserPlus className="w-3 h-3 mr-1.5" />
            Add Borrower
          </Button>
          {/* Import button */}
          <Button
            size="sm"
            onClick={() => setImportOpen(true)}
            className="bg-surface border border-border-subtle text-carbon-light hover:text-offwhite hover:bg-white/[0.04] text-xs h-7 px-3"
          >
            <Upload className="w-3 h-3 mr-1.5" />
            Import Customers
          </Button>
          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-carbon-light">
                {selectedIds.size} selected
              </span>
              <div className="relative group">
                <Button
                  size="sm"
                  onClick={handleBulkVerify}
                  disabled={bulkVerifying || !withinSendingHours}
                  className="bg-accent hover:bg-accent-hover text-white text-xs h-7 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {bulkVerifying ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3 mr-1" />
                  )}
                  {bulkVerifying ? "Sending..." : "Bulk Verify"}
                </Button>
                {!withinSendingHours && (
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg bg-surface border border-border-subtle px-3 py-2 text-xs text-carbon-light shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    SMS intake requests are only sent <span className="text-offwhite font-medium">8 AM – 9 PM</span> ({orgTimezone}) to comply with TCPA quiet-hours rules.
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-1 bg-surface rounded-lg p-1">
            {filter === "ACTION_REQUIRED" && (
              <button
                key="action"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-orange-500/15 text-orange-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                Needs Attention
              </button>
            )}
            {filterTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                  filter === tab.value
                    ? "bg-accent/15 text-accent"
                    : filter === "ACTION_REQUIRED" && tab.value === "ALL"
                      ? "text-carbon-light hover:text-offwhite"
                      : "text-carbon-light hover:text-offwhite"
                }`}
              >
                {tab.dotColor && (
                  <span className={`w-1.5 h-1.5 rounded-full ${tab.dotColor}`} />
                )}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quiet-hours banner — shown when outside sending window */}
      {!withinSendingHours && (
        <div className="px-6 py-2 text-xs font-medium bg-yellow-500/10 text-yellow-400 flex items-center gap-2">
          <span>SMS intake requests are paused outside 8 AM – 9 PM ({orgTimezone}) to comply with TCPA quiet-hours rules. Verification requests will be available again at 8 AM.</span>
        </div>
      )}

      {/* Bulk verify result banner */}
      {bulkResult && (
        <div className={`px-6 py-2 text-xs font-medium ${
          bulkResult.skipped === 0 && bulkResult.quietHours === 0 && bulkResult.errored === 0
            ? "bg-green-500/10 text-green-400"
            : bulkResult.errored > 0
              ? "bg-red-500/10 text-red-400"
              : "bg-yellow-500/10 text-yellow-400"
        }`}>
          Sent {bulkResult.sent} intake request{bulkResult.sent !== 1 ? "s" : ""}
          {bulkResult.skipped > 0 && ` · ${bulkResult.skipped} skipped (missing contact, SMS consent, or eligible vehicle)`}
          {bulkResult.quietHours > 0 && ` · ${bulkResult.quietHours} delayed by SMS quiet hours (until 8 AM)`}
          {bulkResult.errored > 0 && ` · ${bulkResult.errored} failed`}
          {bulkResult.lastError && ` — ${bulkResult.lastError}`}
        </div>
      )}

      {/* Content */}
      <div className="px-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-carbon-light">Loading borrowers...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-red-400">{error}</p>
            <Button
              onClick={() => fetchBorrowers()}
              className="bg-surface border border-border-subtle text-carbon-light hover:text-offwhite hover:bg-navy-light text-xs"
            >
              Retry
            </Button>
          </div>
        ) : borrowers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <Upload className="w-8 h-8 text-carbon-light" />
            <div className="text-center">
              <p className="text-sm text-offwhite font-medium">
                {filter === "ALL"
                  ? "No borrowers yet"
                  : `No ${filterTabs.find((t) => t.value === filter)?.label?.toLowerCase()} borrowers`}
              </p>
              {filter === "ALL" && (
                <p className="text-xs text-carbon-light mt-1">Import a CSV, PDF, or image to add your client base</p>
              )}
            </div>
            {filter === "ALL" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setAddBorrowerOpen(true)}
                  className="bg-accent hover:bg-accent-hover text-white border-0"
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                  Add Borrower
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setImportOpen(true)}
                  className="bg-transparent border-border-subtle text-carbon-light hover:text-offwhite"
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Import Customers
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border-subtle hover:bg-transparent">
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === borrowers.length && borrowers.length > 0}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-border-subtle bg-surface accent-accent cursor-pointer"
                    />
                  </TableHead>
                  <TableHead className="w-8 text-carbon-light text-xs font-mono uppercase tracking-wider"></TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Borrower</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Vehicle</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Insurer</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Policy #</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Expires</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Last Contact</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Issues</TableHead>
                  <TableHead className="text-right text-carbon-light text-xs font-mono uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borrowers.filter((b) => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase();
                  const name = `${b.firstName} ${b.lastName}`.toLowerCase();
                  const loan = (b.loanNumber ?? "").toLowerCase();
                  const email = (b.email ?? "").toLowerCase();
                  const v = b.vehicles[0];
                  const vin = (v?.vin ?? "").toLowerCase();
                  const vehicle = v ? `${v.year} ${v.make} ${v.model}`.toLowerCase() : "";
                  return name.includes(q) || loan.includes(q) || email.includes(q) || vin.includes(q) || vehicle.includes(q);
                }).map((borrower) => {
                  const vehicle = borrower.vehicles[0];
                  const policy = vehicle?.policy;
                  const issues = policy?.complianceIssues ?? [];
                  const expEnd = policy?.coveragePeriod?.endDate;
                  const daysLeft = daysUntil(expEnd);

                  return (
                    <TableRow
                      key={borrower.id}
                      className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => onSelectBorrower?.(borrower)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(borrower.id)}
                          onChange={() => toggleSelect(borrower.id)}
                          className="w-3.5 h-3.5 rounded border-border-subtle bg-surface accent-accent cursor-pointer"
                        />
                      </TableCell>
                      <TableCell>
                        <StatusDot status={borrower.overallStatus} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-offwhite text-sm">
                            {borrower.firstName} {borrower.lastName}
                          </p>
                          <p className="text-xs text-carbon-light">{borrower.loanNumber}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {vehicle ? (
                          <div>
                            <p className="text-sm text-offwhite">
                              {vehicle.year} {vehicle.make} {vehicle.model}
                            </p>
                            <p className="text-xs text-carbon font-mono">{vehicle.vin}</p>
                          </div>
                        ) : (
                          <span className="text-carbon text-sm">No vehicle</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-offwhite">
                        {policy?.insuranceProvider ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-carbon-light">
                        {policy?.policyNumber ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm text-offwhite">{formatDate(expEnd)}</p>
                          {daysLeft !== null && (
                            <p className={`text-xs ${
                              daysLeft < 0 ? "text-red-400" :
                              daysLeft <= 15 ? "text-yellow-400" :
                              "text-carbon-light"
                            }`}>
                              {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {borrower.lastContact ? (
                          (() => {
                            const lc = borrower.lastContact;
                            const tone = CONTACT_FINAL_TRIGGERS.has(lc.trigger)
                              ? "text-red-400"
                              : CONTACT_WARNING_TRIGGERS.has(lc.trigger)
                                ? "text-amber-400"
                                : CONTACT_SUCCESS_TRIGGERS.has(lc.trigger)
                                  ? "text-green-400"
                                  : "text-offwhite";
                            const label = CONTACT_TRIGGER_LABELS[lc.trigger] ?? lc.trigger;
                            const channelTag = lc.channel === "BOTH"
                              ? "Email + SMS"
                              : lc.channel === "SMS"
                                ? "SMS"
                                : lc.channel === "EMAIL"
                                  ? "Email"
                                  : lc.channel;
                            return (
                              <div className="max-w-[160px]">
                                <p className={`text-xs font-medium truncate ${tone}`}>{label}</p>
                                <p className="text-[10px] text-carbon-light">
                                  {channelTag} · {relativeDays(lc.sentAt)}
                                </p>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-xs text-carbon">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={borrower.overallStatus} size="sm" />
                        {borrower.verificationState && (
                          <div className="mt-1">
                            <BorrowerVerificationBadge
                              state={borrower.verificationState}
                              lastVerifiedAt={borrower.lastVerifiedAt}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {issues.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {issues.slice(0, 2).map((issue) => (
                              <span
                                key={issue}
                                className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                                  issue === "UNVERIFIED"
                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                }`}
                              >
                                {ISSUE_LABELS[issue] ?? issue}
                              </span>
                            ))}
                            {issues.length > 2 && (
                              <span className="inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface text-carbon-light">
                                +{issues.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-green-400">Clean</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {policy?.awaitingCredentials ? (
                          <div className="relative group">
                          <Button
                            size="sm"
                            disabled={!withinSendingHours}
                            onClick={async () => {
                              if (!vehicle || !withinSendingHours) return;
                              try {
                                const res = await callRequestBorrowerIntake({
                                  organizationId: borrower.organizationId,
                                  borrowerId: borrower.id,
                                  vehicleId: vehicle.id,
                                  policyId: policy.id,
                                });
                                if (res.data.delivered) {
                                  const method = res.data.deliveryMethod === "both" ? "text & email" : res.data.deliveryMethod === "sms" ? "text message" : "email";
                                  if (res.data.smsSuppressedReason === "QUIET_HOURS") {
                                    const tz = res.data.complianceTimezone ?? "your portfolio timezone";
                                    toast.success(
                                      `Request emailed to ${borrower.firstName} ${borrower.lastName}. SMS is paused until 8 AM ${tz} (TCPA quiet hours).`,
                                    );
                                  } else {
                                    toast.success(`Request sent via ${method} to ${borrower.firstName} ${borrower.lastName}`);
                                  }
                                } else {
                                  toast.warning(`Link created but delivery failed: ${res.data.deliveryError ?? "Unknown error"}. Link: ${res.data.intakeUrl}`);
                                }
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed to send intake request");
                              }
                            }}
                            className="bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 border-0 text-xs h-6 px-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Request Info
                          </Button>
                          {!withinSendingHours && (
                            <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-lg bg-surface border border-border-subtle px-3 py-2 text-xs text-carbon-light shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                              Available <span className="text-offwhite font-medium">8 AM – 9 PM</span> ({orgTimezone})
                            </div>
                          )}
                          </div>
                        ) : (
                          <span className="text-xs text-carbon-light">Auto-verified</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {hasMore && (
              <div className="flex justify-center py-4 border-t border-border-subtle">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-xs font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Import Dialog */}
      <ImportDialog
        organizationId={organizationId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportComplete={() => fetchBorrowers()}
      />

      {/* Add Borrower Dialog */}
      <AddBorrowerDialog
        organizationId={organizationId}
        open={addBorrowerOpen}
        onClose={() => setAddBorrowerOpen(false)}
        onComplete={() => fetchBorrowers()}
        currentUserEmail={currentUser?.email ?? null}
        currentUserDisplayName={currentUser?.displayName ?? null}
      />
    </div>
  );
}
