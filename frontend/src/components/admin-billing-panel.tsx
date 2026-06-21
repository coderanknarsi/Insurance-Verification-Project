"use client";

import { useState } from "react";
import {
  callAdminExtendTrial,
  callAdminApplyDiscount,
  callAdminRemoveDiscount,
  callAdminChangeOrgPlan,
  callAdminCompOrganization,
  callAdminUncompOrganization,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Gift, Percent, CreditCard, CheckCircle2 } from "lucide-react";

type PlanKey = "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";

export function AdminBillingPanel({
  organizationId,
  plan,
  subscriptionStatus,
  onChanged,
}: {
  organizationId: string;
  plan: string;
  subscriptionStatus: string;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discountPct, setDiscountPct] = useState("");
  const [discountAmt, setDiscountAmt] = useState("");

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Billing controls</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{plan}</Badge>
          <Badge
            variant={subscriptionStatus === "active" ? "default" : "secondary"}
            className="text-xs"
          >
            {subscriptionStatus}
          </Badge>
        </div>
      </div>

      {msg && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-600 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> {msg}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Extend trial */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Gift className="h-3.5 w-3.5" /> Extend trial
          </p>
          <div className="flex gap-2">
            {[30, 60, 90].map((d) => (
              <Button
                key={d}
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    `trial-${d}`,
                    () => callAdminExtendTrial({ organizationId, days: d }),
                    `Trial extended by ${d} days.`,
                  )
                }
              >
                {busy === `trial-${d}` ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  `+${d}d`
                )}
              </Button>
            ))}
          </div>
        </div>

        {/* Change plan */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CreditCard className="h-3.5 w-3.5" /> Change plan
          </p>
          <Select
            disabled={busy !== null}
            onValueChange={(v) =>
              run(
                "plan",
                () => callAdminChangeOrgPlan({ organizationId, plan: v as PlanKey }),
                `Plan changed to ${v}.`,
              )
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="STARTER">Starter — $49</SelectItem>
              <SelectItem value="GROWTH">Growth — $99</SelectItem>
              <SelectItem value="SCALE">Scale — $199</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Discount */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Percent className="h-3.5 w-3.5" /> Apply discount
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="% off"
              value={discountPct}
              onChange={(e) => {
                setDiscountPct(e.target.value);
                setDiscountAmt("");
              }}
              className="h-8 text-xs"
            />
            <Input
              placeholder="$ off"
              value={discountAmt}
              onChange={(e) => {
                setDiscountAmt(e.target.value);
                setDiscountPct("");
              }}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || (!discountPct && !discountAmt)}
              onClick={() =>
                run(
                  "discount",
                  () =>
                    callAdminApplyDiscount({
                      organizationId,
                      percentOff: discountPct ? Number(discountPct) : undefined,
                      amountOff: discountAmt ? Number(discountAmt) : undefined,
                    }),
                  "Discount applied.",
                )
              }
            >
              {busy === "discount" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Apply"
              )}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            disabled={busy !== null}
            onClick={() =>
              run(
                "remove-discount",
                () => callAdminRemoveDiscount({ organizationId }),
                "Discount removed.",
              )
            }
          >
            Remove discount
          </Button>
        </div>

        {/* Comp */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Comp account (free)</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "comp",
                  () => callAdminCompOrganization({ organizationId }),
                  "Account comped (100% off).",
                )
              }
            >
              {busy === "comp" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Comp free"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "uncomp",
                  () => callAdminUncompOrganization({ organizationId }),
                  "Comp removed.",
                )
              }
            >
              Remove comp
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
