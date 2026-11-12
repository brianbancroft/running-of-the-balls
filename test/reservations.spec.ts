import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { HOLD_WINDOW_MS } from "../src/reservations";

const WINDOW_MS = HOLD_WINDOW_MS;

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function cookieHeader(response: Response, fallback?: string): string {
  const fromBody = fallback ?? "";
  const set = response.headers.get("set-cookie") ?? "";
  const pair = set.split(";")[0] ?? "";
  if (pair.startsWith("rob_reservation=")) return pair;
  return fromBody;
}

async function reserve(ballId: number, cookie = ""): Promise<{
  status: number;
  cookie: string;
  body: {
    error?: string;
    hold?: {
      id: string;
      ballId: number;
      ballNumber: number;
      state: string;
      createdAt: string;
      expiresAt: string;
    };
    session: { id: string; status: string; createdAt: string; expiresAt: string } | null;
    holds: Array<{ ballId: number; state: string; createdAt: string; expiresAt: string }>;
  };
}> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await call("/api/reservations", {
    method: "POST",
    headers,
    body: JSON.stringify({ ballId }),
  });
  const body = await response.json<{
    error?: string;
    hold?: {
      id: string;
      ballId: number;
      ballNumber: number;
      state: string;
      createdAt: string;
      expiresAt: string;
    };
    session: { id: string; status: string; createdAt: string; expiresAt: string } | null;
    holds: Array<{ ballId: number; state: string; createdAt: string; expiresAt: string }>;
  }>();
  const next = body.session ? `rob_reservation=${body.session.id}` : cookieHeader(response, cookie);
  return { status: response.status, cookie: next, body };
}

async function ballStatus(ballId: number): Promise<string | undefined> {
  const response = await call("/api/balls");
  const body = await response.json<{ balls: Array<{ id: number; status: string }> }>();
  return body.balls.find((ball) => ball.id === ballId)?.status;
}

