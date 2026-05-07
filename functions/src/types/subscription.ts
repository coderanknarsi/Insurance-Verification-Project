export enum SubscriptionPlan {
  STARTER = "STARTER",
  GROWTH = "GROWTH",
  SCALE = "SCALE",
  ENTERPRISE = "ENTERPRISE",
}

export type StripeSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export interface PlanConfig {
  name: string;
  priceMonthly: number;
  maxVehicles: number;
  /**
   * Stripe price ID. Resolved from environment variables at runtime so that
   * test-mode and live-mode deployments can use the same code without
   * baking IDs into source. Use `getStripePriceId(plan)` for the live value.
   */
  stripePriceId: string;
}

/**
 * Resolve the Stripe price ID for a plan from environment variables.
 * Required env vars (set via Firebase config / Secret Manager):
 *   STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_SCALE
 * Enterprise has no self-serve price (custom contract).
 */
export function getStripePriceId(plan: SubscriptionPlan): string {
  switch (plan) {
    case SubscriptionPlan.STARTER:
      return process.env.STRIPE_PRICE_STARTER ?? "";
    case SubscriptionPlan.GROWTH:
      return process.env.STRIPE_PRICE_GROWTH ?? "";
    case SubscriptionPlan.SCALE:
      return process.env.STRIPE_PRICE_SCALE ?? "";
    case SubscriptionPlan.ENTERPRISE:
      return "";
  }
}

export const PLAN_CONFIG: Record<SubscriptionPlan, PlanConfig> = {
  [SubscriptionPlan.STARTER]: {
    name: "Starter",
    priceMonthly: 149,
    maxVehicles: 50,
    get stripePriceId() {
      return getStripePriceId(SubscriptionPlan.STARTER);
    },
  },
  [SubscriptionPlan.GROWTH]: {
    name: "Growth",
    priceMonthly: 349,
    maxVehicles: 150,
    get stripePriceId() {
      return getStripePriceId(SubscriptionPlan.GROWTH);
    },
  },
  [SubscriptionPlan.SCALE]: {
    name: "Scale",
    priceMonthly: 599,
    maxVehicles: 300,
    get stripePriceId() {
      return getStripePriceId(SubscriptionPlan.SCALE);
    },
  },
  [SubscriptionPlan.ENTERPRISE]: {
    name: "Enterprise",
    priceMonthly: 0,
    maxVehicles: Infinity,
    stripePriceId: "", // Custom pricing — no self-serve checkout
  },
};

export interface StripeSubscriptionData {
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  plan: SubscriptionPlan;
  status: StripeSubscriptionStatus;
  currentPeriodEnd?: number; // Unix timestamp
  trialEnd?: number; // Unix timestamp
  cancelAtPeriodEnd?: boolean;
}

export function getPlanByPriceId(priceId: string): SubscriptionPlan | null {
  if (!priceId) return null;
  for (const plan of Object.values(SubscriptionPlan)) {
    if (getStripePriceId(plan) === priceId) {
      return plan;
    }
  }
  return null;
}
