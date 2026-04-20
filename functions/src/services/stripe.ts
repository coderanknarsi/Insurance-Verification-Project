import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";
import { collections } from "../config/firestore";
import { Timestamp } from "firebase-admin/firestore";

export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = stripeSecretKey.value().trim();
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeInstance = new Stripe(key, { apiVersion: "2026-02-25.clover" });
  }
  return stripeInstance;
}

export async function getOrCreateStripeCustomer(
  organizationId: string,
  orgName: string,
  email: string
): Promise<string> {
  const orgSnap = await collections.organizations.doc(organizationId).get();
  const orgData = orgSnap.data();
  const existingCustomerId = orgData?.stripe?.stripeCustomerId;

  if (existingCustomerId) {
    return existingCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: orgName,
    metadata: { organizationId },
  });

  await collections.organizations.doc(organizationId).update({
    "stripe.stripeCustomerId": customer.id,
    updatedAt: Timestamp.now(),
  });

  return customer.id;
}
