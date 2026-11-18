import { Router } from "express";
import Stripe from "stripe";
import { col, isPremium, usersById, userIdFilter } from "../db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { HttpError } from "../utils.js";

let stripeClient;
const stripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(500, "Payments are not configured");
  return (stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY));
};
const clientUrl = () => (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");

const periodEnd = (sub) => {
  const ts = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : new Date(Date.now() + 31 * 24 * 3600 * 1000);
};

async function setPremium(vendorId, expiresAt) {
  await (await col("users")).updateOne(userIdFilter(vendorId), {
    $set: { subscriptionPlan: "premium", subscriptionExpiresAt: expiresAt, updatedAt: new Date() },
  });
}

async function downgrade(vendorId) {
  await (await col("users")).updateOne(userIdFilter(vendorId), {
    $set: { subscriptionPlan: "free", subscriptionExpiresAt: null, updatedAt: new Date() },
  });
}

async function vendorIdForSubscription(subscriptionId) {
  const tx = await (await col("transactions")).findOne({ stripeSubscriptionId: subscriptionId });
  return tx?.vendorId;
}

// ---------- Authenticated vendor endpoints ----------
export const router = Router();

router.post("/checkout", authenticate, requireRole("vendor"), async (req, res) => {
  // The vendor is always taken from the verified token, never from the request body
  const user = (await usersById([req.user.id])).get(req.user.id);
  if (isPremium(user)) throw new HttpError(409, "You already have an active Premium plan");

  const price = Number(process.env.PREMIUM_PRICE_USD || 19);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: req.user.email,
    client_reference_id: req.user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(price * 100),
          recurring: { interval: "month" },
          product_data: {
            name: "WedPlan Premium Vendor",
            description: "Unlimited active services and the Premium Vendor badge",
          },
        },
      },
    ],
    metadata: { vendorId: req.user.id },
    subscription_data: { metadata: { vendorId: req.user.id } },
    success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl()}/payment/cancel`,
  });

  await (await col("transactions")).insertOne({
    vendorId: req.user.id,
    plan: "premium",
    amount: price,
    currency: "usd",
    stripeSessionId: session.id,
    stripeSubscriptionId: null,
    status: "pending",
    createdAt: new Date(),
  });
  res.status(201).json({ url: session.url });
});

// Read-only status for the success page. It never activates anything.
router.get("/status", authenticate, requireRole("vendor"), async (req, res) => {
  const tx = await (await col("transactions")).findOne({
    stripeSessionId: String(req.query.session_id || ""),
    vendorId: req.user.id,
  });
  if (!tx) throw new HttpError(404, "Transaction not found");
  res.json({ status: tx.status, amount: tx.amount, currency: tx.currency, plan: tx.plan });
});

router.post("/cancel-subscription", authenticate, requireRole("vendor"), async (req, res) => {
  const tx = await (await col("transactions")).findOne(
    { vendorId: req.user.id, status: "paid", stripeSubscriptionId: { $ne: null } },
    { sort: { createdAt: -1 } }
  );
  if (!tx) throw new HttpError(404, "No active subscription found");
  await stripe().subscriptions.update(tx.stripeSubscriptionId, { cancel_at_period_end: true });
  res.json({ message: "Subscription will end at the close of the current billing period" });
});

// ---------- Stripe webhook (mounted with the raw body parser in index.js) ----------
export async function webhookHandler(req, res) {
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return res.status(400).send("Webhook signature verification failed");
  }

  const T = await col("transactions");
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (obj.payment_status !== "paid") break;
      const vendorId = obj.metadata?.vendorId || obj.client_reference_id;
      if (!vendorId) break;
      const sub = obj.subscription ? await stripe().subscriptions.retrieve(obj.subscription) : null;
      await T.updateOne(
        { stripeSessionId: obj.id },
        {
          $set: {
            vendorId,
            plan: "premium",
            amount: (obj.amount_total ?? 0) / 100,
            currency: obj.currency || "usd",
            stripeSubscriptionId: obj.subscription || null,
            status: "paid",
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      await setPremium(vendorId, periodEnd(sub));
      break;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await T.updateOne({ stripeSessionId: obj.id, status: "pending" }, { $set: { status: "failed" } });
      break;

    case "invoice.paid": {
      // Renewals only; the first invoice is handled by checkout.session.completed
      if (obj.billing_reason !== "subscription_cycle") break;
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      const vendorId = subId && (await vendorIdForSubscription(subId));
      if (!vendorId) break;
      const sub = await stripe().subscriptions.retrieve(subId);
      await T.updateOne(
        { stripeSessionId: `invoice_${obj.id}` },
        {
          $setOnInsert: {
            vendorId,
            plan: "premium",
            amount: (obj.amount_paid ?? 0) / 100,
            currency: obj.currency || "usd",
            stripeSubscriptionId: subId,
            status: "paid",
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      await setPremium(vendorId, periodEnd(sub));
      break;
    }
    case "customer.subscription.deleted": {
      const vendorId = obj.metadata?.vendorId || (await vendorIdForSubscription(obj.id));
      if (vendorId) await downgrade(vendorId);
      break;
    }
  }
  res.json({ received: true });
}

export default router;
