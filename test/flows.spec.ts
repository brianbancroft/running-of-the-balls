import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseAdminEmails, readConfig } from "../src/config";
import { SESSION_COOKIE, signSession } from "../src/session";
import { buildSelectionReceipt } from "../src/email/receipt";
import { planEmailDelivery, sendSelectionReceipt } from "../src/email/deliver";
import worker from "../src/index";
import { buildDemoPayment } from "../src/payments/stripe-test";
import { formatBallNumber, marqueeNumbers } from "../src/client/format";
import { BUYER_ATTESTATION_TEXT, UNLICENSED_BANNER } from "../src/compliance";
import { purchaseBall } from "../src/purchase-engine";

const SEEDED_SOLD_TOKEN = "390822ccb06855179424236c3774f960118070866e3030acb0808837a6ca55d3";
const BUYER_ATTESTATION = { by: "buyer" as const, text: BUYER_ATTESTATION_TEXT };

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const needsAttestation =
    path === "/api/purchases" ||
    path === "/api/admin/offline-sales" ||
    path.includes("/confirm-demo");
  const payload =
    needsAttestation && body !== null && typeof body === "object" && !Array.isArray(body)
      ? { attestAge19: true, attestInBc: true, ...(body as Record<string, unknown>) }
      : body;
  return call(path, { method: "POST", headers, body: JSON.stringify(payload) });
}

