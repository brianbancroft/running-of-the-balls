import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseAdminEmails, readConfig } from "../src/config";
import { SESSION_COOKIE, signSession } from "../src/session";
import { buildSelectionReceipt } from "../src/email/receipt";
import { planEmailDelivery, sendSelectionReceipt } from "../src/email/deliver";
import worker from "../src/index";
import { buildDemoPayment } from "../src/payments/stripe-test";
import { purchaseBall } from "../src/purchase-engine";

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return call(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function callAs(
  path: string,
  init: RequestInit | undefined,
  patch: Partial<CloudflareBindings>,
): Promise<Response> {
  const bindings = Object.create(env) as CloudflareBindings;
  Object.assign(bindings, patch);
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Running of the Balls demo", () => {
  it("reports demo config and does not leak secrets", async () => {
    const response = await call("/api/config");
    expect(response.status).toBe(200);
    const body = await response.json<{
      demoMode: boolean;
      paymentMode: string;
      emailDelivery: string;
      charged: boolean;
      allowBallPicking: boolean;
    }>();
    expect(body.demoMode).toBe(true);
    expect(body.paymentMode).toBe("stripe_test_fake");
    expect(body.emailDelivery).toBe("dry_run");
    expect(body.charged).toBe(false);
    expect(body.allowBallPicking).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk_");
    expect(JSON.stringify(body)).not.toContain("test-admin-token");
  });

  it("lists balls without buyer emails and shades seeded states", async () => {
    const response = await call("/api/balls");
    const body = await response.json<{
      balls: Array<{ ballNumber: number; status: string }>;
    }>();
    expect(body.balls).toHaveLength(1000);
    expect(JSON.stringify(body)).not.toContain("@");
    expect(body.balls.find((ball) => ball.ballNumber === 3)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 6)?.status).toBe("selected");
    expect(body.balls.find((ball) => ball.ballNumber === 40)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 1)?.status).toBe("available");
  });

  it("buys a specific ball once, locks it, and stores the receipt without sending", async () => {
    const bought = await post("/api/purchases", {
      email: "Buyer.Buy@example.com",
      buyerName: "Ada",
      ballId: 9,
    });
    expect(bought.status).toBe(201);
    const body = await bought.json<{
      purchase: {
        status: string;
        charged: boolean;
        paymentMode: string;
        stripeTestReference: string;
        buyerEmail: string;
        ball: { id: number; status: string };
        emailRecord: { subject: string; sent: boolean; mode: string } | null;
      };
      email: { sent: boolean; mode: string; preview: { text: string } };
    }>();
    expect(body.purchase.status).toBe("demo_confirmed");
    expect(body.purchase.charged).toBe(false);
    expect(body.purchase.paymentMode).toBe("stripe_test_fake");
    expect(body.purchase.stripeTestReference.startsWith("cs_test_fake_")).toBe(true);
    expect(body.purchase.ball.status).toBe("sold");
    expect(body.purchase.buyerEmail).toBe("buyer.buy@example.com");
    expect(body.email.sent).toBe(false);
    expect(body.email.mode).toBe("dry_run");
    expect(body.email.preview.text.toLowerCase()).toContain("no payment was taken");
    expect(body.purchase.emailRecord?.sent).toBe(false);
    expect(body.purchase.emailRecord?.subject).toContain("ball 9");

    const stored = await env.DB.prepare(
      `SELECT ball_id, to_email, subject, text_body, status, mode
       FROM email_dispatches
       WHERE to_email = ?`,
    )
      .bind("buyer.buy@example.com")
      .first<{
        ball_id: number;
        to_email: string;
        subject: string;
        text_body: string;
        status: string;
        mode: string;
      }>();
    expect(stored?.ball_id).toBe(9);
    expect(stored?.subject).toContain("ball 9");
    expect(stored?.text_body.toLowerCase()).toContain("no payment was taken");
    expect(stored?.status).toBe("previewed");
    expect(stored?.mode).toBe("dry_run");

    const again = await post("/api/purchases", {
      email: "second.buy@example.com",
      ballId: 9,
    });
    expect(again.status).toBe(409);
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 9`,
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("runs the purchase engine through hold, confirm, and a dry-run receipt", async () => {
    const held = await post("/api/selections", {
      email: "Buyer.One@example.com",
      buyerName: "Ada",
      ballId: 1,
    });
    expect(held.status).toBe(201);
    const heldBody = await held.json<{
      purchase: { id: string; status: string; charged: boolean; buyerEmail: string; ball: { status: string } };
    }>();
    expect(heldBody.purchase.status).toBe("demo_pending");
    expect(heldBody.purchase.charged).toBe(false);
    expect(heldBody.purchase.buyerEmail).toBe("buyer.one@example.com");
    expect(heldBody.purchase.ball.status).toBe("selected");

    const confirmed = await post(`/api/purchases/${heldBody.purchase.id}/confirm-demo`, {
      email: "buyer.one@example.com",
    });
    expect(confirmed.status).toBe(200);
    const confirmedBody = await confirmed.json<{
      purchase: {
        status: string;
        charged: boolean;
        stripeTestReference: string;
        paymentMode: string;
        selectionId: string;
      };
      email: { sent: boolean; mode: string; preview: { text: string } };
    }>();
    expect(confirmedBody.purchase.status).toBe("demo_confirmed");
    expect(confirmedBody.purchase.charged).toBe(false);
    expect(confirmedBody.purchase.paymentMode).toBe("stripe_test_fake");
    expect(confirmedBody.purchase.stripeTestReference.startsWith("cs_test_fake_")).toBe(true);
    expect(confirmedBody.email.sent).toBe(false);
    expect(confirmedBody.email.mode).toBe("dry_run");
    expect(confirmedBody.email.preview.text.toLowerCase()).toContain("no payment was taken");
    expect(confirmedBody.email.preview.text.toLowerCase()).not.toContain("you won");

    const selection = await env.DB.prepare(
      `SELECT email, ball_id FROM ball_selections WHERE id = ?`,
    )
      .bind(confirmedBody.purchase.selectionId)
      .first<{ email: string; ball_id: number }>();
    expect(selection?.email).toBe("buyer.one@example.com");
    expect(selection?.ball_id).toBe(1);

    const again = await post("/api/selections", {
      email: "other.demo@example.com",
      ballId: 1,
    });
    expect(again.status).toBe(409);
  });

  it("cancels a hold and frees the ball", async () => {
    const held = await post("/api/selections", {
      email: "cancel.demo@example.com",
      ballId: 2,
    });
    const heldBody = await held.json<{ purchase: { id: string } }>();
    const cancelled = await post(`/api/purchases/${heldBody.purchase.id}/cancel`, {
      email: "cancel.demo@example.com",
    });
    expect(cancelled.status).toBe(200);
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 2`).first<{ status: string }>();
    expect(ball?.status).toBe("available");
    const kept = await env.DB.prepare(
      `SELECT email FROM ball_selections WHERE purchase_id = ?`,
    )
      .bind(heldBody.purchase.id)
      .first<{ email: string }>();
    expect(kept?.email).toBe("cancel.demo@example.com");
  });

  it("shows one customer's purchases and not another customer's", async () => {
    const response = await call("/api/purchases?email=sold.demo@example.com");
    const body = await response.json<{
      purchases: Array<{ buyerEmail: string; charged: boolean; paymentMode: string }>;
    }>();
    expect(body.purchases.length).toBeGreaterThanOrEqual(3);
    expect(body.purchases.every((purchase) => purchase.buyerEmail === "sold.demo@example.com")).toBe(true);
    expect(body.purchases.every((purchase) => purchase.charged === false)).toBe(true);
    expect(body.purchases.every((purchase) => purchase.paymentMode === "stripe_test_fake")).toBe(true);
  });

  it("returns the email-plus-ball record for that address only", async () => {
    const response = await call("/api/selections?email=offline.demo@example.com");
    const body = await response.json<{
      selections: Array<{ email: string; ballNumber: number; purchaseStatus: string }>;
    }>();
    expect(body.selections).toEqual([
      expect.objectContaining({
        email: "offline.demo@example.com",
        ballNumber: 40,
        purchaseStatus: "demo_confirmed",
      }),
    ]);
    const missing = await call("/api/selections");
    expect(missing.status).toBe(400);
  });

  it("records an admin offline sale without calling Stripe or sending mail", async () => {
    const denied = await post("/api/admin/offline-sales", {
      email: "table.demo@example.com",
      ballId: 8,
    });
    expect(denied.status).toBe(401);

    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetches += 1;
      return original(...args);
    };
    try {
      const recorded = await post(
        "/api/admin/offline-sales",
        {
          email: "table.demo@example.com",
          buyerName: "Table",
          ballId: 8,
          note: "Handed over at the club table in the demo.",
        },
        "test-admin-token",
      );
      expect(recorded.status).toBe(201);
      const body = await recorded.json<{
        purchase: {
          paymentMode: string;
          charged: boolean;
          stripeTestReference: string | null;
          offlineNote: string;
          buyerEmail: string;
          ball: { status: string };
        };
        email: { sent: boolean; mode: string };
      }>();
      expect(body.purchase.paymentMode).toBe("offline_demo");
      expect(body.purchase.charged).toBe(false);
      expect(body.purchase.stripeTestReference).toBeNull();
      expect(body.purchase.offlineNote).toContain("club table");
      expect(body.purchase.ball.status).toBe("sold");
      expect(body.email.sent).toBe(false);
      expect(body.email.mode).toBe("dry_run");
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }

    const sold = await post(
      "/api/admin/offline-sales",
      { email: "table.demo@example.com", ballId: 3 },
      "test-admin-token",
    );
    expect(sold.status).toBe(409);

    const relock = await post(
      "/api/admin/offline-sales",
      {
        email: "another.table@example.com",
        buyerName: "Second",
        ballId: 8,
        note: "Second attempt at the same ball.",
      },
      "test-admin-token",
    );
    expect(relock.status).toBe(409);
    const owners = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 8`,
    ).first<{ n: number }>();
    expect(owners?.n).toBe(1);
  });

  it("rejects a second purchase of the same ball when both requests arrive together", async () => {
    const [first, second] = await Promise.all([
      post("/api/purchases", { email: "race.a@example.com", buyerName: "A", ballId: 880 }),
      post("/api/purchases", { email: "race.b@example.com", buyerName: "B", ballId: 880 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 880`,
    ).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("requires the admin token on every admin route", async () => {
    const sales = await call("/api/admin/sales");
    expect(sales.status).toBe(401);
    const bad = await call("/api/admin/sales", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(bad.status).toBe(401);
    const email = await post("/api/purchases", { email: "not-an-email", ballId: 881 });
    expect(email.status).toBe(400);
  });

  it("honors the pick-a-ball switch on the purchase engine", async () => {
    const config = readConfig(env);
    await expect(
      purchaseBall(
        env.DB,
        { email: "pick.on@example.com", buyerName: null, ballId: undefined },
        config,
      ),
    ).rejects.toThrow(/Choose a ball/);
    await expect(
      purchaseBall(
        env.DB,
        { email: "pick.off@example.com", buyerName: null, ballId: 70 },
        { ...config, allowBallPicking: false },
      ),
    ).rejects.toThrow(/turned off/);
    const assigned = await purchaseBall(
      env.DB,
      { email: "random.demo@example.com", buyerName: null, ballId: undefined },
      { ...config, allowBallPicking: false },
    );
    expect(assigned.purchase.ball.status).toBe("sold");
    expect(assigned.purchase.charged).toBe(false);
    expect(assigned.purchase.paymentMode).toBe("stripe_test_fake");
  });

  it("refuses a live Stripe key and does not send the dry-run receipt", async () => {
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetches += 1;
      return original(...args);
    };
    try {
      expect(() =>
        buildDemoPayment({
          paymentMode: "stripe_test_fake",
          stripeSecretKey: "sk_live_not_a_real_key",
          purchaseId: "10000000-0000-4000-8000-000000000099",
        }),
      ).toThrow(/live Stripe key/);
      const plan = planEmailDelivery({ delivery: "dry_run", apiKey: "re_test_not_real" });
      expect(plan.shouldSend).toBe(false);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("wires the Resend hook behind a mocked fetch", async () => {
    const receipt = buildSelectionReceipt({
      to: "delivered@resend.dev",
      from: "Running of the Balls Demo <onboarding@resend.dev>",
      buyerName: "Ada",
      ballNumber: 9,
      ballLabel: "Ball 09",
      purchaseId: "10000000-0000-4000-8000-000000000099",
      selectionId: "20000000-0000-4000-8000-000000000099",
      reference: "cs_test_fake_demo",
      amountCents: 2000,
      kind: "online_demo",
    });
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer re_test_not_real");
      expect(headers.get("idempotency-key")).toBe(receipt.idempotencyKey);
      return new Response(JSON.stringify({ id: "email_test_demo" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const result = await sendSelectionReceipt(receipt, "re_test_not_real");
      expect(result.sent).toBe(true);
      expect(result.providerMessageId).toBe("email_test_demo");
      expect(calls.some((url) => url.includes("api.resend.com"))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("parses admin emails without treating blanks as access", () => {
    expect(parseAdminEmails("  Club.Admin@Example.com, , other.admin@example.com ")).toEqual([
      "club.admin@example.com",
      "other.admin@example.com",
    ]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("not-an-email, ok@example.com")).toEqual(["ok@example.com"]);
  });

  it("refuses a Google user who is not in ADMIN_EMAILS", async () => {
    const secret = "test-session-secret";
    const cookie = await signSession(secret, { email: "Buyer.Google@example.com", name: null });
    const denied = await callAs(
      "/api/admin/offline-sales",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "table.google@example.com", buyerName: "Table", ballId: 940 }),
      },
      {
        ADMIN_EMAILS: "club.admin@example.com",
        SESSION_SECRET: secret,
      },
    );
    expect(denied.status).toBe(401);
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 940`).first<{ status: string }>();
    expect(ball?.status).toBe("available");
    const session = await callAs(
      "/api/auth/session",
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
      { ADMIN_EMAILS: "club.admin@example.com", SESSION_SECRET: secret },
    );
    expect(await session.json()).toMatchObject({
      signedIn: true,
      email: "buyer.google@example.com",
      admin: false,
    });
  });

  it("allows a Google user whose email is in ADMIN_EMAILS", async () => {
    const secret = "test-session-secret";
    const cookie = await signSession(secret, { email: "Club.Admin@Example.com", name: "Club" });
    const sales = await callAs(
      "/api/admin/sales",
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
      {
        ADMIN_EMAILS: "  club.admin@example.com, other.admin@example.com ",
        SESSION_SECRET: secret,
      },
    );
    expect(sales.status).toBe(200);
    const session = await callAs(
      "/api/auth/session",
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
      {
        ADMIN_EMAILS: "club.admin@example.com",
        SESSION_SECRET: secret,
      },
    );
    expect(await session.json()).toMatchObject({
      signedIn: true,
      email: "club.admin@example.com",
      admin: true,
      googleSignIn: false,
    });
    const tokenStillWorks = await callAs(
      "/api/admin/sales",
      { headers: { authorization: "Bearer test-admin-token" } },
      { ADMIN_EMAILS: "", SESSION_SECRET: secret },
    );
    expect(tokenStillWorks.status).toBe(200);
  });

  it("grants no Google admin when ADMIN_EMAILS is empty or missing", async () => {
    const secret = "test-session-secret";
    const cookie = await signSession(secret, { email: "club.admin@example.com", name: null });
    for (const emails of ["", "   ", " , , "]) {
      const response = await callAs(
        "/api/admin/sales",
        { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
        { ADMIN_EMAILS: emails, SESSION_SECRET: secret },
      );
      expect(response.status).toBe(401);
    }
    const missing = await callAs(
      "/api/admin/sales",
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
      { SESSION_SECRET: secret },
    );
    expect(missing.status).toBe(401);
    const session = await callAs(
      "/api/auth/session",
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } },
      { ADMIN_EMAILS: "", SESSION_SECRET: secret },
    );
    expect(await session.json()).toMatchObject({ signedIn: true, admin: false });
  });

  it("lets a buyer purchase without Google and leaves sign-in unavailable", async () => {
    const bought = await post("/api/purchases", {
      email: "no.google@example.com",
      buyerName: "No Google",
      ballId: 941,
    });
    expect(bought.status).toBe(201);
    const body = await bought.json<{ purchase: { charged: boolean; paymentMode: string } }>();
    expect(body.purchase.charged).toBe(false);
    expect(body.purchase.paymentMode).toBe("stripe_test_fake");
    const session = await call("/api/auth/session");
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ signedIn: false, admin: false, googleSignIn: false });
    const start = await call("/api/auth/google");
    expect(start.status).toBe(503);
    const health = await call("/api/health");
    expect(health.status).toBe(200);
  });

  it("starts Google sign-in only when the client is configured", async () => {
    const secret = "test-session-secret";
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetches += 1;
      return original(...args);
    };
    try {
      const response = await callAs("/api/auth/google?next=https://evil.example", undefined, {
        GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "test-client-secret-value",
        SESSION_SECRET: secret,
        ADMIN_EMAILS: "club.admin@example.com",
      });
      expect(response.status).toBe(302);
      const location = response.headers.get("location") ?? "";
      expect(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
      const redirect = new URL(location);
      expect(redirect.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
      expect(redirect.searchParams.get("redirect_uri")).toBe("http://example.com/api/auth/google/callback");
      expect(location).not.toContain("test-client-secret-value");
      expect(location).not.toContain("evil.example");
      expect(location).not.toContain("club.admin@example.com");
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie.toLowerCase()).toContain("httponly");
      expect(fetches).toBe(0);

      const failed = await callAs("/api/auth/google/callback?code=nope&state=nope", undefined, {
        GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "test-client-secret-value",
        SESSION_SECRET: secret,
      });
      expect(failed.status).toBe(302);
      const back = new URL(failed.headers.get("location") ?? "", "http://example.com");
      expect(back.pathname).toBe("/admin");
      expect(back.searchParams.get("auth")).toBe("failed");
      expect(fetches).toBe(0);

      const config = await callAs("/api/config", undefined, {
        GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "test-client-secret-value",
        SESSION_SECRET: secret,
        ADMIN_EMAILS: "club.admin@example.com",
      });
      const text = await config.text();
      expect(text).toContain('"googleSignIn":true');
      expect(text).not.toContain("test-client-secret-value");
      expect(text).not.toContain("club.admin@example.com");
    } finally {
      globalThis.fetch = original;
    }
  });
});
