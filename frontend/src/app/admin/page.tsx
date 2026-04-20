"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getClientAuth } from "@/lib/firebase";
import {
  callGetAdminDashboard,
  callGetAdminOrgDetail,
  callSaveMasterCredential,
  callGetMasterCredentials,
  callDeleteMasterCredential,
  type AdminDashboardData,
  type AdminOrgSummary,
  type AdminOrgDetailData,
  type CarrierCredentialMeta,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Users,
  Car,
  DollarSign,
  CreditCard,
  Clock,
  ArrowUpDown,
  LogOut,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronRight,
  Mail,
  MessageSquare,
  TrendingUp,
  Loader2,
  BarChart3,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";

type Tab = "overview" | "revenue" | "carriers";
type SortField = "name" | "plan" | "subscriptionStatus" | "borrowerCount" | "userCount" | "createdAt";
type SortDir = "asc" | "desc";

const STATUS_BADGE: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  active: { variant: "default", label: "Active" },
  trialing: { variant: "secondary", label: "Trial" },
  past_due: { variant: "destructive", label: "Past Due" },
  canceled: { variant: "destructive", label: "Canceled" },
  incomplete: { variant: "outline", label: "Incomplete" },
  unpaid: { variant: "destructive", label: "Unpaid" },
  none: { variant: "outline", label: "No Sub" },
};

