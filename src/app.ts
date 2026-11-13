import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { assertAdmin } from "./auth";
import { ADMIN_ATTESTATION_TEXT, BUYER_ATTESTATION_TEXT } from "./compliance";
import { DISCLAIMER, googleSignInReady, readConfig } from "./config";
import { dispatchesCsv, purchasesCsv, selectionsCsv } from "./exports";
import { beginGoogleSignIn, clearSession, finishGoogleSignIn } from "./google-auth";
import { HttpError, isMissingSchema, isRecord } from "./http";
import { logError, logInfo } from "./log";
import {
  RESERVATION_COOKIE,
  checkoutReservation,
  expireDueHolds,
  holdForSession,
  releaseForSession,
  reservationForSession,
} from "./reservations";
import { readSession } from "./session";
import {
  cancelHold,
  confirmDemoPurchase,
  holdBall,
  listBalls,
  listRecentSales,
  listSelectionsForEmail,
  purchaseBall,
  purchaseForBuyer,
  purchaseForReceiptToken,
  recordOfflineSale,
  voidConfirmedSale,
} from "./purchase-engine";
import {
  parseAttestation,
  parseEmail,
  parseName,
  parseNote,
  parseBallIdList,
  parseOptionalBallId,
  parsePurchaseId,
  parseReceiptToken,
  parseSessionCookie,
  parseVoidReason,
} from "./validation";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", async (c, next) => {
  const started = Date.now();
  try {
    await next();
  } finally {
    logInfo({
      message: "request",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - started,
    });
  }
});

app.use("/api/*", async (c, next) => {
  if (c.req.path !== "/api/health") await expireDueHolds(c.env.DB);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
});

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    demo: true,
    paymentMode: c.env.PAYMENT_MODE,
    emailDelivery: c.env.EMAIL_DELIVERY,
  });
});

app.get("/api/config", (c) => {
  const config = readConfig(c.env);
  return c.json({
    appName: config.appName,
    demoMode: config.demoMode,
    allowBallPicking: config.allowBallPicking,
    paymentMode: config.paymentMode,
    emailDelivery: config.emailDelivery,
    amountCents: config.amountCents,
    currency: config.currency,
    charged: false,
    offlineSalesConfigured: Boolean(config.adminToken) || config.adminEmails.length > 0,
    googleSignIn: googleSignInReady(config),
    paymentsBlocked: Boolean(config.paymentsBlockedReason),
    gamingLicenceNumber: config.gamingLicenceNumber,
    rulesUrl: config.rulesUrl,
    licensed: config.licensed,
    licenceStatus: config.licenceStatus,
    disclaimer: DISCLAIMER,
  });
});

app.get("/api/auth/session", async (c) => {
  const config = readConfig(c.env);
  const session = await readSession(config, c.req.header("cookie"));
  return c.json({
    signedIn: Boolean(session),
    email: session?.email ?? null,
    name: session?.name ?? null,
    admin: Boolean(session && config.adminEmails.includes(session.email)),
    googleSignIn: googleSignInReady(config),
  });
});

app.get("/api/auth/google", (c) => beginGoogleSignIn(c));

app.get("/api/auth/google/callback", (c) => finishGoogleSignIn(c));

app.post("/api/auth/logout", (c) => {
  clearSession(c);
  return c.json({ signedIn: false });
});

app.get("/api/balls", async (c) => {
  const balls = await listBalls(c.env.DB);
  return c.json({ balls });
});

app.get("/api/reservations", async (c) => {
  const view = await reservationForSession(c.env.DB, reservationId(c));
  return c.json(view);
});

app.post("/api/reservations", async (c) => {
  const body = await readJsonObject(c);
  const ballId = parseOptionalBallId(body.ballId);
  if (ballId == null) throw new HttpError(400, "Choose a ball.");
  const held = await holdForSession(c.env.DB, reservationId(c), ballId);
  if (held.session) writeReservationCookie(c, held.session.id);
  logInfo({ message: "ball reserved", ballId, charged: false });
  return c.json(held, 201);
});

