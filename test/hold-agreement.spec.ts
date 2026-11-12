import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { customerHoldSummary, marqueeNumbers } from "../src/client/format";
import worker from "../src/index";
import { HOLD_WINDOW_MS } from "../src/reservations";

async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function reserve(ballId: number, cookie = ""): Promise<{
  status: number;
  cookie: string;
  body: {
    session: { id: string; status: string; expiresAt: string; remainingMs: number } | null;
    holds: Array<{ ballId: number; state: string; expiresAt: string }>;
    owned: Array<{ ballId: number; ballNumber: number; receiptToken: string }>;
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
    session: { id: string; status: string; expiresAt: string; remainingMs: number } | null;
    holds: Array<{ ballId: number; state: string; expiresAt: string }>;
    owned: Array<{ ballId: number; ballNumber: number; receiptToken: string }>;
  }>();
  const next = body.session ? `rob_reservation=${body.session.id}` : cookie;
  return { status: response.status, cookie: next, body };
}

async function view(cookie = ""): Promise<{
  session: { id: string; status: string; expiresAt: string; remainingMs: number } | null;
  holds: Array<{ ballId: number; ballNumber: number; state: string; expiresAt: string }>;
  owned: Array<{ ballId: number; ballNumber: number; purchaseId: string; receiptToken: string }>;
}> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const response = await call("/api/reservations", { headers });
  expect(response.status).toBe(200);
  return response.json();
}

async function ballStatus(ballId: number): Promise<string | undefined> {
  const response = await call("/api/balls");
  const body = await response.json<{ balls: Array<{ id: number; status: string }> }>();
  return body.balls.find((ball) => ball.id === ballId)?.status;
}

async function lapse(sessionId: string): Promise<void> {
  const past = "2020-01-01T00:00:00.000Z";
  await env.DB.prepare(`UPDATE reservation_sessions SET expires_at = ? WHERE id = ?`).bind(past, sessionId).run();
  await env.DB.prepare(`UPDATE ball_holds SET expires_at = ? WHERE session_id = ?`).bind(past, sessionId).run();
}

function checkout(cookie: string, email: string, ballIds: number[]): Promise<Response> {
  return call("/api/reservations/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      email,
      buyerName: "Buyer",
      ballIds,
      attestAge19: true,
      attestInBc: true,
    }),
  });
}

function offline(email: string, ballId: number): Promise<Response> {
  return call("/api/admin/offline-sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-admin-token",
    },
    body: JSON.stringify({
      email,
      buyerName: "Table",
      ballId,
      note: "Club table.",
      attestAge19: true,
      attestInBc: true,
    }),
  });
}

