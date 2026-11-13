import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { clientHoldKey, MAX_PENDING_HOLDS_PER_CLIENT, MAX_PENDING_HOLDS_PER_RESERVATION } from "../src/hold-limits";
import { logInfo } from "../src/log";
import { SESSION_COOKIE, signSession } from "../src/session";
import worker from "../src/index";

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

describe("admin cookie actions", () => {
  it("refuses a Google admin mutation from another site and accepts the same site", async () => {
    const secret = "test-session-secret";
    const session = await signSession(secret, { email: "Club.Admin@Example.com", name: "Club" });
    const bindings = { ADMIN_EMAILS: "club.admin@example.com", SESSION_SECRET: secret };
    const sold = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "csrf.buyer@example.com",
        buyerName: "Ada",
        ballId: 1502,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(sold.status).toBe(201);
    const purchase = await sold.json<{ purchase: { id: string } }>();
    const cookie = `${SESSION_COOKIE}=${session}`;

    const missingOrigin = await callAs(
      `/api/admin/purchases/${purchase.purchase.id}/void`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Wrong ball." }),
      },
      bindings,
    );
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toMatchObject({
      error: "This action has to come from the same site.",
    });

    const otherSite = await callAs(
      `/api/admin/purchases/${purchase.purchase.id}/void`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ reason: "Wrong ball." }),
      },
      bindings,
    );
    expect(otherSite.status).toBe(403);

    const sameSiteSibling = await callAs(
      `/api/admin/purchases/${purchase.purchase.id}/void`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "https://other.bancroft.io",
          "sec-fetch-site": "same-site",
        },
        body: JSON.stringify({ reason: "Wrong ball." }),
      },
      bindings,
    );
    expect(sameSiteSibling.status).toBe(403);
    const stillSold = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1502`).first<{ status: string }>();
    expect(stillSold?.status).toBe("sold");

    const offline = await callAs(
      "/api/admin/offline-sales",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          email: "csrf.table@example.com",
          buyerName: "Table",
          ballId: 1503,
          note: "Should not record.",
          attestAge19: true,
          attestInBc: true,
        }),
      },
      bindings,
    );
    expect(offline.status).toBe(403);
    const untouched = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1503`).first<{ status: string }>();
    expect(untouched?.status).toBe("available");

    const sameOrigin = await callAs(
      `/api/admin/purchases/${purchase.purchase.id}/void`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "http://example.com",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ reason: "Wrong ball." }),
      },
      bindings,
    );
    expect(sameOrigin.status).toBe(200);
    const freed = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1502`).first<{ status: string }>();
    expect(freed?.status).toBe("available");

    const bearer = await call("/api/admin/offline-sales", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "csrf.bearer@example.com",
        buyerName: "Token",
        ballId: 1503,
        note: "Bearer clients do not send a browser origin.",
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(bearer.status).toBe(201);
  });

  it("refuses a cross-site sign-out and still clears a same-site session", async () => {
    const secret = "test-session-secret";
    const session = await signSession(secret, { email: "club.admin@example.com", name: null });
    const cookie = `${SESSION_COOKIE}=${session}`;
    const blocked = await call("/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE}=`);

    const signedOut = await call("/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "http://example.com" },
    });
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("set-cookie")?.toLowerCase()).toContain(`${SESSION_COOKIE}=`);
  });

  it("tells a browser not to send a referrer or frame the pages", async () => {
    const purchase = await call("/purchase?token=390822ccb06855179424236c3774f960118070866e3030acb0808837a6ca55d3");
    expect(purchase.headers.get("referrer-policy")).toBe("no-referrer");
    expect(purchase.headers.get("x-frame-options")).toBe("DENY");
    expect(purchase.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const api = await call("/api/config");
    expect(api.headers.get("referrer-policy")).toBe("no-referrer");
    expect(api.headers.get("cache-control")).toContain("no-store");
    expect(api.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("request boundaries", () => {
  it("drops a receipt token before writing a log line", () => {
    const token = "ab".repeat(32);
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      logInfo({ message: "demo", receiptUrl: `http://example.com/purchase?token=${token}` });
      const written = spy.mock.calls.flat().join(" ");
      expect(written).not.toContain(token);
      expect(written).toContain("[redacted]");
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a non-JSON admin or purchase body and a body over the limit", async () => {
    const plain = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        email: "plain.body@example.com",
        ballId: 1340,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(plain.status).toBe(415);
    const declared = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20001" },
      body: JSON.stringify({
        email: "declared.body@example.com",
        ballId: 1340,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(declared.status).toBe(413);
    const huge = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballId: 1340, padding: "x".repeat(20_000) }),
    });
    expect(huge.status).toBe(413);
    const typed = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        email: "charset.body@example.com",
        buyerName: "Ada",
        ballId: 1341,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(typed.status).toBe(201);
    const untouched = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1340`).first<{ status: string }>();
    expect(untouched?.status).toBe("available");
  });
});

describe("unpaid hold limits", () => {
  it("limits unpaid balls in one reservation and still allows another purchase after checkout", async () => {
    let cookie = "";
    const firstBall = 1100;
    for (let offset = 0; offset < MAX_PENDING_HOLDS_PER_RESERVATION; offset += 1) {
      const held = await call("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ ballId: firstBall + offset }),
      });
      expect(held.status, `ball ${firstBall + offset}`).toBe(201);
      const body = await held.json<{ session: { id: string } }>();
      cookie = `rob_reservation=${body.session.id}`;
    }
    const blocked = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ballId: firstBall + MAX_PENDING_HOLDS_PER_RESERVATION }),
    });
    expect(blocked.status).toBe(429);
    const again = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ballId: firstBall }),
    });
    expect(again.status).toBe(201);

    const ballIds = Array.from({ length: MAX_PENDING_HOLDS_PER_RESERVATION }, (_, offset) => firstBall + offset);
    const paid = await call("/api/reservations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        email: "cap.buyer@example.com",
        buyerName: "Cap",
        ballIds,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(paid.status).toBe(201);
    const next = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ballId: firstBall + MAX_PENDING_HOLDS_PER_RESERVATION }),
    });
    expect(next.status).toBe(201);
  }, 30_000);

  it("limits unpaid balls per network and releases an optional hold after five minutes", async () => {
    const address = "203.0.113.44";
    const key = await clientHoldKey(address);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO reservation_sessions (id, created_at, expires_at, status, client_key)
       VALUES (?, ?, ?, 'open', ?)`,
    )
      .bind(sessionId, now, expires, key)
      .run();
    for (let offset = 0; offset < MAX_PENDING_HOLDS_PER_CLIENT; offset += 1) {
      const ballId = 1200 + offset;
      await env.DB.batch([
        env.DB.prepare(`UPDATE balls SET status = 'selected' WHERE id = ? AND status = 'available'`).bind(ballId),
        env.DB.prepare(
          `INSERT INTO ball_holds (id, session_id, ball_id, state, created_at, expires_at)
           VALUES (?, ?, ?, 'pending_payment', ?, ?)`,
        ).bind(crypto.randomUUID(), sessionId, ballId, now, expires),
      ]);
    }

    const blocked = await call("/api/selections", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": address },
      body: JSON.stringify({ email: "network.hold@example.com", buyerName: "Net", ballId: 1330 }),
    });
    expect(blocked.status).toBe(429);
    const otherNetwork = await call("/api/reservations", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.45" },
      body: JSON.stringify({ ballId: 1331 }),
    });
    expect(otherNetwork.status).toBe(201);

    await env.DB.prepare(`UPDATE ball_holds SET state = 'released', released_at = ? WHERE ball_id = ?`)
      .bind(now, 1200)
      .run();
    await env.DB.prepare(`UPDATE balls SET status = 'available' WHERE id = 1200`).run();
    const allowed = await call("/api/selections", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": address },
      body: JSON.stringify({ email: "network.hold@example.com", buyerName: "Net", ballId: 1330 }),
    });
    expect(allowed.status).toBe(201);
    const held = await allowed.json<{ purchase: { id: string; status: string } }>();
    expect(held.purchase.status).toBe("demo_pending");
    await env.DB.prepare(`UPDATE purchases SET created_at = ? WHERE id = ?`)
      .bind("2020-01-01T00:00:00.000Z", held.purchase.id)
      .run();
    const swept = await call("/api/balls", { headers: { "cf-connecting-ip": address } });
    expect(swept.status).toBe(200);
    const balls = await swept.json<{ balls: Array<{ id: number; status: string }> }>();
    expect(balls.balls.find((ball) => ball.id === 1330)?.status).toBe("available");
    expect(balls.balls.find((ball) => ball.id === 6)?.status).toBe("selected");
    const purchase = await env.DB.prepare(`SELECT status, client_key FROM purchases WHERE id = ?`)
      .bind(held.purchase.id)
      .first<{ status: string; client_key: string | null }>();
    expect(purchase).toEqual({ status: "cancelled", client_key: null });
  }, 30_000);
});