app.post("/api/reservations/release", async (c) => {
  const body = await readJsonObject(c);
  const ballId = parseOptionalBallId(body.ballId);
  if (ballId == null) throw new HttpError(400, "Choose a ball.");
  const view = await releaseForSession(c.env.DB, reservationId(c), ballId);
  if (view.session) writeReservationCookie(c, view.session.id);
  logInfo({ message: "reservation released", ballId });
  return c.json(view);
});

app.post("/api/reservations/checkout", async (c) => {
  const config = readConfig(c.env);
  const body = await readJsonObject(c);
  parseAttestation(body);
  const result = await checkoutReservation(
    c.env.DB,
    reservationId(c),
    {
      email: parseEmail(body.email),
      buyerName: parseName(body.buyerName),
      ballIds: parseBallIdList(body.ballIds),
      attestation: { by: "buyer", text: BUYER_ATTESTATION_TEXT },
    },
    config,
    originOf(c),
  );
  logInfo({
    message: "reservation checked out",
    balls: result.purchases.length,
    released: result.released.length,
    charged: false,
  });
  return c.json(result, 201);
});

app.post("/api/selections", async (c) => {
  const config = readConfig(c.env);
  const body = await readJsonObject(c);
  const purchase = await holdBall(
    c.env.DB,
    {
      email: parseEmail(body.email),
      buyerName: parseName(body.buyerName),
      ballId: parseOptionalBallId(body.ballId),
    },
    config,
  );
  logInfo({
    message: "ball held",
    purchaseId: purchase.id,
    ballId: purchase.ball.id,
    charged: false,
  });
  return c.json({ purchase }, 201);
});

app.post("/api/purchases", async (c) => {
  const config = readConfig(c.env);
  const body = await readJsonObject(c);
  const email = parseEmail(body.email);
  parseAttestation(body);
  const result = await purchaseBall(
    c.env.DB,
    {
      email,
      buyerName: parseName(body.buyerName),
      ballId: parseOptionalBallId(body.ballId),
      attestation: { by: "buyer", text: BUYER_ATTESTATION_TEXT },
    },
    config,
    originOf(c),
  );
  logInfo({
    message: "demo ball purchased",
    purchaseId: result.purchase.id,
    ballId: result.purchase.ball.id,
    charged: false,
    emailSent: result.email.sent,
  });
  return c.json(result, 201);
});

app.post("/api/purchases/:id/confirm-demo", async (c) => {
  const config = readConfig(c.env);
  const purchaseId = parsePurchaseId(c.req.param("id"));
  const body = await readJsonObject(c);
  const email = parseEmail(body.email);
  parseAttestation(body);
  const result = await confirmDemoPurchase(
    c.env.DB,
    purchaseId,
    email,
    { by: "buyer", text: BUYER_ATTESTATION_TEXT },
    config,
    originOf(c),
  );
  logInfo({
    message: "demo purchase confirmed",
    purchaseId,
    ballId: result.purchase.ball.id,
    charged: false,
    emailDelivery: result.email.mode,
    emailSent: result.email.sent,
  });
  return c.json(result);
});

app.post("/api/purchases/:id/cancel", async (c) => {
  const purchaseId = parsePurchaseId(c.req.param("id"));
  const body = await readJsonObject(c);
  const purchase = await cancelHold(c.env.DB, purchaseId, parseEmail(body.email));
  logInfo({ message: "hold cancelled", purchaseId, ballId: purchase.ball.id });
  return c.json({ purchase });
});

app.get("/api/purchases", async (c) => {
  const token = parseReceiptToken(c.req.query("token"));
  const purchase = await purchaseForReceiptToken(c.env.DB, token);
  if (!purchase) throw new HttpError(404, "That receipt link was not found.");
  return c.json({ purchase: purchaseForBuyer(purchase) });
});

app.get("/api/selections", async (c) => {
  await assertAdmin(readConfig(c.env), c.req.header("authorization"), c.req.header("cookie"));
  return selectionsForAdmin(c);
});

app.use("/api/admin/*", async (c, next) => {
  await assertAdmin(readConfig(c.env), c.req.header("authorization"), c.req.header("cookie"));
  await next();
});

