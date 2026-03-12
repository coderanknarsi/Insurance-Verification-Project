"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type StatusFilter = "ALL" | "GREEN" | "YELLOW" | "RED";

interface BorrowerWithVehicles {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  loanNumber: string;
  measureOneIndividualId?: string;
  vehicles: Array<{
    id: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    policy: {
      id: string;
      status: string;
      dashboardStatus: string;
      measureOneDataRequestId?: string;
    } | null;
  }>;
  overallStatus: "GREEN" | "YELLOW" | "RED";
}

interface BorrowerTableProps {
  organizationId: string;
}

const filterTabs: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "GREEN", label: "Compliant" },
  { value: "YELLOW", label: "At Risk" },
  { value: "RED", label: "Non-Compliant" },
];

export function BorrowerTable({ organizationId }: BorrowerTableProps) {
  const [borrowers, setBorrowers] = useState<BorrowerWithVehicles[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

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
        } else {
          setBorrowers((prev) => [...prev, ...data.borrowers]);
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Borrowers</CardTitle>
        <div className="flex gap-1">
          {filterTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={filter === tab.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading borrowers...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={() => fetchBorrowers()}>
              Retry
            </Button>
          </div>
        ) : borrowers.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              {filter === "ALL"
                ? "No borrowers found. Import borrowers to get started."
                : `No ${filterTabs.find((t) => t.value === filter)?.label?.toLowerCase()} borrowers.`}
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Borrower</TableHead>
                  <TableHead>Loan #</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {borrowers.map((borrower) =>
                  borrower.vehicles.length === 0 ? (
                    <TableRow key={borrower.id}>
                      <TableCell>
                        <StatusDot status={borrower.overallStatus} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {borrower.firstName} {borrower.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{borrower.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {borrower.loanNumber}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        No vehicle
                      </TableCell>
                      <TableCell>
                        <StatusBadge status="RED" size="sm" />
                      </TableCell>
                      <TableCell className="text-right">—</TableCell>
                    </TableRow>
                  ) : (
                    borrower.vehicles.map((vehicle, vIdx) => (
                      <TableRow key={`${borrower.id}-${vehicle.id}`}>
                        {vIdx === 0 ? (
                          <>
                            <TableCell rowSpan={borrower.vehicles.length}>
                              <StatusDot status={borrower.overallStatus} />
                            </TableCell>
                            <TableCell rowSpan={borrower.vehicles.length}>
                              <div>
                                <p className="font-medium">
                                  {borrower.firstName} {borrower.lastName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {borrower.email}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell
                              rowSpan={borrower.vehicles.length}
                              className="font-mono text-sm"
                            >
                              {borrower.loanNumber}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell>
                          <div>
                            <p className="text-sm">
                              {vehicle.year} {vehicle.make} {vehicle.model}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {vehicle.vin}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={
                              (vehicle.policy?.dashboardStatus as "GREEN" | "YELLOW" | "RED") ??
                              "RED"
                            }
                            size="sm"
                          />
                        </TableCell>
                        <TableCell className="text-right">
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
                        </TableCell>
                      </TableRow>
                    ))
                  )
                )}
              </TableBody>
            </Table>

            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : "Load More"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
