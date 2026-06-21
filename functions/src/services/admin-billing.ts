import Stripe from "stripe";
import { getStripe } from "./stripe";

/**
 * Stripe wrappers used by the super-admin billing callables. Each function
 * performs the Stripe-side mutation and returns the fields the caller should
 * mirror onto `organizations/{id}.stripe.*`. Keeping Stripe calls here keeps
 * the callables thin and consistent with `stripe-billing.ts`.
 */

/** Update a subscription's trial end (unix seconds). */
export async function extendTrial(
  subscriptionId: string,
  newTrialEndUnix: number,
): Promise<{ trialEnd: number; status: Stripe.Subscription.Status }> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.update(subscriptionId, {
    trial_end: newTrialEndUnix,
    proration_behavior: "none",
  });
  return { trialEnd: sub.trial_end ?? newTrialEndUnix, status: sub.status };
}

/**
 * Create a recurring (forever) coupon and attach it to the subscription.
 * Provide exactly one of percentOff / amountOff (amountOff in whole USD).
 */
export async function applyCoupon(
  subscriptionId: string,
  opts: { percentOff?: number; amountOff?: number },
): Promise<{ discountCode: string; discountPercent: number | null }> {
  const stripe = getStripe();
  const couponParams: Stripe.CouponCreateParams = { duration: "forever" };
  if (typeof opts.percentOff === "number") {
    couponParams.percent_off = opts.percentOff;
  } else if (typeof opts.amountOff === "number") {
    couponParams.amount_off = Math.round(opts.amountOff * 100);
    couponParams.currency = "usd";
  }
  const coupon = await stripe.coupons.create(couponParams);
  await stripe.subscriptions.update(subscriptionId, {
    discounts: [{ coupon: coupon.id }],
  });
  return {
    discountCode: coupon.id,
    discountPercent: coupon.percent_off ?? null,
  };
}

/** Remove any discount from a subscription. */
export async function removeCoupon(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.deleteDiscount(subscriptionId);
}

/** Swap the subscription's price to a new plan price. */
export async function changePlanPrice(
  subscriptionId: string,
  newPriceId: string,
): Promise<{ status: Stripe.Subscription.Status; currentPeriodEnd: number | null }> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const currentItemId = sub.items.data[0]?.id;
  if (!currentItemId) {
    throw new Error("Could not find subscription item.");
  }
  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: currentItemId, price: newPriceId }],
    proration_behavior: "create_prorations",
  });
  return {
    status: updated.status,
    currentPeriodEnd: updated.items.data[0]?.current_period_end ?? null,
  };
}

/** Apply a 100%-off forever coupon so the account is free. */
export async function compSubscription(
  subscriptionId: string,
): Promise<{ compedAt: number; discountCode: string }> {
  const stripe = getStripe();
  const coupon = await stripe.coupons.create({
    duration: "forever",
    percent_off: 100,
  });
  await stripe.subscriptions.update(subscriptionId, {
    discounts: [{ coupon: coupon.id }],
  });
  return { compedAt: Date.now(), discountCode: coupon.id };
}
