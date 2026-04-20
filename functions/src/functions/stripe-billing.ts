import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { collections } from "../config/firestore";
import { requireAuth, requireOrg, requireRole } from "../middleware/auth";
import { UserRole } from "../types/user";
import { SubscriptionPlan, PLAN_CONFIG } from "../types/subscription";
import { getStripe, getOrCreateStripeCustomer, stripeSecretKey } from "../services/stripe";
import { DEMO_ORG_ID } from "../constants";

function blockDemoOrg(organizationId: string): void {
  if (organizationId === DEMO_ORG_ID) {
    throw new HttpsError("permission-denied", "Billing is disabled for demo accounts. Sign up for your own free trial!");
  }
}

export const createSubscription = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string; plan: string };

    if (!data.organizationId || !data.plan) {
      throw new HttpsError("invalid-argument", "organizationId and plan are required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const plan = data.plan as SubscriptionPlan;
    const planConfig = PLAN_CONFIG[plan];
    if (!planConfig || !planConfig.stripePriceId) {
      throw new HttpsError("invalid-argument", "Invalid plan. Contact us for Enterprise pricing.");
    }

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const org = orgDoc.data()!;

    // Check if already has active subscription
    if (org.stripe?.status === "active" || org.stripe?.status === "trialing") {
      throw new HttpsError(
        "already-exists",
        "Organization already has an active subscription. Use changePlan instead."
      );
    }

    const customerId = await getOrCreateStripeCustomer(
      data.organizationId,
      org.name,
      user.email
    );

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planConfig.stripePriceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      trial_period_days: 14,
      metadata: { organizationId: data.organizationId, plan },
      expand: ["latest_invoice.payment_intent"],
    });

    // Store subscription data
    await collections.organizations.doc(data.organizationId).update({
      "stripe.stripeSubscriptionId": subscription.id,
      "stripe.stripePriceId": planConfig.stripePriceId,
      "stripe.plan": plan,
      "stripe.status": subscription.status,
      "stripe.currentPeriodEnd": subscription.items.data[0]?.current_period_end ?? null,
      "stripe.trialEnd": subscription.trial_end,
      "stripe.cancelAtPeriodEnd": subscription.cancel_at_period_end,
      updatedAt: Timestamp.now(),
    });

    // Get client secret for frontend payment confirmation
    const invoice = subscription.latest_invoice;
    let clientSecret: string | null = null;
    if (invoice && typeof invoice !== "string") {
      clientSecret = invoice.confirmation_secret?.client_secret ?? null;
    }

    return {
      subscriptionId: subscription.id,
      clientSecret,
      status: subscription.status,
      trialEnd: subscription.trial_end,
    };
  }
);

export const getSubscriptionStatus = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }
    requireOrg(user, data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }

    const org = orgDoc.data()!;
    const stripeData = org.stripe;

    if (!stripeData) {
      return {
        hasSubscription: false,
        plan: null,
        status: null,
        currentPeriodEnd: null,
        trialEnd: null,
        trialDaysRemaining: null,
        cancelAtPeriodEnd: false,
        maxVehicles: 0,
        activeVehicles: 0,
      };
    }

    // Count active vehicles
    const vehiclesSnap = await collections.vehicles
      .where("organizationId", "==", data.organizationId)
      .count()
      .get();
    const activeVehicles = vehiclesSnap.data().count;

    const planConfig = stripeData.plan ? PLAN_CONFIG[stripeData.plan] : null;

    let trialDaysRemaining: number | null = null;
    if (stripeData.status === "trialing" && stripeData.trialEnd) {
      const now = Math.floor(Date.now() / 1000);
      trialDaysRemaining = Math.max(
        0,
        Math.ceil((stripeData.trialEnd - now) / 86400)
      );
    }

    return {
      hasSubscription: true,
      plan: stripeData.plan,
      planName: planConfig?.name ?? null,
      priceMonthly: planConfig?.priceMonthly ?? null,
      status: stripeData.status,
      currentPeriodEnd: stripeData.currentPeriodEnd ?? null,
      trialEnd: stripeData.trialEnd ?? null,
      trialDaysRemaining,
      cancelAtPeriodEnd: stripeData.cancelAtPeriodEnd ?? false,
      maxVehicles: planConfig?.maxVehicles ?? 0,
      activeVehicles,
    };
  }
);