const DASHBOARD_STATUS_COLORS: Record<string, string> = {
  GREEN: "bg-green-500/20 text-green-400 border-green-500/30",
  YELLOW: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  RED: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Org drill-down state
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [orgDetail, setOrgDetail] = useState<AdminOrgDetailData | null>(null);
  const [orgDetailLoading, setOrgDetailLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callGetAdminDashboard();
      setData(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExpandOrg = async (orgId: string) => {
    if (expandedOrg === orgId) {
      setExpandedOrg(null);
      setOrgDetail(null);
      return;
    }
    setExpandedOrg(orgId);
    setOrgDetail(null);
    setOrgDetailLoading(true);
    try {
      const res = await callGetAdminOrgDetail({ organizationId: orgId });
      setOrgDetail(res.data);
    } catch {
      setOrgDetail(null);
    } finally {
      setOrgDetailLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedOrgs: AdminOrgSummary[] = data
    ? [...data.organizations].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (typeof aVal === "number" && typeof bVal === "number") return (aVal - bVal) * dir;
        return String(aVal).localeCompare(String(bVal)) * dir;
      })
    : [];

  const formatDate = (ms: number) => {
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
        {sortField === field && (
          <span className="text-xs opacity-70">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </span>
    </TableHead>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Super Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">AutoLienTracker Platform Overview</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/")}>
              App
            </Button>
            <Button variant="ghost" size="sm" onClick={() => signOut(getClientAuth())}>
              <LogOut className="h-4 w-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-6 flex gap-1">
          {([
            { id: "overview" as Tab, label: "Overview", icon: Building2 },
            { id: "revenue" as Tab, label: "Revenue & Usage", icon: TrendingUp },
            { id: "carriers" as Tab, label: "Carrier Credentials", icon: ShieldCheck },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {error && (
          <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-4">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-pulse text-muted-foreground">Loading platform data…</div>
          </div>
        ) : data ? (
          <>
            {activeTab === "overview" && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-4 w-4" /> Organizations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{data.totals.organizations}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <Users className="h-4 w-4" /> Users
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{data.totals.users}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <Users className="h-4 w-4" /> Borrowers
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{data.totals.borrowers}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <Car className="h-4 w-4" /> Vehicles
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{data.totals.vehicles}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <CreditCard className="h-4 w-4" /> Active Subs
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{data.totals.activeSubscriptions}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-4 w-4" /> MRR
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">${data.totals.mrr.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </div>

                {data.totals.trialingSubscriptions > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {data.totals.trialingSubscriptions} organization{data.totals.trialingSubscriptions !== 1 ? "s" : ""} currently on trial
                  </div>
                )}

                {/* Organizations Table with Drill-Down */}
                <Card>
                  <CardHeader>
                    <CardTitle>All Organizations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <SortHeader field="name">Name</SortHeader>
                          <SortHeader field="plan">Plan</SortHeader>
                          <SortHeader field="subscriptionStatus">Status</SortHeader>
                          <SortHeader field="borrowerCount">Borrowers</SortHeader>
                          <SortHeader field="userCount">Users</SortHeader>
                          <SortHeader field="createdAt">Created</SortHeader>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedOrgs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                              No organizations found
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedOrgs.map((org) => {
                            const badge = STATUS_BADGE[org.subscriptionStatus] ?? STATUS_BADGE.none;
                            const isExpanded = expandedOrg === org.id;
                            return (
                              <>
                                <TableRow
                                  key={org.id}
                                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                                  onClick={() => handleExpandOrg(org.id)}
                                >
                                  <TableCell className="w-8 pr-0">
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </TableCell>
                                  <TableCell className="font-medium">{org.name}</TableCell>
                                  <TableCell>{org.plan === "NONE" ? "—" : org.plan}</TableCell>
                                  <TableCell>
                                    <Badge variant={badge.variant}>{badge.label}</Badge>
                                  </TableCell>
                                  <TableCell>{org.borrowerCount}</TableCell>
                                  <TableCell>{org.userCount}</TableCell>
                                  <TableCell className="text-muted-foreground">{formatDate(org.createdAt)}</TableCell>
                                </TableRow>
                                {isExpanded && (
                                  <TableRow key={`${org.id}-detail`}>
                                    <TableCell colSpan={7} className="p-0">
                                      <OrgDetailPanel
                                        orgName={org.name}
                                        detail={orgDetail}
                                        loading={orgDetailLoading}
                                      />
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}

            {activeTab === "revenue" && (
              <RevenueTab data={data} />
            )}

            {activeTab === "carriers" && (
              <CarriersTab />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

/* ─── Org Detail Panel (drill-down) ─────────────────────────── */

function OrgDetailPanel({
  orgName,
  detail,
  loading,
}: {
  orgName: string;
  detail: AdminOrgDetailData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 bg-muted/30 border-t border-border">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">Loading {orgName} data…</span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="py-6 px-8 text-sm text-muted-foreground bg-muted/30 border-t border-border">
        Failed to load organization details.
      </div>
    );
  }

  return (
    <div className="bg-muted/30 border-t border-border">
      <div className="px-8 py-4 space-y-4">
        <h4 className="text-sm font-semibold text-foreground">{orgName} — Borrowers ({detail.borrowers.length})</h4>

        {detail.borrowers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No borrowers found.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Borrower</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.borrowers.map((b) =>
                  b.vehicles.length === 0 ? (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.firstName} {b.lastName}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{b.email}</TableCell>
                      <TableCell className="text-muted-foreground">No vehicles</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                    </TableRow>
                  ) : (
                    b.vehicles.map((v, vi) => (
                      <TableRow key={`${b.id}-${v.id}`}>
                        {vi === 0 ? (
                          <>
                            <TableCell className="font-medium" rowSpan={b.vehicles.length}>
                              {b.firstName} {b.lastName}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs" rowSpan={b.vehicles.length}>
                              {b.email}
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell className="text-sm">
                          {v.year} {v.make} {v.model}
                        </TableCell>
                        <TableCell>
                          {v.policy?.dashboardStatus ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${DASHBOARD_STATUS_COLORS[v.policy.dashboardStatus] ?? "bg-muted text-muted-foreground"}`}>
                              {v.policy.dashboardStatus}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {v.policy?.carrierName ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {v.policy?.expirationDate
                            ? new Date(v.policy.expirationDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {v.policy?.complianceIssues && v.policy.complianceIssues.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {v.policy.complianceIssues.map((issue) => (
                                <Badge key={issue} variant="outline" className="text-xs">
                                  {issue.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Recent Notifications */}
        {detail.notifications.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Recent Notifications ({detail.notifications.length})</h4>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Channel</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.notifications.slice(0, 10).map((n) => (
                    <TableRow key={n.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-xs">
                          {n.channel === "EMAIL" ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                          {n.channel}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{n.trigger.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            n.status === "DELIVERED" ? "default" :
                            n.status === "FAILED" ? "destructive" :
                            "secondary"
                          }
                          className="text-xs"
                        >
                          {n.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Revenue Tab ───────────────────────────────────────────── */

function RevenueTab({ data }: { data: AdminDashboardData }) {
  const totalNotifications = data.notifications.sent + data.notifications.delivered + data.notifications.failed + data.notifications.pending;
  const deliveryRate = totalNotifications > 0
    ? Math.round(((data.notifications.delivered + data.notifications.sent) / totalNotifications) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* MRR Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-4 w-4" /> Monthly Recurring Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">${data.totals.mrr.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              From {data.totals.activeSubscriptions + data.totals.trialingSubscriptions} active/trial subscription{data.totals.activeSubscriptions + data.totals.trialingSubscriptions !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-4 w-4" /> Notification Delivery
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{deliveryRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalNotifications} total notifications sent
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" /> Projected ARR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">${(data.totals.mrr * 12).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Based on current MRR</p>
          </CardContent>
        </Card>
      </div>

      {/* MRR by Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Price / mo</TableHead>
                <TableHead>Subscribers</TableHead>
                <TableHead>Revenue / mo</TableHead>
                <TableHead>% of MRR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.revenue.planBreakdown.map((p) => (
                <TableRow key={p.plan}>
                  <TableCell className="font-medium">{p.plan}</TableCell>
                  <TableCell>{p.priceMonthly > 0 ? `$${p.priceMonthly}` : "Custom"}</TableCell>
                  <TableCell>{p.count}</TableCell>
                  <TableCell className="font-medium">${p.revenue.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {data.totals.mrr > 0 ? `${Math.round((p.revenue / data.totals.mrr) * 100)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell></TableCell>
                <TableCell>{data.revenue.planBreakdown.reduce((s, p) => s + p.count, 0)}</TableCell>
                <TableCell>${data.totals.mrr.toLocaleString()}</TableCell>
                <TableCell>100%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Subscription Status Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Subscription Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(data.revenue.statusBreakdown).map(([status, count]) => {
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.none;
                const pct = data.totals.organizations > 0 ? Math.round((count / data.totals.organizations) * 100) : 0;
                return (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{count}</span>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Notification Delivery Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Delivery</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "Delivered", value: data.notifications.delivered, color: "bg-green-500" },
                { label: "Sent", value: data.notifications.sent, color: "bg-blue-500" },
                { label: "Pending", value: data.notifications.pending, color: "bg-yellow-500" },
                { label: "Failed", value: data.notifications.failed, color: "bg-red-500" },
              ].map((row) => {
                const pct = totalNotifications > 0 ? Math.round((row.value / totalNotifications) * 100) : 0;
                return (
                  <div key={row.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${row.color}`} />
                      <span className="text-sm">{row.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${row.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{row.value}</span>
                      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─── Carriers Tab (Master Credentials) ─────────────────────── */

const SUPPORTED_CARRIERS = [
  { id: "progressive", name: "Progressive" },
  { id: "statefarm", name: "State Farm" },
  { id: "allstate", name: "Allstate" },
  { id: "geico", name: "GEICO" },
  { id: "nationwide", name: "Nationwide" },
];

function CarriersTab() {
  const [credentials, setCredentials] = useState<CarrierCredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [carrierId, setCarrierId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callGetMasterCredentials();
      setCredentials(res.data.credentials);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const handleSave = async () => {
    if (!carrierId || !username || !password) {
      setError("All fields are required.");
      return;
    }
    const carrier = SUPPORTED_CARRIERS.find((c) => c.id === carrierId);
    if (!carrier) {
      setError("Invalid carrier selected.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await callSaveMasterCredential({
        carrierId,
        carrierName: carrier.name,
        username,
        password,
      });
      setSuccess(`${carrier.name} credentials saved successfully.`);
      setShowForm(false);
      setCarrierId("");
      setUsername("");
      setPassword("");
      await fetchCredentials();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await callDeleteMasterCredential({ carrierId: id });
      setSuccess("Credential deleted.");
      setDeletingId(null);
      await fetchCredentials();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete credentials");
    }
  };

  const configuredIds = new Set(credentials.map((c) => c.carrierId));
  const availableCarriers = SUPPORTED_CARRIERS.filter((c) => !configuredIds.has(c.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Master Carrier Credentials</h2>
          <p className="text-sm text-muted-foreground">
            Platform-wide portal credentials used for all insurance verifications.
          </p>
        </div>
        {!showForm && availableCarriers.length > 0 && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Carrier
          </Button>
        )}
      </div>

      {/* Error / Success messages */}
      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg p-3 text-sm">
          {success}
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Carrier Credentials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="carrier-select">Carrier</Label>
              <Select value={carrierId} onValueChange={setCarrierId}>
                <SelectTrigger id="carrier-select">
                  <SelectValue placeholder="Select a carrier..." />
                </SelectTrigger>
                <SelectContent>
                  {availableCarriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cred-username">Portal Username</Label>
              <Input
                id="cred-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. autoLT"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cred-password">Portal Password</Label>
              <div className="relative">
                <Input
                  id="cred-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save Credentials
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setCarrierId("");
                  setUsername("");
                  setPassword("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credentials List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">Loading credentials…</span>
        </div>
      ) : credentials.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No carrier credentials configured yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add your master portal credentials for each carrier to enable automated verification.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.carrierId}>
                    <TableCell className="font-medium">{cred.carrierName}</TableCell>
                    <TableCell>
                      <Badge variant={cred.active ? "default" : "destructive"}>
                        {cred.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {cred.createdAt
                        ? (() => {
                            const raw = cred.createdAt as unknown;
                            const ms =
                              typeof raw === "object" && raw !== null && "_seconds" in raw
                                ? (raw as { _seconds: number })._seconds * 1000
                                : typeof raw === "number"
                                  ? raw
                                  : Date.parse(raw as string);
                            return isNaN(ms)
                              ? "—"
                              : new Date(ms).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                });
                          })()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {deletingId === cred.carrierId ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-sm text-destructive">Delete?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(cred.carrierId)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeletingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const carrier = SUPPORTED_CARRIERS.find((c) => c.id === cred.carrierId);
                              if (carrier) {
                                setCarrierId(carrier.id);
                                setShowForm(true);
                              }
                            }}
                          >
                            Update
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingId(cred.carrierId)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
