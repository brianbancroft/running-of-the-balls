import { Hono } from "hono";
import { assertAdmin } from "./auth";
import { DISCLAIMER, googleSignInReady, readConfig } from "./config";
import { beginGoogleSignIn, clearSession, finishGoogleSignIn } from "./google-auth";
import { HttpError, isMissingSchema, isRecord } from "./http";
import { logError, logInfo } from "./log";
import { readSession } from "./session";
import {
  cancelHold,
  confirmDemoPurchase,
  holdBall,
  listBalls,
  listRecentSales,
  listSelectionsForEmail,
  purchaseBall,
  purchaseForReceiptToken,
  recordOfflineSale,
} from "./purchase-engine";
import {
  parseEmail,
  parseName,
  parseNote,
  parseOptionalBallId,
  parsePurchaseId,
  parseReceiptToken,
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
  const result = await purchaseBall(
    c.env.DB,
    {
      email: parseEmail(body.email),
      buyerName: parseName(body.buyerName),
      ballId: parseOptionalBallId(body.ballId),
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
  const result = await confirmDemoPurchase(c.env.DB, purchaseId, email, config, originOf(c));
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
  return c.json({ purchase });
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
  const result = await recordOfflineSale(
    c.env.DB,
    {
      email: parseEmail(body.email),
      buyerName: parseName(body.buyerName),
      ballId,
      note: parseNote(body.note),
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

function originOf(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
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