export const changePlan = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string; newPlan: string };

    if (!data.organizationId || !data.newPlan) {
      throw new HttpsError("invalid-argument", "organizationId and newPlan are required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const newPlan = data.newPlan as SubscriptionPlan;
    const newPlanConfig = PLAN_CONFIG[newPlan];
    if (!newPlanConfig || !newPlanConfig.stripePriceId) {
      throw new HttpsError("invalid-argument", "Invalid plan. Contact us for Enterprise pricing.");
    }

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org?.stripe?.stripeSubscriptionId) {
      throw new HttpsError("failed-precondition", "No active subscription found.");
    }

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(org.stripe.stripeSubscriptionId);
    const currentItemId = subscription.items.data[0]?.id;
    if (!currentItemId) {
      throw new HttpsError("internal", "Could not find subscription item.");
    }

    const updated = await stripe.subscriptions.update(org.stripe.stripeSubscriptionId, {
      items: [{ id: currentItemId, price: newPlanConfig.stripePriceId }],
      proration_behavior: "create_prorations",
      metadata: { plan: newPlan },
    });

    await collections.organizations.doc(data.organizationId).update({
      "stripe.plan": newPlan,
      "stripe.stripePriceId": newPlanConfig.stripePriceId,
      "stripe.status": updated.status,
      "stripe.currentPeriodEnd": updated.items.data[0]?.current_period_end ?? null,
      updatedAt: Timestamp.now(),
    });

    return { success: true, plan: newPlan, status: updated.status };
  }
);

export const cancelSubscription = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org?.stripe?.stripeSubscriptionId) {
      throw new HttpsError("failed-precondition", "No active subscription found.");
    }

    const stripe = getStripe();
    await stripe.subscriptions.update(org.stripe.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await collections.organizations.doc(data.organizationId).update({
      "stripe.cancelAtPeriodEnd": true,
      updatedAt: Timestamp.now(),
    });

    return { success: true };
  }
);

export const resumeSubscription = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org?.stripe?.stripeSubscriptionId) {
      throw new HttpsError("failed-precondition", "No active subscription found.");
    }

    const stripe = getStripe();
    await stripe.subscriptions.update(org.stripe.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await collections.organizations.doc(data.organizationId).update({
      "stripe.cancelAtPeriodEnd": false,
      updatedAt: Timestamp.now(),
    });

    return { success: true };
  }
);

export const createBillingPortalSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string; returnUrl: string };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org) {
      throw new HttpsError("not-found", "Organization not found.");
    }

    // Create Stripe customer on-demand if one doesn't exist yet
    const customerId = await getOrCreateStripeCustomer(
      data.organizationId,
      org.name,
      user.email
    );

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: data.returnUrl || "https://app.autolientracker.com",
    });

    return { url: session.url };
  }
);

export const getBillingHistory = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as { organizationId: string; limit?: number };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    requireOrg(user, data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org?.stripe?.stripeCustomerId) {
      return { invoices: [] };
    }

    const stripe = getStripe();
    const invoices = await stripe.invoices.list({
      customer: org.stripe.stripeCustomerId,
      limit: Math.min(data.limit ?? 24, 100),
    });

    return {
      invoices: invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        created: inv.created,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        description: inv.lines.data[0]?.description ?? null,
      })),
    };
  }
);

/**
 * Creates an embedded Stripe Checkout Session.
 * - For new subscriptions: mode=subscription with trial
 * - For adding payment method to existing sub: mode=setup
 */
export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { user } = await requireAuth(request);
    const data = request.data as {
      organizationId: string;
      plan?: string;
      mode: "subscription" | "setup";
    };

    if (!data.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required.");
    }

    requireOrg(user, data.organizationId);
    requireRole(user, UserRole.ADMIN);
    blockDemoOrg(data.organizationId);

    const orgDoc = await collections.organizations.doc(data.organizationId).get();
    const org = orgDoc.data();
    if (!org) {
      throw new HttpsError("not-found", "Organization not found.");
    }

    const customerId = await getOrCreateStripeCustomer(
      data.organizationId,
      org.name,
      user.email
    );

    const stripe = getStripe();
    const returnUrl = "https://app.autolientracker.com?checkout=complete";

    if (data.mode === "setup") {
      // Adding a payment method to an existing subscription
      const session = await stripe.checkout.sessions.create({
        ui_mode: "embedded",
        mode: "setup",
        customer: customerId,
        currency: "usd",
        return_url: returnUrl,
      });

      return { clientSecret: session.client_secret };
    }

    // New subscription checkout
    if (!data.plan) {
      throw new HttpsError("invalid-argument", "plan is required for subscription checkout.");
    }

    const plan = data.plan as SubscriptionPlan;
    const planConfig = PLAN_CONFIG[plan];
    if (!planConfig || !planConfig.stripePriceId) {
      throw new HttpsError("invalid-argument", "Invalid plan.");
    }

    // Don't allow if already has active subscription
    if (org.stripe?.status === "active" || org.stripe?.status === "trialing") {
      throw new HttpsError(
        "already-exists",
        "Already subscribed. Use Change Plan to switch plans."
      );
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: planConfig.stripePriceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { organizationId: data.organizationId, plan },
      },
      return_url: returnUrl,
    });

    return { clientSecret: session.client_secret };
  }
);
