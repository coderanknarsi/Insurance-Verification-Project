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
  stripePriceId: string;
}

// Stripe test-mode price IDs — replace with live IDs for production
export const PLAN_CONFIG: Record<SubscriptionPlan, PlanConfig> = {
  [SubscriptionPlan.STARTER]: {
    name: "Starter",
    priceMonthly: 149,
    maxVehicles: 50,
    stripePriceId: "price_1TAgpU2eLlJV4R72kqrPWpQR",
  },
  [SubscriptionPlan.GROWTH]: {
    name: "Growth",
    priceMonthly: 349,
    maxVehicles: 150,
    stripePriceId: "price_1TAgpd2eLlJV4R72wYPO3iAY",
  },
  [SubscriptionPlan.SCALE]: {
    name: "Scale",
    priceMonthly: 599,
    maxVehicles: 300,
    stripePriceId: "price_1TAgpl2eLlJV4R728zeq4me8",
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
  for (const [plan, config] of Object.entries(PLAN_CONFIG)) {
    if (config.stripePriceId === priceId) {
      return plan as SubscriptionPlan;
    }
  }
  return null;
}
