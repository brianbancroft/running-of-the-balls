import type { AppConfig } from "./config";
import { HttpError } from "./http";
import type { ConfirmedPurchase, SaleAttestation } from "./purchase-engine";
import { sellFromReservation } from "./purchase-engine";

export const RESERVATION_COOKIE = "rob_reservation";
export const HOLD_WINDOW_MS = 5 * 60 * 1000;

export type HoldState = "pending_payment" | "confirmed" | "released" | "expired";
export type SessionStatus = "open" | "completed" | "expired";

export type ReservationHoldView = {
  id: string;
  ballId: number;
  ballNumber: number;
  state: HoldState;
  createdAt: string;
  expiresAt: string;
};

export type ReservationSessionView = {
  id: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
};

export type ReservationView = {
  session: ReservationSessionView | null;
  holds: ReservationHoldView[];
};

type SessionRow = {
  id: string;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
};

type HoldRow = {
  id: string;
  ball_id: number;
  ball_number: number;
  state: HoldState;
  created_at: string;
  expires_at: string;
};

function changed(result: D1Result): number {
  return result.meta.changes ?? 0;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function toSession(row: SessionRow): ReservationSessionView {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toHold(row: HoldRow): ReservationHoldView {
  return {
    id: row.id,
    ballId: row.ball_id,
    ballNumber: row.ball_number,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function deleteEmptySession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM reservation_sessions
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM ball_holds WHERE session_id = ?)`,
    )
    .bind(sessionId, sessionId)
    .run();
}

function isOpen(session: SessionRow, nowIso: string): boolean {
  return session.status === "open" && session.expires_at > nowIso;
}

async function loadSession(db: D1Database, sessionId: string): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, status, created_at, expires_at
       FROM reservation_sessions
       WHERE id = ?`,
    )
    .bind(sessionId)
    .first<SessionRow>();
}

async function pendingHolds(db: D1Database, sessionId: string): Promise<HoldRow[]> {
  const result = await db
    .prepare(
      `SELECT h.id, h.ball_id, b.ball_number, h.state, h.created_at, h.expires_at
       FROM ball_holds h
       JOIN balls b ON b.id = h.ball_id
       WHERE h.session_id = ? AND h.state = 'pending_payment'
       ORDER BY h.created_at ASC, b.ball_number ASC`,
    )
    .bind(sessionId)
    .all<HoldRow>();
  return result.results;
}

async function viewFor(db: D1Database, sessionId: string | null, nowIso: string): Promise<ReservationView> {
  if (!sessionId) return { session: null, holds: [] };
  const session = await loadSession(db, sessionId);
  if (!session) return { session: null, holds: [] };
  if (!isOpen(session, nowIso)) return { session: toSession(session), holds: [] };
  const holds = await pendingHolds(db, sessionId);
  return { session: toSession(session), holds: holds.map(toHold) };
}

export async function expireDueHolds(db: D1Database, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const due = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM ball_holds
       WHERE state = 'pending_payment' AND expires_at <= ?`,
    )
    .bind(nowIso)
    .first<{ n: number }>();
  await db.batch([
    db
      .prepare(
        `UPDATE balls
         SET status = 'available'
         WHERE status = 'selected'
           AND id IN (
             SELECT ball_id FROM ball_holds
             WHERE state = 'pending_payment' AND expires_at <= ?
           )`,
      )
      .bind(nowIso),
    db
      .prepare(
        `UPDATE ball_holds
         SET state = 'expired', released_at = ?
         WHERE state = 'pending_payment' AND expires_at <= ?`,
      )
      .bind(nowIso, nowIso),
    db
      .prepare(
        `UPDATE reservation_sessions
         SET status = 'expired'
         WHERE status = 'open' AND expires_at <= ?`,
      )
      .bind(nowIso),
  ]);
  return due?.n ?? 0;
}

export async function reservationForSession(
  db: D1Database,
  sessionId: string | null,
  now = new Date(),
): Promise<ReservationView> {
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  return viewFor(db, sessionId, nowIso);
}

export async function holdForSession(
  db: D1Database,
  sessionId: string | null,
  ballId: number,
  now = new Date(),
): Promise<ReservationView & { hold: ReservationHoldView }> {
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  const ball = await db
    .prepare(`SELECT id, status FROM balls WHERE id = ?`)
    .bind(ballId)
    .first<{ id: number; status: string }>();
  if (!ball) throw new HttpError(404, "That ball does not exist.");

  let session = sessionId ? await loadSession(db, sessionId) : null;
  if (session && !isOpen(session, nowIso)) session = null;

  if (session) {
    const existing = (await pendingHolds(db, session.id)).find((hold) => hold.ball_id === ballId);
    if (existing) {
      const view = await viewFor(db, session.id, nowIso);
      return { ...view, hold: toHold(existing) };
    }
  }

  const nextSessionId = session?.id ?? crypto.randomUUID();
  const createdAt = session?.created_at ?? nowIso;
  const expiresAt = session?.expires_at ?? new Date(now.getTime() + HOLD_WINDOW_MS).toISOString();
  const holdId = crypto.randomUUID();
  const creating = session == null;
  if (creating) {
    await db
      .prepare(
        `INSERT INTO reservation_sessions (id, created_at, expires_at, status)
         VALUES (?, ?, ?, 'open')`,
      )
      .bind(nextSessionId, createdAt, expiresAt)
      .run();
  }

  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(`UPDATE balls SET status = 'selected' WHERE id = ? AND status = 'available'`).bind(ballId),
      db
        .prepare(
          `INSERT INTO ball_holds (id, session_id, ball_id, state, created_at, expires_at)
           SELECT ?, ?, ?, 'pending_payment', ?, ?
           WHERE changes() = 1`,
        )
        .bind(holdId, nextSessionId, ballId, nowIso, expiresAt),
    ]);
  } catch (error) {
    if (creating) await deleteEmptySession(db, nextSessionId);
    if (isConstraint(error)) throw new HttpError(409, "That ball is already held or recorded.");
    throw error;
  }
  const ballUpdate = results[0];
  const holdInsert = results[1];
  if (!ballUpdate || !holdInsert || changed(ballUpdate) !== 1 || changed(holdInsert) !== 1) {
    if (creating) await deleteEmptySession(db, nextSessionId);
    throw new HttpError(409, "That ball is already held or recorded.");
  }

  const view = await viewFor(db, nextSessionId, nowIso);
  const hold = view.holds.find((item) => item.id === holdId);
  if (!view.session || !hold) throw new HttpError(500, "Could not record the hold.");
  return { ...view, hold };
}

export async function releaseForSession(
  db: D1Database,
  sessionId: string | null,
  ballId: number,
  now = new Date(),
): Promise<ReservationView> {
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  if (!sessionId) return { session: null, holds: [] };
  const session = await loadSession(db, sessionId);
  if (!session || !isOpen(session, nowIso)) return viewFor(db, sessionId, nowIso);
  await db.batch([
    db
      .prepare(
        `UPDATE ball_holds
         SET state = 'released', released_at = ?
         WHERE session_id = ? AND ball_id = ? AND state = 'pending_payment'`,
      )
      .bind(nowIso, sessionId, ballId),
    db
      .prepare(
        `UPDATE balls
         SET status = 'available'
         WHERE id = ? AND status = 'selected' AND changes() = 1`,
      )
      .bind(ballId),
  ]);
  return viewFor(db, sessionId, nowIso);
}

export async function checkoutReservation(
  db: D1Database,
  sessionId: string | null,
  input: {
    email: string;
    buyerName: string | null;
    ballIds: number[];
    attestation: SaleAttestation;
  },
  config: AppConfig,
  origin: string,
  now = new Date(),
): Promise<{
  purchases: ConfirmedPurchase[];
  released: Array<{ ballId: number; ballNumber: number }>;
}> {
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  if (!sessionId) throw new HttpError(409, "Choose a ball before paying.");
  const session = await loadSession(db, sessionId);
  if (!session || !isOpen(session, nowIso)) {
    throw new HttpError(409, "Your five minutes ran out. Those balls are back in the pit.");
  }
  const holds = await pendingHolds(db, sessionId);
  const byBall = new Map(holds.map((hold) => [hold.ball_id, hold]));
  for (const ballId of input.ballIds) {
    if (!byBall.has(ballId)) throw new HttpError(409, "Those balls are not held for this checkout.");
  }

  const purchases: ConfirmedPurchase[] = [];
  for (const ballId of input.ballIds) {
    const hold = byBall.get(ballId);
    if (!hold) throw new HttpError(409, "Those balls are not held for this checkout.");
    const sold = await sellFromReservation(
      db,
      {
        holdId: hold.id,
        sessionId,
        ballId,
        email: input.email,
        buyerName: input.buyerName,
        attestation: input.attestation,
        now: nowIso,
      },
      config,
      origin,
    );
    if (!sold) throw new HttpError(409, "That hold changed before payment.");
    purchases.push(sold);
  }

  const paid = new Set(input.ballIds);
  const released = holds
    .filter((hold) => !paid.has(hold.ball_id))
    .map((hold) => ({ ballId: hold.ball_id, ballNumber: hold.ball_number }));
  if (released.length > 0) {
    await db.batch([
      db
        .prepare(
          `UPDATE balls
           SET status = 'available'
           WHERE status = 'selected'
             AND id IN (
               SELECT ball_id FROM ball_holds
               WHERE session_id = ? AND state = 'pending_payment'
             )`,
        )
        .bind(sessionId),
      db
        .prepare(
          `UPDATE ball_holds
           SET state = 'released', released_at = ?
           WHERE session_id = ? AND state = 'pending_payment'`,
        )
        .bind(nowIso, sessionId),
    ]);
  }
  await db
    .prepare(`UPDATE reservation_sessions SET status = 'completed' WHERE id = ? AND status = 'open'`)
    .bind(sessionId)
    .run();
  return { purchases, released };
}
