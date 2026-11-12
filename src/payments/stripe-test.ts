export type DemoPayment = {
  mode: "stripe_test_fake";
  charged: false;
  stripeTestReference: string;
};

/**
 * Fake test-mode payment marker.
 *
 * This module never calls Stripe and never creates a Checkout Session, PaymentIntent,
 * or charge. A live secret (`sk_live_` / `rk_live_`) is refused before a purchase
 * can be confirmed. An `sk_test_` value, including the placeholder in
 * `.dev.vars.example`, is ignored. The returned reference is a local id so the
 * purchases table can show what a future test-mode integration would store.
 */
export function liveStripeKeyReason(stripeSecretKey: string | undefined): string | null {
  const key = stripeSecretKey?.trim() ?? "";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_") || key.startsWith("pk_live_")) {
    return "Refusing a live Stripe key. This demo does not charge cards.";
  }
  if (key.length > 0 && !key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    return "Refusing an unrecognized Stripe key. Only a test placeholder is accepted, and it is not sent to Stripe.";
  }
  return null;
}

export function buildDemoPayment(input: {
  paymentMode: string;
  stripeSecretKey: string | undefined;
  purchaseId: string;
}): DemoPayment {
  if (input.paymentMode !== "stripe_test_fake") {
    throw new Error(
      "Refusing to confirm a purchase. PAYMENT_MODE must stay stripe_test_fake. This demo does not take payment.",
    );
  }

  const blocked = liveStripeKeyReason(input.stripeSecretKey);
  if (blocked) throw new Error(blocked);

  return {
    mode: "stripe_test_fake",
    charged: false,
    stripeTestReference: `cs_test_fake_${input.purchaseId}`,
  };
}
