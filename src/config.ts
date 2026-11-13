import { licenceNotice } from "./compliance";
import { HttpError, isRecord } from "./http";
import { liveStripeKeyReason } from "./payments/stripe-test";
import { parseEmail } from "./validation";

// Open product decisions. The owner has not confirmed these. The values below
// are safe demo defaults from wrangler vars. The pages keep a "pending a
// decision" label until a later change removes it. Do not treat a default as
// the club's numbering, ticket price, bundle, or pick-versus-assign rule.
//
// Confirmed, and not configured here: 2,500 balls in the catalogue, no cap on
// how many balls one checkout may buy, and the beneficiary sentence (a
// fundraiser for the Kinsmen Club of Ladysmith for an upcoming infrastructure
// project). The ball count is the rows in `balls`, not a var.

export type BallNumbering = "sequential_from_1";
export type BallAssignment = "buyer_picks" | "assigned";

export type BallBundle = {
  quantity: number;
  label: string;
};

export const DISCLAIMER =
  "Demonstration only. Nothing is charged. This is not a licensed gaming event and it does not sell entries or run a draw.";

export type AppConfig = {
  demoMode: true;
  allowBallPicking: boolean;
  assignment: BallAssignment;
  numbering: BallNumbering;
  numberPad: number;
  bundles: BallBundle[];
  // Stays true while numbering, price, bundles, and assignment are unconfirmed.
  decisionsPending: true;
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
  gamingLicenceNumber: string | null;
  rulesUrl: string;
  licensed: boolean;
  licenceStatus: string;
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
  const numbering = readNumbering(env.BALL_NUMBERING);
  const numberPad = readNumberPad(env.BALL_NUMBER_PAD);
  const bundles = parseBundles(env.BALL_BUNDLES);
  const allowBallPicking = env.ALLOW_BALL_PICKING === "true";

  if (!/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(env.EMAIL_FROM)) {
    throw new HttpError(500, "EMAIL_FROM must look like Name <email@domain>.");
  }

  const stripeSecretKey = blank(env.STRIPE_SECRET_KEY);
  const gamingLicenceNumber = readLicenceNumber(env.GAMING_LICENCE_NUMBER);
  const rulesUrl = readRulesUrl(env.GAMING_RULES_URL);

  return {
    demoMode: true,
    allowBallPicking,
    assignment: allowBallPicking ? "buyer_picks" : "assigned",
    numbering,
    numberPad,
    bundles,
    decisionsPending: true,
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
    gamingLicenceNumber,
    rulesUrl,
    licensed: gamingLicenceNumber !== null,
    licenceStatus: licenceNotice(gamingLicenceNumber),
  };
}

function readNumbering(value: string | undefined): BallNumbering {
  if (value?.trim() === "sequential_from_1") return "sequential_from_1";
  throw new HttpError(
    500,
    "BALL_NUMBERING must be sequential_from_1 until the club decides otherwise. No other scheme is implemented.",
  );
}

function readNumberPad(value: string | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) {
    throw new HttpError(500, "BALL_NUMBER_PAD must be a whole number from 0 to 6.");
  }
  const pad = Number(trimmed);
  if (!Number.isInteger(pad) || pad > 6) {
    throw new HttpError(500, "BALL_NUMBER_PAD must be a whole number from 0 to 6.");
  }
  return pad;
}

const BUNDLE_KEYS = new Set(["quantity", "label"]);

export function parseBundles(value: string | undefined): BallBundle[] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "[]") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new HttpError(500, "BALL_BUNDLES must be a JSON list of bundles, or empty.");
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new HttpError(500, "BALL_BUNDLES must be a JSON list of at most 8 bundles.");
  }
  const bundles: BallBundle[] = [];
  const seen = new Set<number>();
  for (const item of parsed) {
    if (!isRecord(item)) throw new HttpError(500, "BALL_BUNDLES entries must be objects with a quantity and a label.");
    for (const key of Object.keys(item)) {
      if (!BUNDLE_KEYS.has(key)) {
        throw new HttpError(
          500,
          "BALL_BUNDLES cannot set a price. A bundle is a quantity at the placeholder unit price.",
        );
      }
    }
    const { quantity, label } = item;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 2 || quantity > 2500) {
      throw new HttpError(500, "BALL_BUNDLES quantity must be a whole number from 2 to 2500.");
    }
    if (typeof label !== "string") throw new HttpError(500, "BALL_BUNDLES label must be text.");
    const text = label.replace(/[\r\n\t]+/g, " ").trim();
    if (text.length < 1 || text.length > 40 || /[\u0000-\u001f<>]/.test(text)) {
      throw new HttpError(500, "BALL_BUNDLES label must be 40 characters or fewer.");
    }
    if (seen.has(quantity)) throw new HttpError(500, "BALL_BUNDLES quantities must be unique.");
    seen.add(quantity);
    bundles.push({ quantity, label: text });
  }
  bundles.sort((left, right) => left.quantity - right.quantity);
  return bundles;
}

function readLicenceNumber(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > 80 || /[\u0000-\u001f<>"'`]/.test(trimmed)) {
    throw new HttpError(500, "GAMING_LICENCE_NUMBER is not a displayable licence number.");
  }
  return trimmed;
}

function readRulesUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "/rules";
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    trimmed.length <= 200 &&
    !/[\s<>"']/.test(trimmed)
  ) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(500, "GAMING_RULES_URL must be empty, a site path, or an https URL.");
  }
  if (url.protocol !== "https:" || url.hostname.length === 0 || trimmed.length > 500) {
    throw new HttpError(500, "GAMING_RULES_URL must be empty, a site path, or an https URL.");
  }
  return url.toString();
}

export function assertPaymentsAllowed(config: AppConfig): void {
  if (config.paymentsBlockedReason) {
    throw new HttpError(403, config.paymentsBlockedReason);
  }
}
