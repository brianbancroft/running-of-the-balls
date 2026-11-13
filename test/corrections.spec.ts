import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "../src/csv";
import worker from "../src/index";
import { SESSION_COOKIE, signSession } from "../src/session";

const TOKEN = "test-admin-token";

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function callAs(
  path: string,
  init: RequestInit | undefined,
  patch: Partial<Record<string, string>>,
): Promise<Response> {
  const bindings = Object.create(env) as CloudflareBindings;
  Object.assign(bindings, patch);
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const needsAttestation = path === "/api/purchases" || path === "/api/admin/offline-sales";
  const payload =
    needsAttestation && body !== null && typeof body === "object" && !Array.isArray(body)
      ? { attestAge19: true, attestInBc: true, ...(body as Record<string, unknown>) }
      : body;
  return call(path, { method: "POST", headers, body: JSON.stringify(payload) });
}

async function ballStatus(id: number): Promise<string | undefined> {
  const row = await env.DB.prepare(`SELECT status FROM balls WHERE id = ?`).bind(id).first<{ status: string }>();
  return row?.status;
}

async function auditCount(purchaseId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sale_voids WHERE purchase_id = ?`)
    .bind(purchaseId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function activeSales(ballId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM purchases p
     JOIN ball_selections s ON s.purchase_id = p.id
     WHERE s.ball_id = ? AND p.status = 'demo_confirmed' AND p.voided_at IS NULL`,
  )
    .bind(ballId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

type SaleBody = {
  purchase: {
    id: string;
    status: string;
    paymentMode: string;
    buyerEmail: string;
    receiptToken: string;
    charged: boolean;
    attestation: { age19: boolean; inBc: boolean; by: string | null };
    void: { at: string; by: string; reason: string } | null;
    ball: { id: number; ballNumber: number; status: string };
  };
};

async function sellOnline(ballId: number, email: string): Promise<SaleBody> {
  const response = await post("/api/purchases", { email, buyerName: "Buyer", ballId });
  expect(response.status).toBe(201);
  return response.json<SaleBody>();
}

async function voidSale(purchaseId: string, reason: string, token: string | null = TOKEN): Promise<Response> {
  return post(`/api/admin/purchases/${purchaseId}/void`, { reason }, token ?? undefined);
}

describe("admin sale corrections", () => {
  it("prefixes spreadsheet formulas and quotes commas", () => {
    const csv = toCsv([
      ["name", "note"],
      ["=1+1", 'Ada, "Bee"'],
      ["+Ada", "-10"],
      ["@SUM(A1)", "\t=cmd"],
      ["\tHello", "\r=1"],
      [" safe", "Hello"],
    ]);
    expect(csv).toBe(
      [
        `"name","note"`,
        `"'=1+1","Ada, ""Bee"""`,
        `"'+Ada","'-10"`,
        `"'@SUM(A1)","'\t=cmd"`,
        `"'\tHello","'\r=1"`,
        `" safe","Hello"`,
      ].join("\r\n") + "\r\n",
    );
    expect(csv).not.toContain(`"=1+1"`);
    expect(csv).not.toContain(`"+Ada"`);
    expect(csv).not.toContain(`"-10"`);
    expect(csv).not.toContain(`"@SUM(A1)"`);
    expect(
      toCsv([
        ["email", "id", "body"],
        [
          "buyer@example.com",
          "10000000-0000-4000-8000-000000000003",
          "Ladysmith\nbuyer@example.com",
        ],
      ]),
    ).toBe(
      [
        `"email","id","body"`,
        `"buyer@example.com","10000000-0000-4000-8000-000000000003","Ladysmith\nbuyer@example.com"`,
      ].join("\r\n") + "\r\n",
    );
    expect(csvField("2026-11-01T16:00:00.000Z")).toBe(`"2026-11-01T16:00:00.000Z"`);
    expect(csvField("foo=bar")).toBe(`"foo=bar"`);
    expect(csvField(" -10")).toBe(`"' -10"`);
    expect(csvField("\n=1")).toBe(`"'\n=1"`);
    expect(csvField("\nHello")).toBe(`"\nHello"`);
  });

  it("refuses record downloads without an admin and escapes formula cells", async () => {
    const bought = await post("/api/purchases", {
      email: "formula.export@example.com",
      buyerName: "=1+1",
      ballId: 2316,
    });
    expect(bought.status).toBe(201);
    const sale = await bought.json<SaleBody>();
    const voided = await voidSale(sale.purchase.id, "@SUM(A1)", TOKEN);
    expect(voided.status).toBe(200);
    const offline = await post(
      "/api/admin/offline-sales",
      { email: "plus.export@example.com", buyerName: "+Ada", ballId: 2317, note: "-10" },
      TOKEN,
    );
    expect(offline.status).toBe(201);

    for (const path of [
      "/api/admin/exports/purchases.csv",
      "/api/admin/exports/ball-selections.csv",
      "/api/admin/exports/email-dispatches.csv",
    ]) {
      for (const authorization of [undefined, "Bearer wrong-token"]) {
        const headers: Record<string, string> = {};
        if (authorization) headers.authorization = authorization;
        const denied = await call(path, { headers });
        expect(denied.status, path).toBe(401);
        expect(denied.headers.get("content-type") ?? "").not.toContain("text/csv");
        const text = await denied.text();
        expect(text).not.toContain("formula.export@example.com");
        expect(text).not.toContain("plus.export@example.com");
      }
    }

    const purchases = await call("/api/admin/exports/purchases.csv", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(purchases.status).toBe(200);
    expect(purchases.headers.get("content-type")).toContain("text/csv");
    expect(purchases.headers.get("content-disposition")).toContain('attachment; filename="purchases.csv"');
    const purchaseCsv = await purchases.text();
    expect(purchaseCsv.split("\r\n")[0]).not.toContain('"receipt_token"');
    expect(purchaseCsv).not.toContain(sale.purchase.receiptToken);
    expect(purchaseCsv.split("\r\n")[0]).toContain('"payment_mode"');
    expect(purchaseCsv.split("\r\n")[0]).toContain('"void_status"');
    expect(purchaseCsv.split("\r\n")[0]).toContain('"attested_age_19"');
    expect(purchaseCsv.split("\r\n")[0]).toContain('"attestation_text"');
    const formulaLine = purchaseCsv.split("\r\n").find((line) => line.includes("formula.export@example.com"));
    expect(formulaLine).toContain(`"formula.export@example.com"`);
    expect(formulaLine).not.toContain(`"'formula.export@example.com"`);
    expect(formulaLine).toContain(`"${sale.purchase.id}"`);
    expect(formulaLine).not.toContain(`"'${sale.purchase.id}"`);
    expect(formulaLine).toContain(`"'=1+1"`);
    expect(formulaLine).toContain(`"stripe_test_fake"`);
    expect(formulaLine).toContain(`"voided"`);
    expect(formulaLine).toContain(`"'@SUM(A1)"`);
    expect(formulaLine).toContain(`"buyer"`);
    expect(formulaLine).not.toContain(`"=1+1"`);
    expect(formulaLine).not.toContain(`"@SUM(A1)"`);
    const plusLine = purchaseCsv.split("\r\n").find((line) => line.includes("plus.export@example.com"));
    expect(plusLine).toContain(`"'+Ada"`);
    expect(plusLine).toContain(`"'-10"`);
    expect(plusLine).toContain(`"offline_demo"`);
    expect(plusLine).toContain(`"not_voided"`);
    expect(plusLine).not.toContain(`"+Ada"`);
    expect(plusLine).not.toContain(`"-10"`);
    expect(purchaseCsv).not.toContain(TOKEN);

    const selections = await call("/api/admin/exports/ball-selections.csv", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(selections.status).toBe(200);
    const selectionCsv = await selections.text();
    expect(selectionCsv.split("\r\n")[0]).not.toContain('"receipt_token"');
    expect(selectionCsv).not.toContain(sale.purchase.receiptToken);
    expect(selectionCsv.split("\r\n")[0]).toContain('"purchase_status"');
    expect(selectionCsv.split("\r\n")[0]).toContain('"void_status"');
    const selectionLine = selectionCsv.split("\r\n").find((line) => line.includes("formula.export@example.com"));
    expect(selectionLine).toContain(`"voided"`);
    expect(selectionLine).not.toContain(`"=1+1"`);

    const dispatches = await call("/api/admin/exports/email-dispatches.csv", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(dispatches.status).toBe(200);
    const dispatchCsv = await dispatches.text();
    expect(dispatchCsv.split("\r\n")[0]).toContain('"text_body"');
    const dispatchLine = dispatchCsv.split("\r\n").find((line) => line.includes("formula.export@example.com"));
    expect(dispatchLine).toBeTruthy();
    expect(dispatchLine?.startsWith("=")).toBe(false);
    expect(dispatchLine).toContain("/purchase?token=redacted");
    expect(dispatchCsv).not.toContain(sale.purchase.receiptToken);
    expect(dispatchCsv).not.toContain(TOKEN);
  });

  it("voids an online sale, keeps the purchase, and sells that ball again", async () => {
    const ballId = 2310;
    const sold = await sellOnline(ballId, "void.online@example.com");
    expect(sold.purchase.status).toBe("demo_confirmed");
    expect(sold.purchase.ball.status).toBe("sold");
    expect(await ballStatus(ballId)).toBe("sold");

    const denied = await voidSale(sold.purchase.id, "Recorded on the wrong ball.", null);
    expect(denied.status).toBe(401);
    expect(await ballStatus(ballId)).toBe("sold");
    expect(await auditCount(sold.purchase.id)).toBe(0);

    const missing = await voidSale(sold.purchase.id, "   ", TOKEN);
    expect(missing.status).toBe(400);
    expect(await ballStatus(ballId)).toBe("sold");

    const voided = await voidSale(sold.purchase.id, "Recorded on the wrong ball.", TOKEN);
    expect(voided.status).toBe(200);
    const body = await voided.json<SaleBody>();
    expect(body.purchase.id).toBe(sold.purchase.id);
    expect(body.purchase.status).toBe("voided");
    expect(body.purchase.paymentMode).toBe("stripe_test_fake");
    expect(body.purchase.charged).toBe(false);
    expect(body.purchase.attestation.age19).toBe(true);
    expect(body.purchase.attestation.inBc).toBe(true);
    expect(body.purchase.void).toMatchObject({
      by: "admin-token",
      reason: "Recorded on the wrong ball.",
    });
    expect(body.purchase.ball.status).toBe("available");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(await ballStatus(ballId)).toBe("available");
    expect(await auditCount(sold.purchase.id)).toBe(1);
    const audit = await env.DB.prepare(
      `SELECT purchase_id, ball_id, reason, voided_by, created_at FROM sale_voids WHERE purchase_id = ?`,
    )
      .bind(sold.purchase.id)
      .first<{ purchase_id: string; ball_id: number; reason: string; voided_by: string; created_at: string }>();
    expect(audit).toMatchObject({
      purchase_id: sold.purchase.id,
      ball_id: ballId,
      reason: "Recorded on the wrong ball.",
      voided_by: "admin-token",
    });
    expect(audit?.created_at).toBe(body.purchase.void?.at);

    const kept = await env.DB.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE id = ?`)
      .bind(sold.purchase.id)
      .first<{ n: number }>();
    expect(kept?.n).toBe(1);
    const selections = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ball_selections WHERE purchase_id = ?`)
      .bind(sold.purchase.id)
      .first<{ n: number }>();
    expect(selections?.n).toBe(1);

    const receipt = await call(`/api/purchases?token=${sold.purchase.receiptToken}`);
    expect(receipt.status).toBe(200);
    const viewed = await receipt.json<{
      purchase: { id: string; status: string; void: { at?: string; by?: string; reason: string } | null };
    }>();
    expect(viewed.purchase.id).toBe(sold.purchase.id);
    expect(viewed.purchase.status).toBe("voided");
    expect(viewed.purchase.void?.reason).toBe("Recorded on the wrong ball.");
    expect(viewed.purchase.void?.by).toBeUndefined();

    const listed = await call("/api/admin/selections?email=void.online@example.com", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(listed.status).toBe(200);
    const selectionsBody = await listed.json<{
      selections: Array<{ purchaseId: string; purchaseStatus: string; voidReason: string | null }>;
    }>();
    expect(selectionsBody.selections).toEqual([
      expect.objectContaining({
        purchaseId: sold.purchase.id,
        purchaseStatus: "voided",
        voidReason: "Recorded on the wrong ball.",
      }),
    ]);

    const again = await voidSale(sold.purchase.id, "Once more.", TOKEN);
    expect(again.status).toBe(409);
    expect(await auditCount(sold.purchase.id)).toBe(1);

    const resold = await sellOnline(ballId, "void.resell@example.com");
    expect(resold.purchase.id).not.toBe(sold.purchase.id);
    expect(resold.purchase.status).toBe("demo_confirmed");
    expect(resold.purchase.ball.status).toBe("sold");
    expect(await ballStatus(ballId)).toBe("sold");
    expect(await activeSales(ballId)).toBe(1);
    const stillVoid = await call(`/api/purchases?token=${sold.purchase.receiptToken}`);
    expect(await stillVoid.json()).toMatchObject({ purchase: { status: "voided" } });
  });

  it("voids an offline sale with the Google admin and records it again at the table", async () => {
    const ballId = 2311;
    const recorded = await post(
      "/api/admin/offline-sales",
      { email: "void.table@example.com", buyerName: "Table", ballId, note: "Handed over at the club table." },
      TOKEN,
    );
    expect(recorded.status).toBe(201);
    const sold = await recorded.json<SaleBody>();
    const secret = "test-session-secret";
    const cookie = await signSession(secret, { email: "Club.Admin@Example.com", name: "Club" });
    const voided = await callAs(
      `/api/admin/purchases/${sold.purchase.id}/void`,
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE}=${cookie}`,
          "content-type": "application/json",
          origin: "http://example.com",
        },
        body: JSON.stringify({ reason: "The name on the table slip was wrong." }),
      },
      { ADMIN_EMAILS: "club.admin@example.com", SESSION_SECRET: secret },
    );
    expect(voided.status).toBe(200);
    const body = await voided.json<SaleBody>();
    expect(body.purchase.status).toBe("voided");
    expect(body.purchase.paymentMode).toBe("offline_demo");
    expect(body.purchase.void?.by).toBe("club.admin@example.com");
    expect(body.purchase.void?.reason).toBe("The name on the table slip was wrong.");
    expect(await ballStatus(ballId)).toBe("available");

    const resold = await post(
      "/api/admin/offline-sales",
      { email: "void.table.again@example.com", buyerName: "Next", ballId, note: "Corrected at the table." },
      TOKEN,
    );
    expect(resold.status).toBe(201);
    const next = await resold.json<SaleBody>();
    expect(next.purchase.status).toBe("demo_confirmed");
    expect(next.purchase.ball.status).toBe("sold");
    expect(await activeSales(ballId)).toBe(1);
    const original = await call(`/api/purchases?token=${sold.purchase.receiptToken}`);
    expect(await original.json()).toMatchObject({
      purchase: { status: "voided", paymentMode: "offline_demo" },
    });
  });

  it("puts a voided reservation ball back in the pit so it can be held and paid again", async () => {
    const ballId = 2312;
    const held = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballId }),
    });
    expect(held.status).toBe(201);
    const holdBody = await held.json<{ session: { id: string } }>();
    const cookie = `rob_reservation=${holdBody.session.id}`;
    const paid = await call("/api/reservations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        email: "void.hold@example.com",
        buyerName: "Hold",
        ballIds: [ballId],
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(paid.status).toBe(201);
    const checkout = await paid.json<{ purchases: SaleBody[] }>();
    const purchase = checkout.purchases[0]?.purchase;
    expect(purchase?.status).toBe("demo_confirmed");
    if (!purchase) throw new Error("missing purchase");

    const voided = await voidSale(purchase.id, "They asked to put it back.", TOKEN);
    expect(voided.status).toBe(200);
    expect(await ballStatus(ballId)).toBe("available");
    const owned = await call("/api/reservations", { headers: { cookie } });
    const view = await owned.json<{ owned: Array<{ purchaseId: string }> }>();
    expect(view.owned.find((ball) => ball.purchaseId === purchase.id)).toBeUndefined();

    const again = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballId }),
    });
    expect(again.status).toBe(201);
    const nextHold = await again.json<{ session: { id: string } }>();
    const next = await call("/api/reservations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `rob_reservation=${nextHold.session.id}` },
      body: JSON.stringify({
        email: "void.hold.again@example.com",
        buyerName: "Next",
        ballIds: [ballId],
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(next.status).toBe(201);
    expect(await ballStatus(ballId)).toBe("sold");
    expect(await activeSales(ballId)).toBe(1);
    const receipt = await call(`/api/purchases?token=${purchase.receiptToken}`);
    expect(await receipt.json()).toMatchObject({ purchase: { id: purchase.id, status: "voided" } });
  });

  it("refuses to void a hold that is not a sale", async () => {
    const ballId = 2313;
    const held = await post("/api/selections", { email: "void.pending@example.com", buyerName: "Hold", ballId });
    expect(held.status).toBe(201);
    const body = await held.json<{ purchase: { id: string; status: string } }>();
    expect(body.purchase.status).toBe("demo_pending");
    const voided = await voidSale(body.purchase.id, "Changed their mind.", TOKEN);
    expect(voided.status).toBe(409);
    expect(await ballStatus(ballId)).toBe("selected");
    expect(await auditCount(body.purchase.id)).toBe(0);
  });

  it("lets one of a concurrent void and resale win, and keeps a single audit row", async () => {
    const ballId = 2314;
    const sold = await sellOnline(ballId, "void.race@example.com");
    const [voided, resold] = await Promise.all([
      voidSale(sold.purchase.id, "Two people clicked at once.", TOKEN),
      post("/api/purchases", { email: "void.race.buyer@example.com", buyerName: "Race", ballId }),
    ]);
    expect(voided.status).toBe(200);
    expect([201, 409]).toContain(resold.status);
    expect(await auditCount(sold.purchase.id)).toBe(1);
    const ball = await ballStatus(ballId);
    const active = await activeSales(ballId);
    if (resold.status === 201) {
      expect(ball).toBe("sold");
      expect(active).toBe(1);
      const next = await resold.json<SaleBody>();
      expect(next.purchase.id).not.toBe(sold.purchase.id);
      expect(next.purchase.status).toBe("demo_confirmed");
    } else {
      expect(ball).toBe("available");
      expect(active).toBe(0);
    }
    const original = await call(`/api/purchases?token=${sold.purchase.receiptToken}`);
    expect(await original.json()).toMatchObject({ purchase: { status: "voided" } });

    const [first, second] = await Promise.all([
      voidSale(sold.purchase.id, "Again.", TOKEN),
      voidSale(sold.purchase.id, "And again.", TOKEN),
    ]);
    expect([first.status, second.status].sort()).toEqual([409, 409]);
    expect(await auditCount(sold.purchase.id)).toBe(1);
  });

  it("records one audit row when two voids of the same sale arrive together", async () => {
    const ballId = 2315;
    const sold = await sellOnline(ballId, "void.twice@example.com");
    const [first, second] = await Promise.all([
      voidSale(sold.purchase.id, "First click.", TOKEN),
      voidSale(sold.purchase.id, "Second click.", TOKEN),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await auditCount(sold.purchase.id)).toBe(1);
    expect(await ballStatus(ballId)).toBe("available");
    expect(await activeSales(ballId)).toBe(0);
    const receipt = await call(`/api/purchases?token=${sold.purchase.receiptToken}`);
    expect(await receipt.json()).toMatchObject({ purchase: { status: "voided" } });
  });
});
