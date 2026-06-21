import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireSuperAdmin } from "../middleware/auth";
import {
  SubscriptionPlan,
  PLAN_CONFIG,
  getStripePriceId,
  type StripeSubscriptionData,
} from "../types/subscription";
import { stripeSecretKey } from "../services/stripe";
import {
  extendTrial,
  applyCoupon,
  removeCoupon,
  changePlanPrice,
  compSubscription,
} from "../services/admin-billing";
import { DEMO_ORG_ID } from "../constants";

/* ─── Pure validators (unit-tested) ─────────────────────────── */

export function validateExtendDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    throw new Error("days must be an integer between 1 and 365");
  }
  return days;
}

export function validateDiscount(d: { percentOff?: number; amountOff?: number }) {
  const hasPct = typeof d.percentOff === "number";
  const hasAmt = typeof d.amountOff === "number";
  if (hasPct === hasAmt) {
    throw new Error("provide exactly one of percentOff or amountOff");
  }
  if (hasPct && (d.percentOff! <= 0 || d.percentOff! > 100)) {
    throw new Error("percentOff must be 1-100");
  }
  if (hasAmt && d.amountOff! <= 0) {
    throw new Error("amountOff must be > 0");
  }
  return d;
}

export function validatePlan(plan: string): string {
  if (!["STARTER", "GROWTH", "SCALE", "ENTERPRISE"].includes(plan)) {
    throw new Error(`Unknown plan: ${plan}`);
  }
  return plan;
}

/* ─── Helpers ───────────────────────────────────────────────── */

async function loadOrgWithSubscription(organizationId: string): Promise<{
  stripe: StripeSubscriptionData;
}> {
  if (!organizationId) {
    throw new HttpsError("invalid-argument", "organizationId is required.");
  }
  if (organizationId === DEMO_ORG_ID) {
    throw new HttpsError(
      "permission-denied",
      "Billing adjustments are disabled for the demo organization.",
    );
  }
  const orgDoc = await collections.organizations.doc(organizationId).get();
  if (!orgDoc.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const stripe = orgDoc.data()?.stripe as StripeSubscriptionData | undefined;
  if (!stripe?.stripeSubscriptionId) {
    throw new HttpsError(
      "failed-precondition",
      "Organization has no active subscription.",
    );
  }
  return { stripe };
}

async function audit(
  organizationId: string,
  email: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await collections.auditLog.add({
    organizationId,
    entityType: "ORGANIZATION",
    entityId: organizationId,
    action,
    newValue: metadata,
    performedBy: email,
    timestamp: FieldValue.serverTimestamp(),
  } as never);
}

/* ─── Callables ─────────────────────────────────────────────── */

export const adminExtendTrial = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId, days } = request.data as {
      organizationId?: string;
      days?: number;
    };
    let validDays: number;
    try {
      validDays = validateExtendDays(days as number);
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    const nowSec = Math.floor(Date.now() / 1000);
    const base = Math.max(stripe.trialEnd ?? nowSec, nowSec);
    const newTrialEnd = base + validDays * 86400;

    const res = await extendTrial(stripe.stripeSubscriptionId!, newTrialEnd);

    await collections.organizations.doc(organizationId as string).update({
      "stripe.trialEnd": res.trialEnd,
      "stripe.status": res.status,
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.extend_trial", {
      days: validDays,
      trialEnd: res.trialEnd,
    });
    return { ok: true, trialEnd: res.trialEnd, status: res.status };
  },
);

export const adminApplyDiscount = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId, percentOff, amountOff } = request.data as {
      organizationId?: string;
      percentOff?: number;
      amountOff?: number;
    };
    try {
      validateDiscount({ percentOff, amountOff });
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    const res = await applyCoupon(stripe.stripeSubscriptionId!, {
      percentOff,
      amountOff,
    });

    await collections.organizations.doc(organizationId as string).update({
      "stripe.discountCode": res.discountCode,
      "stripe.discountPercent": res.discountPercent ?? FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.apply_discount", {
      percentOff: percentOff ?? null,
      amountOff: amountOff ?? null,
      discountCode: res.discountCode,
    });
    return { ok: true, discountCode: res.discountCode, discountPercent: res.discountPercent };
  },
);

export const adminRemoveDiscount = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId } = request.data as { organizationId?: string };
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    await removeCoupon(stripe.stripeSubscriptionId!);

    await collections.organizations.doc(organizationId as string).update({
      "stripe.discountCode": FieldValue.delete(),
      "stripe.discountPercent": FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.remove_discount", {});
    return { ok: true };
  },
);

export const adminChangeOrgPlan = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId, plan } = request.data as {
      organizationId?: string;
      plan?: string;
    };
    let validPlan: string;
    try {
      validPlan = validatePlan(plan as string);
    } catch (e) {
      throw new HttpsError("invalid-argument", (e as Error).message);
    }
    const planEnum = validPlan as SubscriptionPlan;
    const priceId = getStripePriceId(planEnum);
    if (!priceId || !PLAN_CONFIG[planEnum]?.stripePriceId) {
      throw new HttpsError(
        "invalid-argument",
        "That plan has no self-serve price (Enterprise is custom).",
      );
    }
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    const res = await changePlanPrice(stripe.stripeSubscriptionId!, priceId);

    await collections.organizations.doc(organizationId as string).update({
      "stripe.plan": planEnum,
      "stripe.stripePriceId": priceId,
      "stripe.status": res.status,
      "stripe.currentPeriodEnd": res.currentPeriodEnd,
      "subscription.tier": planEnum,
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.change_plan", {
      plan: planEnum,
    });
    return { ok: true, plan: planEnum, status: res.status };
  },
);

export const adminCompOrganization = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId } = request.data as { organizationId?: string };
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    const res = await compSubscription(stripe.stripeSubscriptionId!);

    await collections.organizations.doc(organizationId as string).update({
      "stripe.compedAt": res.compedAt,
      "stripe.discountCode": res.discountCode,
      "stripe.discountPercent": 100,
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.comp", {
      compedAt: res.compedAt,
    });
    return { ok: true, compedAt: res.compedAt };
  },
);

export const adminUncompOrganization = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireSuperAdmin(request);
    const email = request.auth?.token?.email ?? "super-admin";
    const { organizationId } = request.data as { organizationId?: string };
    const { stripe } = await loadOrgWithSubscription(organizationId as string);

    await removeCoupon(stripe.stripeSubscriptionId!);

    await collections.organizations.doc(organizationId as string).update({
      "stripe.compedAt": FieldValue.delete(),
      "stripe.discountCode": FieldValue.delete(),
      "stripe.discountPercent": FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    await audit(organizationId as string, email, "billing.uncomp", {});
    return { ok: true };
  },
);
