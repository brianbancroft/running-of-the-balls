import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config";
import { buildSelectionReceipt } from "../src/email/receipt";
import { planEmailDelivery, sendSelectionReceipt } from "../src/email/deliver";
import worker from "../src/index";
import { buildDemoPayment } from "../src/payments/stripe-test";
import { holdBall } from "../src/purchase-engine";

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
    expect(body.balls).toHaveLength(48);
    expect(JSON.stringify(body)).not.toContain("@");
    expect(body.balls.find((ball) => ball.ballNumber === 3)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 6)?.status).toBe("selected");
    expect(body.balls.find((ball) => ball.ballNumber === 40)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 1)?.status).toBe("available");
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
  });

  it("assigns the next open ball when picking is turned off", async () => {
    const config = readConfig(env);
    const purchase = await holdBall(
      env.DB,
      { email: "assign.demo@example.com", buyerName: null, ballId: undefined },
      { ...config, allowBallPicking: false },
    );
    expect(purchase.ball.status).toBe("selected");
    expect(purchase.paymentMode).toBe("stripe_test_fake");
    expect(purchase.charged).toBe(false);
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
});