app.post("/api/admin/offline-sales", async (c) => {
  const config = readConfig(c.env);
  const body = await readJsonObject(c);
  const ballId = parseOptionalBallId(body.ballId);
  if (ballId == null) throw new HttpError(400, "Choose a ball.");
  const email = parseEmail(body.email);
  parseAttestation(body);
  const result = await recordOfflineSale(
    c.env.DB,
    {
      email,
      buyerName: parseName(body.buyerName),
      ballId,
      note: parseNote(body.note),
      attestation: { by: "admin", text: ADMIN_ATTESTATION_TEXT },
    },
    config,
    originOf(c),
  );
  logInfo({
    message: "offline demo sale recorded",
    purchaseId: result.purchase.id,
    ballId: result.purchase.ball.id,
    charged: false,
    emailSent: result.email.sent,
  });
  return c.json(result, 201);
});

app.get("/api/admin/sales", async (c) => {
  const purchases = await listRecentSales(c.env.DB);
  return c.json({ purchases });
});

app.post("/api/admin/purchases/:id/void", async (c) => {
  const purchaseId = parsePurchaseId(c.req.param("id"));
  const body = await readJsonObject(c);
  const reason = parseVoidReason(body.reason);
  const admin = await assertAdmin(readConfig(c.env), c.req.header("authorization"), c.req.header("cookie"));
  const purchase = await voidConfirmedSale(c.env.DB, purchaseId, reason, admin.by);
  logInfo({
    message: "demo sale voided",
    purchaseId,
    ballId: purchase.ball.id,
    charged: false,
  });
  return c.json({ purchase });
});

app.get("/api/admin/exports/purchases.csv", async (c) => {
  return csvDownload(c, "purchases.csv", await purchasesCsv(c.env.DB));
});

app.get("/api/admin/exports/ball-selections.csv", async (c) => {
  return csvDownload(c, "ball-selections.csv", await selectionsCsv(c.env.DB));
});

app.get("/api/admin/exports/email-dispatches.csv", async (c) => {
  return csvDownload(c, "email-dispatches.csv", await dispatchesCsv(c.env.DB));
});

app.get("/api/admin/selections", async (c) => selectionsForAdmin(c));

app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/") || (c.req.method !== "GET" && c.req.method !== "HEAD")) {
    return c.json({ error: "Not found" }, 404);
  }
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
});

app.onError((error, c) => {
  if (isMissingSchema(error)) {
    logError({ message: "database schema missing", error: error.message });
    return c.json(
      { error: "Local database is not migrated. Run npm run d1:migrate:local." },
      503,
    );
  }
  if (error instanceof HttpError) {
    logError({ message: "request rejected", status: error.status, error: error.message });
    return c.json({ error: error.message }, error.status);
  }
  logError({
    message: "request failed",
    error: error instanceof Error ? error.message : "unknown",
  });
  return c.json({ error: "Something went wrong." }, 500);
});

function csvDownload(
  c: { header: (name: string, value: string) => void; body: (data: string) => Response },
  filename: string,
  csv: string,
): Response {
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${filename}"`);
  return c.body(csv);
}

function originOf(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function reservationId(c: Context<{ Bindings: CloudflareBindings }>): string | null {
  return parseSessionCookie(getCookie(c, RESERVATION_COOKIE));
}

function writeReservationCookie(c: Context<{ Bindings: CloudflareBindings }>, sessionId: string): void {
  setCookie(c, RESERVATION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 60 * 30,
  });
}

async function selectionsForAdmin(c: {
  req: { query: (name: string) => string | undefined };
  env: CloudflareBindings;
  json: (body: unknown) => Response;
}): Promise<Response> {
  const email = parseEmail(c.req.query("email"));
  const selections = await listSelectionsForEmail(c.env.DB, email);
  return c.json({ email, selections });
}

async function readJsonObject(c: {
  req: { header: (name: string) => string | undefined; json: () => Promise<unknown> };
}): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 20_000) {
    throw new HttpError(413, "Body is too large.");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
  if (!isRecord(body)) throw new HttpError(400, "Expected a JSON object.");
  return body;
}

export default app;
