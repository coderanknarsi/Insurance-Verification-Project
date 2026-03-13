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
import { SendVerificationDialog } from "@/components/send-verification-dialog";
import { VerifyNowDialog } from "@/components/verify-now-dialog";
import { callGetBorrowers } from "@/lib/api";
import type { BorrowerWithVehicles } from "@/lib/api";
import { Search, Send } from "lucide-react";

type StatusFilter = "ALL" | "GREEN" | "YELLOW" | "RED";

interface BorrowerTableProps {
  organizationId: string;
  onSelectBorrower?: (borrower: BorrowerWithVehicles) => void;
  onBorrowersLoaded?: (borrowers: BorrowerWithVehicles[]) => void;
}

const filterTabs: { value: StatusFilter; label: string; dotColor?: string }[] = [
  { value: "ALL", label: "All" },
  { value: "GREEN", label: "Compliant", dotColor: "bg-green-400" },
  { value: "YELLOW", label: "At Risk", dotColor: "bg-yellow-400" },
  { value: "RED", label: "Non-Compliant", dotColor: "bg-red-400" },
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
  UNVERIFIED: "Unverified",
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function BorrowerTable({ organizationId, onSelectBorrower, onBorrowersLoaded }: BorrowerTableProps) {
  const [borrowers, setBorrowers] = useState<BorrowerWithVehicles[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
          dashboardStatus: filter === "ALL" ? undefined : filter,
          limit: 50,
          startAfter,
        });
        const data = res.data;

        if (isInitial) {
          setBorrowers(data.borrowers);
          setSelectedIds(new Set());
          onBorrowersLoaded?.(data.borrowers);
        } else {
          const merged = [...borrowers, ...data.borrowers];
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
  }, [fetchBorrowers, organizationId]);

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

  return (
    <div className="bg-card-bg border border-border-subtle rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-carbon-light" />
          <h2 className="text-sm font-semibold text-offwhite">Borrowers</h2>
          <span className="text-xs font-mono text-carbon-light bg-surface px-2 py-0.5 rounded-full">
            {borrowers.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-carbon-light">
                {selectedIds.size} selected
              </span>
              <Button
                size="sm"
                className="bg-accent hover:bg-accent-hover text-white text-xs h-7 px-3"
              >
                <Send className="w-3 h-3 mr-1" />
                Bulk Verify
              </Button>
            </div>
          )}
          <div className="flex gap-1 bg-surface rounded-lg p-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                  filter === tab.value
                    ? "bg-accent/15 text-accent"
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
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-carbon-light">
              {filter === "ALL"
                ? "No borrowers found. Import borrowers to get started."
                : `No ${filterTabs.find((t) => t.value === filter)?.label?.toLowerCase()} borrowers.`}
            </p>
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
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-carbon-light text-xs font-mono uppercase tracking-wider">Issues</TableHead>
                  <TableHead className="text-right text-carbon-light text-xs font-mono uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borrowers.map((borrower) => {
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
                        <StatusBadge status={borrower.overallStatus} size="sm" />
                      </TableCell>
                      <TableCell>
                        {issues.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {issues.slice(0, 2).map((issue) => (
                              <span
                                key={issue}
                                className="inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
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
                        {vehicle ? (
                          <div className="flex justify-end gap-1">
                            <SendVerificationDialog
                              organizationId={organizationId}
                              borrowerId={borrower.id}
                              vehicleId={vehicle.id}
                              borrowerName={`${borrower.firstName} ${borrower.lastName}`}
                              borrowerEmail={borrower.email}
                              borrowerPhone={borrower.phone}
                              vehicleLabel={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            />
                            <VerifyNowDialog
                              organizationId={organizationId}
                              borrowerId={borrower.id}
                              vehicleId={vehicle.id}
                              borrowerName={`${borrower.firstName} ${borrower.lastName}`}
                              vehicleLabel={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            />
                          </div>
                        ) : (
                          <span className="text-carbon">—</span>
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
    </div>
  );
}