async function holdRow(ballId: number): Promise<{ state: string; expires_at: string; created_at: string } | null> {
  return env.DB.prepare(
    `SELECT state, expires_at, created_at FROM ball_holds WHERE ball_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(ballId)
    .first<{ state: string; expires_at: string; created_at: string }>();
}

describe("reservation holds", () => {
  it("holds a ball as pending payment and starts a five-minute window", async () => {
    const held = await reserve(2410);
    expect(held.status).toBe(201);
    expect(held.body.hold?.state).toBe("pending_payment");
    expect(held.body.hold?.ballNumber).toBe(2410);
    expect(held.body.session?.status).toBe("open");
    expect(held.body.hold?.createdAt).toBe(held.body.session?.createdAt);
    expect(held.body.hold?.expiresAt).toBe(held.body.session?.expiresAt);
    expect(Date.parse(held.body.session?.expiresAt ?? "") - Date.parse(held.body.session?.createdAt ?? "")).toBe(
      WINDOW_MS,
    );
    expect(await ballStatus(2410)).toBe("selected");
    const row = await holdRow(2410);
    expect(row?.state).toBe("pending_payment");
    expect(row?.expires_at).toBe(held.body.session?.expiresAt);

    const again = await reserve(2410, held.cookie);
    expect(again.status).toBe(201);
    expect(again.body.hold?.id).toBe(held.body.hold?.id);
    expect(again.body.hold?.expiresAt).toBe(held.body.session?.expiresAt);
  });

  it("shares the first ball's deadline with later holds, even after that deadline is shortened", async () => {
    const first = await reserve(2411);
    expect(first.status).toBe(201);
    const sessionId = first.body.session?.id;
    const shortened = new Date(Date.now() + 90_000).toISOString();
    await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`)
      .bind(shortened, sessionId)
      .run();
    await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ? AND state = 'pending_payment'`)
      .bind(shortened, sessionId)
      .run();

    const second = await reserve(2412, first.cookie);
    expect(second.status).toBe(201);
    expect(second.body.session?.id).toBe(sessionId);
    expect(second.body.hold?.expiresAt).toBe(shortened);
    expect(second.body.holds.map((hold) => hold.expiresAt)).toEqual([shortened, shortened]);
    expect(Date.parse(second.body.hold?.expiresAt ?? "") - Date.parse(second.body.hold?.createdAt ?? "")).toBeLessThan(
      WINDOW_MS,
    );

    const released = await call("/api/reservations/release", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: first.cookie },
      body: JSON.stringify({ ballId: 2411 }),
    });
    expect(released.status).toBe(200);
    expect(await ballStatus(2411)).toBe("available");
    const third = await reserve(2413, first.cookie);
    expect(third.status).toBe(201);
    expect(third.body.session?.id).toBe(sessionId);
    expect(third.body.hold?.expiresAt).toBe(shortened);
  });

  it("refuses a second buyer while the hold is pending payment", async () => {
    const held = await reserve(2414);
    expect(held.status).toBe(201);
    const other = await reserve(2414);
    expect(other.status).toBe(409);

    const purchased = await call("/api/purchases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "other.buyer@example.com",
        buyerName: "Other",
        ballId: 2414,
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(purchased.status).toBe(409);

    const offline = await call("/api/admin/offline-sales", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
      body: JSON.stringify({
        email: "table.hold@example.com",
        buyerName: "Table",
        ballId: 2414,
        note: "Should wait.",
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(offline.status).toBe(409);
    expect(await ballStatus(2414)).toBe("selected");
    expect((await holdRow(2414))?.state).toBe("pending_payment");
  });

  it("converts the paid holds and releases the ones left in the reservation", async () => {
    const first = await reserve(2415);
    const second = await reserve(2416, first.cookie);
    const third = await reserve(2417, first.cookie);
    expect(third.status).toBe(201);

    const paid = await call("/api/reservations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: first.cookie },
      body: JSON.stringify({
        email: "payer.holds@example.com",
        buyerName: "Payer",
        ballIds: [2415, 2416],
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(paid.status).toBe(201);
    const body = await paid.json<{
      purchases: Array<{
        purchase: { status: string; charged: boolean; stripeTestReference: string; ball: { id: number; status: string } };
      }>;
      released: Array<{ ballId: number }>;
    }>();
    expect(body.purchases.map((item) => item.purchase.ball.id).sort()).toEqual([2415, 2416]);
    for (const item of body.purchases) {
      expect(item.purchase.status).toBe("demo_confirmed");
      expect(item.purchase.charged).toBe(false);
      expect(item.purchase.stripeTestReference.startsWith("cs_test_fake_")).toBe(true);
      expect(item.purchase.ball.status).toBe("sold");
    }
    expect(body.released).toEqual([{ ballId: 2417, ballNumber: 2417 }]);
    expect(await ballStatus(2415)).toBe("sold");
    expect(await ballStatus(2416)).toBe("sold");
    expect(await ballStatus(2417)).toBe("available");
    expect((await holdRow(2415))?.state).toBe("confirmed");
    expect((await holdRow(2417))?.state).toBe("released");
    const session = await env.DB.prepare(`SELECT status FROM reservation_sessions WHERE id = ?`)
      .bind(first.body.session?.id)
      .first<{ status: string }>();
    expect(session?.status).toBe("completed");

    const past = "2020-01-01T00:00:00.000Z";
    await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE ball_id IN (2415, 2416, 2417)`).bind(past).run();
    expect(await ballStatus(2415)).toBe("sold");
    expect(await ballStatus(2416)).toBe("sold");
    expect((await holdRow(2415))?.state).toBe("confirmed");
    expect(second.status).toBe(201);
  });

  it("expires every pending hold when the shared window passes, including from the schedule", async () => {
    const first = await reserve(2418);
    await reserve(2419, first.cookie);
    const past = "2020-01-01T00:00:00.000Z";
    await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`)
      .bind(past, first.body.session?.id)
      .run();
    await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ?`)
      .bind(past, first.body.session?.id)
      .run();

    expect(await ballStatus(2418)).toBe("available");
    expect(await ballStatus(2419)).toBe("available");
    expect((await holdRow(2418))?.state).toBe("expired");
    expect((await holdRow(2419))?.state).toBe("expired");
    const session = await env.DB.prepare(`SELECT status FROM reservation_sessions WHERE id = ?`)
      .bind(first.body.session?.id)
      .first<{ status: string }>();
    expect(session?.status).toBe("expired");
    expect((await reserve(2418)).status).toBe(201);

    const scheduledHold = await reserve(2420);
    await reserve(2421, scheduledHold.cookie);
    await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`)
      .bind(past, scheduledHold.body.session?.id)
      .run();
    await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ?`)
      .bind(past, scheduledHold.body.session?.id)
      .run();
    const ctx = createExecutionContext();
    await worker.scheduled?.(
      { scheduledTime: Date.now(), cron: "* * * * *" } as ScheduledController,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const afterSchedule = await env.DB.prepare(
      `SELECT b.status AS ball_status, h.state
       FROM ball_holds h
       JOIN balls b ON b.id = h.ball_id
       WHERE h.session_id = ? AND h.ball_id = 2421`,
    )
      .bind(scheduledHold.body.session?.id)
      .first<{ ball_status: string; state: string }>();
    expect(afterSchedule).toEqual({ ball_status: "available", state: "expired" });
    const seeded = await env.DB.prepare(`SELECT status FROM balls WHERE id = 6`).first<{ status: string }>();
    expect(seeded?.status).toBe("selected");
  });

  it("does not confirm a reservation after the window has lapsed", async () => {
    const held = await reserve(2422);
    const past = "2020-01-01T00:00:00.000Z";
    await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`)
      .bind(past, held.body.session?.id)
      .run();
    await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ?`)
      .bind(past, held.body.session?.id)
      .run();

    const paid = await call("/api/reservations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: held.cookie },
      body: JSON.stringify({
        email: "late.payer@example.com",
        buyerName: "Late",
        ballIds: [2422],
        attestAge19: true,
        attestInBc: true,
      }),
    });
    expect(paid.status).toBe(409);
    expect(await ballStatus(2422)).toBe("available");
    expect((await holdRow(2422))?.state).toBe("expired");
    const purchase = await env.DB.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE buyer_email = ?`)
      .bind("late.payer@example.com")
      .first<{ n: number }>();
    expect(purchase?.n).toBe(0);
  });
});