async function callAs(
  path: string,
  init: RequestInit | undefined,
  patch: Partial<{
    [K in keyof CloudflareBindings]: CloudflareBindings[K] extends string ? string : CloudflareBindings[K];
  }>,
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
      assignment: string;
      numbering: string;
      numberPad: number;
      bundles: unknown[];
      decisionsPending: boolean;
      amountCents: number;
    }>();
    expect(body.demoMode).toBe(true);
    expect(body.paymentMode).toBe("stripe_test_fake");
    expect(body.emailDelivery).toBe("dry_run");
    expect(body.charged).toBe(false);
    expect(body.allowBallPicking).toBe(true);
    expect(body.assignment).toBe("buyer_picks");
    expect(body.numbering).toBe("sequential_from_1");
    expect(body.numberPad).toBe(3);
    expect(body.bundles).toEqual([]);
    expect(body.decisionsPending).toBe(true);
    expect(body.amountCents).toBe(500);
    expect(formatBallNumber(7, body.numberPad)).toBe("007");
    expect(formatBallNumber(7, 0)).toBe("7");
    expect(formatBallNumber(2500, 3)).toBe("2500");
    expect(JSON.stringify(body)).not.toContain("sk_");
    expect(JSON.stringify(body)).not.toContain("test-admin-token");

    // callAs writes through to the shared test bindings, so restore them.
    try {
      const priced = await callAs("/api/config", undefined, {
        BALL_BUNDLES: '[{"quantity":5,"label":"Five balls"},{"label":" A pair ","quantity":2}]',
      });
      expect(priced.status).toBe(200);
      expect(await priced.json()).toMatchObject({
        bundles: [
          { quantity: 2, label: "A pair" },
          { quantity: 5, label: "Five balls" },
        ],
      });
      const invented = await callAs("/api/config", undefined, {
        BALL_BUNDLES: '[{"quantity":5,"label":"Five","amountCents":100}]',
      });
      expect(invented.status).toBe(500);
      const scheme = await callAs("/api/config", undefined, { BALL_NUMBERING: "lucky-numbers" });
      expect(scheme.status).toBe(500);
      const plain = await callAs("/api/config", undefined, {
        BALL_NUMBERING: "sequential_from_1",
        BALL_NUMBER_PAD: "0",
        BALL_BUNDLES: "[]",
      });
      expect(plain.status).toBe(200);
      expect(await plain.json()).toMatchObject({ numberPad: 0, numbering: "sequential_from_1" });
    } finally {
      await callAs("/api/config", undefined, {
        BALL_NUMBERING: "sequential_from_1",
        BALL_NUMBER_PAD: "3",
        BALL_BUNDLES: "[]",
      });
    }
  });

  it("shows the unlicensed banner until a licence number is configured", async () => {
    const response = await call("/api/config");
    const body = await response.json<{
      demoMode: boolean;
      licensed: boolean;
      gamingLicenceNumber: string | null;
      rulesUrl: string;
      licenceStatus: string;
    }>();
    expect(body.demoMode).toBe(true);
    expect(body.licensed).toBe(false);
    expect(body.gamingLicenceNumber).toBeNull();
    expect(body.rulesUrl).toBe("/rules");
    expect(body.licenceStatus).toBe(UNLICENSED_BANNER);

    const licensed = await callAs("/api/config", undefined, {
      GAMING_LICENCE_NUMBER: "  123456  ",
      GAMING_RULES_URL: "https://example.com/club-rules",
    });
    expect(licensed.status).toBe(200);
    expect(await licensed.json()).toMatchObject({
      demoMode: true,
      licensed: true,
      gamingLicenceNumber: "123456",
      rulesUrl: "https://example.com/club-rules",
      licenceStatus: "BC Gaming Event Licence #123456",
    });

    const pathRules = await callAs("/api/config", undefined, {
      GAMING_LICENCE_NUMBER: "",
      GAMING_RULES_URL: "/club-rules",
    });
    expect(await pathRules.json()).toMatchObject({ rulesUrl: "/club-rules", licensed: false });

    const rejected = await callAs("/api/config", undefined, {
      GAMING_LICENCE_NUMBER: "",
      GAMING_RULES_URL: "javascript:alert(1)",
    });
    expect(rejected.status).toBe(500);
    const restored = await callAs("/api/config", undefined, {
      GAMING_LICENCE_NUMBER: "",
      GAMING_RULES_URL: "",
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ licensed: false, rulesUrl: "/rules", licenceStatus: UNLICENSED_BANNER });

    const checkout = await call("/checkout");
    expect(checkout.status).toBe(200);
    const checkoutHtml = await checkout.text();
    expect(checkoutHtml).toContain(UNLICENSED_BANNER);
    expect(checkoutHtml).toContain("I am 19 or older and I am physically in British Columbia.");
    const rules = await call("/rules");
    expect(rules.status).toBe(200);
    const rulesHtml = await rules.text();
    expect(rulesHtml).toContain("Placeholder");
    expect(rulesHtml).toContain("pending the club's licence terms");
    expect(rulesHtml).toContain(UNLICENSED_BANNER);
    expect(rulesHtml).toContain("None of those are stated on this page.");
    expect(rulesHtml).not.toMatch(/\$\d/);
    expect(rulesHtml).toContain("Demo, no licence. No real tickets are sold.");
    expect(rulesHtml.match(/data-licence-status/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("reads placeholder prizes and confirms one decision at a time", async () => {
    const podium =
      '[{"place":"1st down","amount":"$500"},{"place":"2nd down","amount":"$300"},{"place":"3rd down","amount":"$100"}]';
    const defaults = {
      PRIZE_PODIUM: podium,
      BALL_NUMBERING_CONFIRMED: "false",
      BALL_NUMBER_PAD_CONFIRMED: "false",
      DEMO_AMOUNT_CONFIRMED: "false",
      BALL_BUNDLES_CONFIRMED: "false",
      BALL_ASSIGNMENT_CONFIRMED: "false",
      PRIZES_CONFIRMED: "false",
    };
    try {
      const response = await call("/api/config");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        prizes: [
          { place: "1st down", amount: "$500" },
          { place: "2nd down", amount: "$300" },
          { place: "3rd down", amount: "$100" },
        ],
        decisions: {
          numbering: false,
          numberPad: false,
          price: false,
          bundles: false,
          assignment: false,
          prizes: false,
        },
        decisionsPending: true,
      });

      const home = await call("/");
      expect(home.status).toBe(200);
      const homeHtml = await home.text();
      expect(homeHtml).toContain("Placeholder · prizes TBA");
      expect(homeHtml).toContain('id="podium"');
      expect(homeHtml).not.toContain("$500");
      expect(homeHtml).not.toContain("$300");
      expect(homeHtml).not.toContain("$100");

      const price = await callAs("/api/config", undefined, { ...defaults, DEMO_AMOUNT_CONFIRMED: "true" });
      expect(price.status).toBe(200);
      expect(await price.json()).toMatchObject({
        amountCents: 500,
        decisions: { price: true, prizes: false, numbering: false, bundles: false },
        decisionsPending: true,
      });

      const blank = await callAs("/api/config", undefined, { ...defaults, DEMO_AMOUNT_CONFIRMED: "  " });
      expect(await blank.json()).toMatchObject({ decisions: { price: false }, decisionsPending: true });

      const typo = await callAs("/api/config", undefined, { ...defaults, PRIZES_CONFIRMED: "yes" });
      expect(typo.status).toBe(500);

      const odds = await callAs("/api/config", undefined, {
        ...defaults,
        PRIZE_PODIUM: '[{"place":"1st down","amount":"$1","odds":"1 in 2500"}]',
      });
      expect(odds.status).toBe(500);

      const health = await callAs("/api/health", undefined, { ...defaults, PRIZE_PODIUM: "not-json" });
      expect(health.status).toBe(500);
      const page = await callAs("/rules", undefined, { ...defaults, PRIZE_PODIUM: "not-json" });
      expect(page.status).toBe(500);

      const custom = await callAs("/api/config", undefined, {
        ...defaults,
        PRIZE_PODIUM: '[{"place":"First down","amount":"A hamper"}]',
        PRIZES_CONFIRMED: "true",
        BALL_NUMBERING_CONFIRMED: "true",
        BALL_NUMBER_PAD_CONFIRMED: "true",
        DEMO_AMOUNT_CONFIRMED: "true",
        BALL_BUNDLES_CONFIRMED: "true",
        BALL_ASSIGNMENT_CONFIRMED: "true",
      });
      expect(custom.status).toBe(200);
      expect(await custom.json()).toMatchObject({
        prizes: [{ place: "First down", amount: "A hamper" }],
        decisionsPending: false,
        licensed: false,
        licenceStatus: UNLICENSED_BANNER,
      });

      const bought = await callAs(
        "/api/purchases",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "price.confirmed@example.com",
            buyerName: "Ada",
            ballId: 2310,
            attestAge19: true,
            attestInBc: true,
          }),
        },
        { ...defaults, DEMO_AMOUNT_CONFIRMED: "true" },
      );
      expect(bought.status).toBe(201);
      const boughtBody = await bought.json<{ email: { preview: { text: string } } }>();
      expect(boughtBody.email.preview.text.toLowerCase()).toContain("no payment was taken");
      expect(boughtBody.email.preview.text).toContain("demonstration amount, not a charge");
      expect(boughtBody.email.preview.text).not.toContain("pending a decision");
    } finally {
      await callAs("/api/config", undefined, defaults);
    }
  });

  it("serves the pages without a Google Fonts request", async () => {
    for (const path of ["/", "/pick", "/checkout", "/confirmation", "/selections", "/purchase", "/rules", "/admin"]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).not.toContain("fonts.googleapis.com");
      expect(html).not.toContain("fonts.gstatic.com");
      expect(html).toContain("/styles.css");
    }
    const css = await call("/styles.css");
    expect(css.status).toBe(200);
    const text = await css.text();
    expect(text).toContain('url("/fonts/bricolage-grotesque.woff2")');
    expect(text).toContain('url("/fonts/source-sans-3.woff2")');
    for (const path of ["/fonts/bricolage-grotesque.woff2", "/fonts/source-sans-3.woff2"]) {
      const font = await call(path);
      expect(font.status).toBe(200);
      const bytes = new Uint8Array(await font.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("wOF2");
    }
  });

  it("lists 2500 balls without buyer emails and shades seeded states", async () => {
    const response = await call("/api/balls");
    const raw = await response.text();
    expect(raw.length).toBeLessThan(180_000);
    const body = JSON.parse(raw) as {
      balls: Array<{ ballNumber: number; status: string; label?: string }>;
    };
    expect(body.balls).toHaveLength(2500);
    expect(body.balls.at(-1)?.ballNumber).toBe(2500);
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("label");
    expect(body.balls.find((ball) => ball.ballNumber === 3)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 6)?.status).toBe("selected");
    expect(body.balls.find((ball) => ball.ballNumber === 40)?.status).toBe("sold");
    expect(body.balls.find((ball) => ball.ballNumber === 1)?.status).toBe("available");
    expect(body.balls.find((ball) => ball.ballNumber === 2500)?.status).toBe("available");
  });

  it("keeps held and sold balls in a marquee sample", () => {
    const balls = Array.from({ length: 2500 }, (_, index) => ({
      ballNumber: index + 1,
      status: index + 1 === 3 || index + 1 === 40 ? "sold" : index + 1 === 6 ? "selected" : "available",
    }));
    const sample = marqueeNumbers(balls, 312, 42);
    expect(sample).toHaveLength(312);
    expect(new Set(sample).size).toBe(312);
    expect(sample).toContain(3);
    expect(sample).toContain(6);
    expect(sample).toContain(40);
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
        receiptToken: string;
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
    expect(body.purchase.emailRecord?.subject).toContain("ball 009");
    expect(body.purchase.receiptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.email.preview.text).toContain(`/purchase?token=${body.purchase.receiptToken}`);

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
    expect(stored?.subject).toContain("ball 009");
    expect(stored?.text_body.toLowerCase()).toContain("no payment was taken");
    expect(stored?.text_body).toContain("placeholder, pending a decision");
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

  it("opens one purchase from its receipt token and does not list by email", async () => {
    const byEmail = await call("/api/purchases?email=sold.demo@example.com");
    expect(byEmail.status).toBe(400);
    const hidden = await byEmail.text();
    expect(hidden).not.toContain("sold.demo");
    expect(hidden).not.toContain("Demo Buyer");

    const response = await call(`/api/purchases?token=${SEEDED_SOLD_TOKEN}`);
    const body = await response.json<{
      purchase: { buyerEmail: string; charged: boolean; paymentMode: string; ball: { ballNumber: number } };
      purchases?: unknown;
    }>();
    expect(body.purchases).toBeUndefined();
    expect(body.purchase.buyerEmail).toBe("sold.demo@example.com");
    expect(body.purchase.ball.ballNumber).toBe(3);
    expect(body.purchase.charged).toBe(false);
    expect(body.purchase.paymentMode).toBe("stripe_test_fake");
    expect(JSON.stringify(body)).not.toContain('"ballNumber":21');

    const ignoredEmail = await call(
      `/api/purchases?token=${SEEDED_SOLD_TOKEN}&email=offline.demo@example.com`,
    );
    const ignored = await ignoredEmail.json<{ purchase: { buyerEmail: string; ball: { ballNumber: number } } }>();
    expect(ignored.purchase.buyerEmail).toBe("sold.demo@example.com");
    expect(ignored.purchase.ball.ballNumber).toBe(3);

    const missing = await call(`/api/purchases?token=${"ab".repeat(32)}`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("sold.demo");
  });

  it("keeps email-and-ball records, including receipt text, behind admin auth", async () => {
    const open = await call("/api/selections?email=offline.demo@example.com");
    expect(open.status).toBe(401);
    expect(await open.text()).not.toContain("offline.demo");

    const wrong = await call("/api/admin/selections?email=offline.demo@example.com", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("Club Table");

    const response = await call("/api/selections?email=offline.demo@example.com", {
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(response.status).toBe(200);
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
    expect(JSON.stringify(body)).not.toContain("sold.demo@example.com");
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
        { email: "pick.on@example.com", buyerName: null, ballId: undefined, attestation: BUYER_ATTESTATION },
        config,
        "http://example.com",
      ),
    ).rejects.toThrow(/Choose a ball/);
    await expect(
      purchaseBall(
        env.DB,
        { email: "pick.off@example.com", buyerName: null, ballId: 70, attestation: BUYER_ATTESTATION },
        { ...config, allowBallPicking: false },
        "http://example.com",
      ),
    ).rejects.toThrow(/turned off/);
    const assigned = await purchaseBall(
      env.DB,
      { email: "random.demo@example.com", buyerName: null, ballId: undefined, attestation: BUYER_ATTESTATION },
      { ...config, allowBallPicking: false },
      "http://example.com",
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
      numberPad: 3,
      priceConfirmed: false,
      kind: "online_demo",
      receiptUrl: "http://example.com/purchase?token=abc",
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

  it("rejects missing and wrong auth on every admin route", async () => {
    const routes: Array<{ method: string; path: string; body?: unknown }> = [
      { method: "GET", path: "/api/admin/sales" },
      { method: "GET", path: "/api/admin/selections?email=offline.demo@example.com" },
      { method: "GET", path: "/api/selections?email=sold.demo@example.com" },
      {
        method: "POST",
        path: "/api/admin/offline-sales",
        body: { email: "blocked.admin@example.com", buyerName: "Blocked", ballId: 2100 },
      },
      {
        method: "POST",
        path: "/api/admin/purchases/10000000-0000-4000-8000-000000000003/void",
        body: { reason: "Wrong ball recorded in the demo." },
      },
      { method: "GET", path: "/api/admin/exports/purchases.csv" },
      { method: "GET", path: "/api/admin/exports/ball-selections.csv" },
      { method: "GET", path: "/api/admin/exports/email-dispatches.csv" },
    ];
    for (const route of routes) {
      for (const authorization of [undefined, "Bearer wrong-token", "Bearer"]) {
        const headers: Record<string, string> = {};
        if (route.body) headers["content-type"] = "application/json";
        if (authorization) headers.authorization = authorization;
        const response = await call(route.path, {
          method: route.method,
          headers,
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        expect(response.status, `${route.method} ${route.path} ${authorization ?? "none"}`).toBe(401);
        const text = await response.text();
        expect(text).not.toContain("offline.demo");
        expect(text).not.toContain("sold.demo");
        expect(text).not.toContain("Club Table");
      }
    }
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 2100`).first<{ status: string }>();
    expect(ball?.status).toBe("available");
  });

  it("escapes a buyer name in the stored receipt and rejects a broken email", async () => {
    const name = "O'Brien & \"Ada\" <script\u003e";
    const bought = await post("/api/purchases", {
      email: "xss.buyer@example.com",
      buyerName: name,
      ballId: 1600,
    });
    expect(bought.status).toBe(201);
    const stored = await env.DB.prepare(
      `SELECT html_body, text_body FROM email_dispatches WHERE to_email = ?`,
    )
      .bind("xss.buyer@example.com")
      .first<{ html_body: string; text_body: string }>();
    expect(stored?.html_body).toContain("O&#39;Brien &amp; &quot;Ada&quot; &lt;script&gt;");
    expect(stored?.html_body).not.toContain("<script");
    expect(stored?.text_body).toContain(name);
    const broken = await post("/api/purchases", {
      email: "buyer@example.com\nBcc: evil@example.com",
      buyerName: "Ada",
      ballId: 1601,
    });
    expect(broken.status).toBe(400);
    const named = await post("/api/purchases", {
      email: "newline.name@example.com",
      buyerName: "Ada\r\nEvil",
      ballId: 1601,
    });
    expect(named.status).toBe(201);
    const row = await named.json<{ purchase: { buyerName: string } }>();
    expect(row.purchase.buyerName).toBe("Ada Evil");
    const stillFree = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1601`).first<{ status: string }>();
    expect(stillFree?.status).toBe("sold");
  });

  it("lets only one of an online buy and an offline sale lock the same ball", async () => {
    const [online, offline] = await Promise.all([
      post("/api/purchases", { email: "race.online@example.com", buyerName: "On", ballId: 1500 }),
      post(
        "/api/admin/offline-sales",
        { email: "race.offline@example.com", buyerName: "Off", ballId: 1500, note: "Race the online buy." },
        "test-admin-token",
      ),
    ]);
    expect([online.status, offline.status].sort()).toEqual([201, 409]);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 1500`,
    ).first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1500`).first<{ status: string }>();
    expect(ball?.status).toBe("sold");
  });

  it("holds a ball against a second hold and an offline sale, then frees it on cancel", async () => {
    const held = await post("/api/selections", {
      email: "hold.race@example.com",
      buyerName: "Hold",
      ballId: 1501,
    });
    expect(held.status).toBe(201);
    const heldBody = await held.json<{ purchase: { id: string } }>();
    expect((await post("/api/selections", { email: "other.hold@example.com", ballId: 1501 })).status).toBe(409);
    expect(
      (
        await post(
          "/api/admin/offline-sales",
          { email: "table.hold@example.com", buyerName: "Table", ballId: 1501, note: "Should wait." },
          "test-admin-token",
        )
      ).status,
    ).toBe(409);
    expect((await post("/api/purchases", { email: "early.buy@example.com", ballId: 1501 })).status).toBe(409);
    expect(
      (await post(`/api/purchases/${heldBody.purchase.id}/cancel`, { email: "hold.race@example.com" })).status,
    ).toBe(200);
    const freed = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1501`).first<{ status: string }>();
    expect(freed?.status).toBe("available");
    expect(
      (await post("/api/purchases", { email: "after.cancel@example.com", buyerName: "After", ballId: 1501 })).status,
    ).toBe(201);
    expect(
      (await post(`/api/purchases/${heldBody.purchase.id}/cancel`, { email: "hold.race@example.com" })).status,
    ).toBe(200);
    const sold = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1501`).first<{ status: string }>();
    expect(sold?.status).toBe("sold");
    const confirmed = await env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM purchases p
       JOIN ball_selections s ON s.purchase_id = p.id
       WHERE s.ball_id = 1501 AND p.status = 'demo_confirmed'`,
    ).first<{ n: number }>();
    expect(confirmed?.n).toBe(1);
  });

  it("sells many balls to one buyer with no cap and never double-sells", async () => {
    const ids = [1710, 1711, 1712, 1713, 1714, 1715, 1716, 1717, 1718, 1719, 1720, 1721];
    for (const id of ids) {
      const response = await post("/api/purchases", {
        email: "many.balls@example.com",
        buyerName: "Many",
        ballId: id,
      });
      expect(response.status).toBe(201);
    }
    const [first, second] = await Promise.all([
      post("/api/purchases", { email: "many.a@example.com", ballId: 1710 }),
      post("/api/purchases", { email: "many.b@example.com", ballId: 1710 }),
    ]);
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 1710`,
    ).first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const owned = await env.DB.prepare(
      `SELECT COUNT(DISTINCT s.ball_id) AS n
       FROM ball_selections s
       JOIN purchases p ON p.id = s.purchase_id
       WHERE p.buyer_email = ? AND p.status = 'demo_confirmed'`,
    )
      .bind("many.balls@example.com")
      .first<{ n: number }>();
    expect(owned?.n).toBe(12);
  });

  it("assigns distinct balls when several checkouts run together", async () => {
    const config = readConfig(env);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        purchaseBall(
          env.DB,
          {
            email: `assigned.${index}@example.com`,
            buyerName: null,
            ballId: undefined,
            attestation: BUYER_ATTESTATION,
          },
          { ...config, allowBallPicking: false },
          "http://example.com",
        ),
      ),
    );
    const ids = results.map((result) => result.purchase.ball.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(results.every((result) => result.purchase.charged === false)).toBe(true);
    expect(results.every((result) => result.purchase.attestation.age19 && result.purchase.attestation.inBc)).toBe(
      true,
    );
  });

  it("refuses an online purchase without a 19+ and in-BC attestation", async () => {
    const missing = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "no.attest@example.com", buyerName: "Ada", ballId: 2200 }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: "Confirm you are 19 or older and physically in British Columbia.",
    });
    const oneSided = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "no.attest@example.com",
        buyerName: "Ada",
        ballId: 2200,
        attestAge19: true,
        attestInBc: false,
      }),
    });
    expect(oneSided.status).toBe(400);
    const asText = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "no.attest@example.com",
        ballId: 2200,
        attestAge19: "true",
        attestInBc: "true",
      }),
    });
    expect(asText.status).toBe(400);
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 2200`).first<{ status: string }>();
    expect(ball?.status).toBe("available");

    const bought = await post("/api/purchases", {
      email: "attested.buyer@example.com",
      buyerName: "Ada",
      ballId: 2200,
    });
    expect(bought.status).toBe(201);
    const body = await bought.json<{
      purchase: { attestation: { age19: boolean; inBc: boolean; by: string; text: string; at: string } };
    }>();
    expect(body.purchase.attestation.age19).toBe(true);
    expect(body.purchase.attestation.inBc).toBe(true);
    expect(body.purchase.attestation.by).toBe("buyer");
    expect(body.purchase.attestation.text).toBe(BUYER_ATTESTATION_TEXT);
    expect(body.purchase.attestation.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = await env.DB.prepare(
      `SELECT attested_age_19, attested_in_bc, attested_by, attestation_text
       FROM purchases WHERE buyer_email = ?`,
    )
      .bind("attested.buyer@example.com")
      .first<{
        attested_age_19: number;
        attested_in_bc: number;
        attested_by: string;
        attestation_text: string;
      }>();
    expect(stored).toEqual({
      attested_age_19: 1,
      attested_in_bc: 1,
      attested_by: "buyer",
      attestation_text: BUYER_ATTESTATION_TEXT,
    });
  });

  it("refuses an offline sale without the same attestation and stores it when present", async () => {
    const missing = await call("/api/admin/offline-sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token",
      },
      body: JSON.stringify({
        email: "table.attest@example.com",
        buyerName: "Table",
        ballId: 2201,
        note: "Club table.",
      }),
    });
    expect(missing.status).toBe(400);
    const ball = await env.DB.prepare(`SELECT status FROM balls WHERE id = 2201`).first<{ status: string }>();
    expect(ball?.status).toBe("available");

    const recorded = await post(
      "/api/admin/offline-sales",
      {
        email: "table.attest@example.com",
        buyerName: "Table",
        ballId: 2201,
        note: "Club table.",
        attestAge19: false,
        attestInBc: true,
      },
      "test-admin-token",
    );
    expect(recorded.status).toBe(400);

    const ok = await post(
      "/api/admin/offline-sales",
      {
        email: "table.attest@example.com",
        buyerName: "Table",
        ballId: 2201,
        note: "Club table.",
      },
      "test-admin-token",
    );
    expect(ok.status).toBe(201);
    const body = await ok.json<{
      purchase: { attestation: { age19: boolean; inBc: boolean; by: string; text: string } };
    }>();
    expect(body.purchase.attestation).toMatchObject({
      age19: true,
      inBc: true,
      by: "admin",
      text: "The buyer confirmed they are 19 or older and physically in British Columbia.",
    });
  });

  it("requires the same attestation before a hold can be confirmed", async () => {
    const held = await post("/api/selections", {
      email: "hold.attest@example.com",
      buyerName: "Hold",
      ballId: 2202,
    });
    expect(held.status).toBe(201);
    const heldBody = await held.json<{ purchase: { id: string; attestation: { age19: boolean } } }>();
    expect(heldBody.purchase.attestation.age19).toBe(false);
    const missing = await call(`/api/purchases/${heldBody.purchase.id}/confirm-demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hold.attest@example.com" }),
    });
    expect(missing.status).toBe(400);
    const stillHeld = await env.DB.prepare(`SELECT status FROM balls WHERE id = 2202`).first<{ status: string }>();
    expect(stillHeld?.status).toBe("selected");
    const confirmed = await post(`/api/purchases/${heldBody.purchase.id}/confirm-demo`, {
      email: "hold.attest@example.com",
    });
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json<{ purchase: { attestation: { age19: boolean; inBc: boolean; by: string } } }>();
    expect(body.purchase.attestation).toMatchObject({ age19: true, inBc: true, by: "buyer" });
  });

  it("leaves seeded demo fixtures without an attestation", async () => {
    const response = await call(`/api/purchases?token=${SEEDED_SOLD_TOKEN}`);
    expect(response.status).toBe(200);
    const body = await response.json<{
      purchase: { attestation: { age19: boolean; inBc: boolean; at: string | null; by: string | null } };
    }>();
    expect(body.purchase.attestation).toEqual({
      age19: false,
      inBc: false,
      at: null,
      by: null,
      text: null,
    });
  });
});
