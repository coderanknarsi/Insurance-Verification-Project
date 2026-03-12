"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { callGetDashboardSummary } from "@/lib/api";

interface DashboardSummaryProps {
  organizationId: string;
}

interface Summary {
  green: number;
  yellow: number;
  red: number;
  totalBorrowers: number;
}

export function DashboardSummary({ organizationId }: DashboardSummaryProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    callGetDashboardSummary({ organizationId })
      .then((res) => {
        if (!cancelled) setSummary(res.data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load summary");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm">Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const cards = [
    {
      title: "Compliant",
      count: summary.green,
      subtitle: "Active & verified",
      color: "text-green-600",
      bgColor: "border-green-200 bg-green-50/50",
    },
    {
      title: "At Risk",
      count: summary.yellow,
      subtitle: "Expiring soon",
      color: "text-yellow-600",
      bgColor: "border-yellow-200 bg-yellow-50/50",
    },
    {
      title: "Non-Compliant",
      count: summary.red,
      subtitle: "Lapsed or unverified",
      color: "text-red-600",
      bgColor: "border-red-200 bg-red-50/50",
    },
    {
      title: "Total Borrowers",
      count: summary.totalBorrowers,
      subtitle: "All monitored",
      color: "text-foreground",
      bgColor: "",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className={card.bgColor}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm font-medium ${card.color}`}>
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${card.color}`}>{card.count}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