describe("purchase paths", () => {
  it("holds, expires, checks out, rejects a second buy, voids, and hides the other buyer", async () => {
    const logs: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      log(...args);
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      err(...args);
    };
    try {
      const first = await call("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ballId: 1400 }),
      });
      expect(first.status).toBe(201);
      const firstBody = await first.json<{ session: { id: string } }>();
      const cookie = `rob_reservation=${firstBody.session.id}`;
      const rival = await call("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ballId: 1400 }),
      });
      expect(rival.status).toBe(409);
      const offline = await call("/api/admin/offline-sales", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          email: "path.table@example.com",
          buyerName: "Table",
          ballId: 1400,
          note: "Should wait for the hold.",
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(offline.status).toBe(409);
      const early = await call("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "path.early@example.com",
          buyerName: "Early",
          ballId: 1400,
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(early.status).toBe(409);

      const past = "2020-01-01T00:00:00.000Z";
      await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`)
        .bind(past, firstBody.session.id)
        .run();
      await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ?`)
        .bind(past, firstBody.session.id)
        .run();
      const late = await call("/api/reservations/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          email: "path.late@example.com",
          buyerName: "Late",
          ballIds: [1400],
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(late.status).toBe(409);
      const expiredView = await call("/api/reservations", { headers: { cookie } });
      const expired = await expiredView.json<{ holds: unknown[]; owned: unknown[] }>();
      expect(expired.holds).toEqual([]);
      expect(expired.owned).toEqual([]);

      const second = await call("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ballId: 1400 }),
      });
      expect(second.status).toBe(201);
      const secondBody = await second.json<{ session: { id: string } }>();
      const payer = `rob_reservation=${secondBody.session.id}`;
      const paid = await call("/api/reservations/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: payer },
        body: JSON.stringify({
          email: "path.payer@example.com",
          buyerName: "Payer",
          ballIds: [1400],
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(paid.status).toBe(201);
      const paidBody = await paid.json<{
        purchases: Array<{ purchase: { receiptToken: string; buyerEmail: string; ball: { ballNumber: number } } }>;
      }>();
      const token = paidBody.purchases[0]?.purchase.receiptToken ?? "";
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const again = await call("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "path.other@example.com",
          buyerName: "Other",
          ballId: 1400,
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(again.status).toBe(409);
      const other = await call("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "path.other@example.com",
          buyerName: "Other",
          ballId: 1401,
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(other.status).toBe(201);
      const otherBody = await other.json<{ purchase: { receiptToken: string } }>();

      const receipt = await call(`/api/purchases?token=${token}`);
      expect(receipt.status).toBe(200);
      const receiptText = await receipt.text();
      expect(receiptText).toContain("path.payer@example.com");
      expect(receiptText).toContain('"ballNumber":1400');
      expect(receiptText).not.toContain("path.other@example.com");
      expect(receiptText).not.toContain(otherBody.purchase.receiptToken);
      expect(receiptText).not.toContain('"ballNumber":1401');
      const byEmail = await call("/api/purchases?email=path.other@example.com");
      expect(byEmail.status).toBe(400);
      expect(await byEmail.text()).not.toContain("path.other@example.com");
      const mine = await call("/api/reservations", { headers: { cookie: payer } });
      const mineText = await mine.text();
      expect(mineText).toContain('"ballNumber":1400');
      expect(mineText).not.toContain("path.other@example.com");
      expect(mineText).not.toContain('"ballNumber":1401');
      expect(logs.join("\n")).not.toContain(token);
      expect(logs.join("\n")).not.toContain(otherBody.purchase.receiptToken);

      const purchaseId = await env.DB.prepare(
        `SELECT id FROM purchases WHERE buyer_email = ? AND status = 'demo_confirmed'`,
      )
        .bind("path.payer@example.com")
        .first<{ id: string }>();
      const voided = await call(`/api/admin/purchases/${purchaseId?.id}/void`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ reason: "Recorded on the wrong ball." }),
      });
      expect(voided.status).toBe(200);
      const back = await env.DB.prepare(`SELECT status FROM balls WHERE id = 1400`).first<{ status: string }>();
      expect(back?.status).toBe("available");
      const recorded = await call("/api/admin/offline-sales", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          email: "path.table@example.com",
          buyerName: "Table",
          ballId: 1400,
          note: "Recorded after the void.",
          attestAge19: true,
          attestInBc: true,
        }),
      });
      expect(recorded.status).toBe(201);
      const stillTheirs = await call(`/api/purchases?token=${token}`);
      const stillText = await stillTheirs.text();
      expect(stillText).toContain('"status":"voided"');
      expect(stillText).not.toContain("path.table@example.com");
    } finally {
      console.log = log;
      console.error = err;
    }
  });
});