describe("holds agree with every path that takes a ball", () => {
  it("refuses an offline sale of a live hold and records one after the hold expires", async () => {
    const held = await reserve(2431);
    expect(held.status).toBe(201);
    const refused = await offline("table.live@example.com", 2431);
    expect(refused.status).toBe(409);
    expect(await ballStatus(2431)).toBe("selected");
    const pending = await env.DB.prepare(
      `SELECT state FROM ball_holds WHERE ball_id = 2431 AND state = 'pending_payment'`,
    ).first<{ state: string }>();
    expect(pending?.state).toBe("pending_payment");

    const sessionId = held.body.session?.id;
    expect(sessionId).toBeTruthy();
    await lapse(sessionId ?? "");
    const [late, recorded] = await Promise.all([
      checkout(held.cookie, "late.hold@example.com", [2431]),
      offline("table.expired@example.com", 2431),
    ]);
    expect(late.status).toBe(409);
    expect(recorded.status).toBe(201);
    const body = await recorded.json<{
      purchase: { paymentMode: string; charged: boolean; ball: { id: number; status: string } };
      email: { sent: boolean; mode: string };
    }>();
    expect(body.purchase.paymentMode).toBe("offline_demo");
    expect(body.purchase.charged).toBe(false);
    expect(body.purchase.ball).toMatchObject({ id: 2431, status: "sold" });
    expect(body.email.sent).toBe(false);
    expect(body.email.mode).toBe("dry_run");
    expect(await ballStatus(2431)).toBe("sold");
    const owners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 2431`).first<{
      n: number;
    }>();
    expect(owners?.n).toBe(1);
    const mail = await env.DB.prepare(
      `SELECT ball_id, to_email, subject FROM email_dispatches WHERE ball_id = 2431`,
    ).first<{ ball_id: number; to_email: string; subject: string }>();
    expect(mail).toMatchObject({
      ball_id: 2431,
      to_email: "table.expired@example.com",
    });
    expect(mail?.subject).toContain("2431");
    const hold = await env.DB.prepare(
      `SELECT state FROM ball_holds WHERE ball_id = 2431 ORDER BY created_at DESC LIMIT 1`,
    ).first<{ state: string }>();
    expect(hold?.state).toBe("expired");
  });

  it("lets only one of two concurrent holds succeed", async () => {
    const [first, second] = await Promise.all([reserve(2430), reserve(2430)]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ball_holds WHERE ball_id = 2430 AND state = 'pending_payment'`,
    ).first<{ n: number }>();
    expect(pending?.n).toBe(1);
    expect(await ballStatus(2430)).toBe("selected");
    const selections = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 2430`).first<{
      n: number;
    }>();
    expect(selections?.n).toBe(0);
  });

  it("lets only one of an online checkout and an offline sale lock the same ball", async () => {
    const held = await reserve(2432);
    expect(held.status).toBe(201);
    const [paid, table] = await Promise.all([
      checkout(held.cookie, "race.checkout@example.com", [2432]),
      offline("race.table@example.com", 2432),
    ]);
    expect([paid.status, table.status].sort()).toEqual([201, 409]);
    expect(await ballStatus(2432)).toBe("sold");
    const owners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ball_selections WHERE ball_id = 2432`).first<{
      n: number;
    }>();
    expect(owners?.n).toBe(1);
    const purchases = await env.DB.prepare(
      `SELECT p.payment_mode, p.status
       FROM purchases p
       JOIN ball_selections s ON s.purchase_id = p.id
       WHERE s.ball_id = 2432`,
    ).all<{ payment_mode: string; status: string }>();
    expect(purchases.results).toEqual([{ payment_mode: "stripe_test_fake", status: "demo_confirmed" }]);
  });

  it("stores each selected ball on the email row for online checkout and offline sales", async () => {
    const first = await reserve(2443);
    const second = await reserve(2444, first.cookie);
    expect(second.status).toBe(201);
    const paid = await checkout(first.cookie, "both.email@example.com", [2443, 2444]);
    expect(paid.status).toBe(201);
    const online = await env.DB.prepare(
      `SELECT ball_id, subject FROM email_dispatches WHERE to_email = ? ORDER BY ball_id`,
    )
      .bind("both.email@example.com")
      .all<{ ball_id: number; subject: string }>();
    expect(online.results.map((row) => row.ball_id)).toEqual([2443, 2444]);
    expect(online.results[0]?.subject).toContain("2443");
    expect(online.results[1]?.subject).toContain("2444");
    const selected = await env.DB.prepare(
      `SELECT ball_id FROM ball_selections WHERE email = ? ORDER BY ball_id`,
    )
      .bind("both.email@example.com")
      .all<{ ball_id: number }>();
    expect(selected.results.map((row) => row.ball_id)).toEqual([2443, 2444]);

    const recorded = await offline("table.mail@example.com", 2445);
    expect(recorded.status).toBe(201);
    const mail = await env.DB.prepare(
      `SELECT d.ball_id, d.subject, s.ball_id AS selection_ball
       FROM email_dispatches d
       JOIN ball_selections s ON s.id = d.selection_id
       WHERE d.to_email = ?`,
    )
      .bind("table.mail@example.com")
      .first<{ ball_id: number; subject: string; selection_ball: number }>();
    expect(mail).toMatchObject({ ball_id: 2445, selection_ball: 2445 });
    expect(mail?.subject).toContain("2445");
  });

  it("shows confirmed balls and the time left, and omits expired and released holds", async () => {
    const first = await reserve(2440);
    const second = await reserve(2441, first.cookie);
    expect(second.status).toBe(201);
    const open = await view(first.cookie);
    expect(open.holds.map((hold) => hold.ballId).sort()).toEqual([2440, 2441]);
    expect(open.holds.every((hold) => hold.state === "pending_payment")).toBe(true);
    expect(open.holds.every((hold) => hold.expiresAt === open.session?.expiresAt)).toBe(true);
    expect(open.owned).toEqual([]);
    expect(open.session?.status).toBe("open");
    expect(open.session?.remainingMs).toBeGreaterThan(0);
    expect(open.session?.remainingMs).toBeLessThanOrEqual(HOLD_WINDOW_MS);
    const openSummary = customerHoldSummary(open);
    expect(openSummary.pending.map((hold) => hold.ballId).sort()).toEqual([2440, 2441]);
    expect(openSummary.confirmed).toEqual([]);
    expect(openSummary.remainingMs).toBe(open.session?.remainingMs);

    const stranger = await view();
    expect(stranger.session).toBeNull();
    expect(stranger.holds).toEqual([]);
    expect(stranger.owned).toEqual([]);

    const released = await call("/api/reservations/release", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: first.cookie },
      body: JSON.stringify({ ballId: 2441 }),
    });
    expect(released.status).toBe(200);
    const afterRelease = await view(first.cookie);
    expect(afterRelease.holds.map((hold) => hold.ballId)).toEqual([2440]);
    expect(afterRelease.owned).toEqual([]);
    expect(afterRelease.holds.some((hold) => hold.ballId === 2441)).toBe(false);
    expect(await ballStatus(2441)).toBe("available");

    const paid = await checkout(first.cookie, "owned.view@example.com", [2440]);
    expect(paid.status).toBe(201);
    const afterPay = await view(first.cookie);
    expect(afterPay.holds).toEqual([]);
    expect(afterPay.session?.status).toBe("completed");
    expect(afterPay.session?.remainingMs).toBe(0);
    expect(afterPay.owned).toEqual([
      expect.objectContaining({ ballId: 2440, ballNumber: 2440, receiptToken: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    const paidSummary = customerHoldSummary(afterPay);
    expect(paidSummary.pending).toEqual([]);
    expect(paidSummary.confirmed.map((ball) => ball.ballId)).toEqual([2440]);
    expect(paidSummary.remainingMs).toBe(0);
    const token = afterPay.owned[0]?.receiptToken ?? "";
    const receipt = await call(`/api/purchases?token=${token}`);
    expect(receipt.status).toBe(200);
    const receiptBody = await receipt.json<{ purchase: { status: string; ball: { ballNumber: number; status: string } } }>();
    expect(receiptBody.purchase.status).toBe("demo_confirmed");
    expect(receiptBody.purchase.ball).toMatchObject({ ballNumber: 2440, status: "sold" });
    const mailed = await env.DB.prepare(`SELECT ball_id FROM email_dispatches WHERE to_email = ?`)
      .bind("owned.view@example.com")
      .first<{ ball_id: number }>();
    expect(mailed?.ball_id).toBe(2440);
    const releasedMail = await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_dispatches WHERE ball_id = 2441`).first<{
      n: number;
    }>();
    expect(releasedMail?.n).toBe(0);

    const late = await reserve(2442);
    expect(late.body.session?.id).toBeTruthy();
    await lapse(late.body.session?.id ?? "");
    const expired = await view(late.cookie);
    expect(expired.holds).toEqual([]);
    expect(expired.owned).toEqual([]);
    expect(expired.session?.status).toBe("expired");
    expect(expired.session?.remainingMs).toBe(0);
    expect(customerHoldSummary(expired)).toEqual({ confirmed: [], pending: [], remainingMs: 0 });
    expect(await ballStatus(2442)).toBe("available");
  });

  it("does not present expired or released holds as owned", () => {
    const summary = customerHoldSummary({
      session: { status: "open", remainingMs: 90_000 },
      holds: [
        { ballId: 1, ballNumber: 1, state: "pending_payment", expiresAt: "2099-01-01T00:00:00.000Z" },
        { ballId: 2, ballNumber: 2, state: "expired", expiresAt: "2020-01-01T00:00:00.000Z" },
        { ballId: 3, ballNumber: 3, state: "released", expiresAt: "2099-01-01T00:00:00.000Z" },
        { ballId: 4, ballNumber: 4, state: "confirmed", expiresAt: "2099-01-01T00:00:00.000Z" },
      ],
      owned: [{ ballId: 4, ballNumber: 4, receiptToken: "ab".repeat(32) }],
    });
    expect(summary.pending).toEqual([
      { ballId: 1, ballNumber: 1, expiresAt: "2099-01-01T00:00:00.000Z" },
    ]);
    expect(summary.confirmed).toEqual([{ ballId: 4, ballNumber: 4, receiptToken: "ab".repeat(32) }]);
    expect(summary.remainingMs).toBe(90_000);
    expect(
      customerHoldSummary({
        session: { status: "expired", remainingMs: 10 },
        holds: [],
        owned: [],
      }).remainingMs,
    ).toBe(0);
  });

  it("shades held and sold balls in the pit and returns an expired hold to available", async () => {
    const held = await reserve(2448);
    expect(held.status).toBe(201);
    expect(await ballStatus(2448)).toBe("selected");
    const whileHeld = marqueeNumbers(
      [
        { ballNumber: 2448, status: "selected" },
        { ballNumber: 3, status: "sold" },
        { ballNumber: 1, status: "available" },
      ],
      2,
      7,
    );
    expect(new Set(whileHeld)).toEqual(new Set([2448, 3]));

    await lapse(held.body.session?.id ?? "");
    expect(await ballStatus(2448)).toBe("available");
    const catalogue = await call("/api/balls");
    const balls = await catalogue.json<{ balls: Array<{ ballNumber: number; status: string }> }>();
    expect(balls.balls.find((ball) => ball.ballNumber === 2448)?.status).toBe("available");
    expect(balls.balls.find((ball) => ball.ballNumber === 3)?.status).toBe("sold");
    expect(balls.balls.find((ball) => ball.ballNumber === 6)?.status).toBe("selected");
    const after = marqueeNumbers(
      [
        { ballNumber: 2448, status: "available" },
        { ballNumber: 3, status: "sold" },
        { ballNumber: 6, status: "selected" },
        { ballNumber: 1, status: "available" },
      ],
      2,
      11,
    );
    expect(new Set(after)).toEqual(new Set([3, 6]));
    expect(after).not.toContain(2448);
  });
});
