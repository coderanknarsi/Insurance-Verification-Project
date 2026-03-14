import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { getStripe, stripeSecretKey, stripeWebhookSecret } from "../services/stripe";
import { getPlanByPriceId } from "../types/subscription";
import type { StripeSubscriptionStatus } from "../types/subscription";
import type Stripe from "stripe";

export const stripeWebhook = onRequest(
  {
    secrets: [stripeSecretKey, stripeWebhookSecret],
    cors: false,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Webhook signature verification failed:", message);
      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionChange(subscription);
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(subscription);
          break;
        }
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoicePaid(invoice);
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          await handlePaymentFailed(invoice);
          break;
        }
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("Error processing webhook event:", err);
      res.status(500).send("Webhook processing error");
    }
  }
);

async function findOrgByCustomerId(customerId: string): Promise<string | null> {
  const snapshot = await collections.organizations
    .where("stripe.stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const orgId =
    subscription.metadata?.organizationId ||
    (await findOrgByCustomerId(customerId));

  if (!orgId) {
    console.error("No organization found for customer:", customerId);
    return;
  }

  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceId ? getPlanByPriceId(priceId) : null;

  const updateData: Record<string, unknown> = {
    "stripe.stripeCustomerId": customerId,
    "stripe.stripeSubscriptionId": subscription.id,
    "stripe.status": subscription.status as StripeSubscriptionStatus,
    "stripe.currentPeriodEnd": subscription.items.data[0]?.current_period_end ?? null,
    "stripe.trialEnd": subscription.trial_end,
    "stripe.cancelAtPeriodEnd": subscription.cancel_at_period_end,
    updatedAt: Timestamp.now(),
  };

  if (priceId) updateData["stripe.stripePriceId"] = priceId;
  if (plan) updateData["stripe.plan"] = plan;

  await collections.organizations.doc(orgId).update(updateData);
  console.log(`Subscription ${subscription.status} for org ${orgId}, plan: ${plan}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const orgId =
    subscription.metadata?.organizationId ||
    (await findOrgByCustomerId(customerId));

  if (!orgId) {
    console.error("No organization found for customer:", customerId);
    return;
  }

  await collections.organizations.doc(orgId).update({
    "stripe.status": "canceled",
    "stripe.cancelAtPeriodEnd": false,
    updatedAt: Timestamp.now(),
  });

  console.log(`Subscription canceled for org ${orgId}`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;

  if (!customerId) return;

  const orgId = await findOrgByCustomerId(customerId);
  if (!orgId) return;

  // Update period end from the subscription
  const subRef = invoice.parent?.subscription_details?.subscription;
  if (subRef) {
    const subId =
      typeof subRef === "string"
        ? subRef
        : subRef.id;

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);

    await collections.organizations.doc(orgId).update({
      "stripe.status": "active",
      "stripe.currentPeriodEnd": sub.items.data[0]?.current_period_end ?? null,
      updatedAt: Timestamp.now(),
    });
  }

  console.log(`Invoice paid for org ${orgId}, amount: ${invoice.amount_paid}`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;

  if (!customerId) return;

  const orgId = await findOrgByCustomerId(customerId);
  if (!orgId) return;

  await collections.organizations.doc(orgId).update({
    "stripe.status": "past_due",
    updatedAt: Timestamp.now(),
  });

  console.log(`Payment failed for org ${orgId}`);
}
