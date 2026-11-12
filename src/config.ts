import { HttpError } from "./http";
import { liveStripeKeyReason } from "./payments/stripe-test";
import { parseEmail } from "./validation";

export const DISCLAIMER =
  "Demonstration only. Nothing is charged. This is not a licensed gaming event and it does not sell entries or run a draw.";

export type AppConfig = {
  demoMode: true;
  allowBallPicking: boolean;
  emailDelivery: "dry_run" | "resend";
  paymentMode: "stripe_test_fake";
  amountCents: number;
  currency: "CAD";
  emailFrom: string;
  appName: string;
  resendApiKey: string | undefined;
  stripeSecretKey: string | undefined;
  adminToken: string | undefined;
  adminEmails: string[];
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  sessionSecret: string | undefined;
  paymentsBlockedReason: string | null;
};

export function parseAdminEmails(value: string | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    try {
      seen.add(parseEmail(part));
    } catch {
      // Blank or malformed entries grant nothing. An empty list means no Google admin.
    }
  }
  return [...seen];
}

export function googleSignInReady(config: AppConfig): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret && config.sessionSecret);
}

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readConfig(env: CloudflareBindings): AppConfig {
  if (env.DEMO_MODE !== "true") {
    throw new HttpError(403, "This demo only runs with DEMO_MODE=true.");
  }
  if (env.PAYMENT_MODE !== "stripe_test_fake") {
    throw new HttpError(
      403,
      "PAYMENT_MODE must stay stripe_test_fake. This demo does not take payment.",
    );
  }

  const delivery = String(env.EMAIL_DELIVERY);
  if (delivery !== "dry_run" && delivery !== "resend") {
    throw new HttpError(500, "EMAIL_DELIVERY must be dry_run or resend.");
  }

  const amountCents = Number(env.DEMO_AMOUNT_CENTS);
  if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > 100_000) {
    throw new HttpError(500, "DEMO_AMOUNT_CENTS is not a valid demonstration amount.");
  }

  if (!/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(env.EMAIL_FROM)) {
    throw new HttpError(500, "EMAIL_FROM must look like Name <email@domain>.");
  }

  const stripeSecretKey = blank(env.STRIPE_SECRET_KEY);

  return {
    demoMode: true,
    allowBallPicking: env.ALLOW_BALL_PICKING === "true",
    emailDelivery: delivery,
    paymentMode: "stripe_test_fake",
    amountCents,
    currency: "CAD",
    emailFrom: env.EMAIL_FROM,
    appName: env.PUBLIC_APP_NAME,
    resendApiKey: blank(env.RESEND_API_KEY),
    stripeSecretKey,
    adminToken: blank(env.ADMIN_TOKEN),
    adminEmails: parseAdminEmails(env.ADMIN_EMAILS),
    googleClientId: blank(env.GOOGLE_CLIENT_ID),
    googleClientSecret: blank(env.GOOGLE_CLIENT_SECRET),
    sessionSecret: blank(env.SESSION_SECRET),
    paymentsBlockedReason: liveStripeKeyReason(stripeSecretKey),
  };
}

export function assertPaymentsAllowed(config: AppConfig): void {
  if (config.paymentsBlockedReason) {
    throw new HttpError(403, config.paymentsBlockedReason);
  }
}
