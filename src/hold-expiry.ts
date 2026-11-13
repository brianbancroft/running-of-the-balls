import { HOLD_WINDOW_MS } from "./hold-limits";

export async function expireDueHolds(db: D1Database, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const optionalCutoff = new Date(now.getTime() - HOLD_WINDOW_MS).toISOString();
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
         SET status = 'expired', client_key = NULL
         WHERE status = 'open' AND expires_at <= ?`,
      )
      .bind(nowIso),
    db
      .prepare(
        `UPDATE balls
         SET status = 'available'
         WHERE status = 'selected'
           AND id IN (
             SELECT s.ball_id
             FROM ball_selections s
             JOIN purchases p ON p.id = s.purchase_id
             WHERE p.status = 'demo_pending'
               AND p.client_key IS NOT NULL
               AND p.created_at <= ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM ball_holds h
             WHERE h.ball_id = balls.id
               AND h.state = 'pending_payment'
               AND h.expires_at > ?
           )`,
      )
      .bind(optionalCutoff, nowIso),
    db
      .prepare(
        `UPDATE purchases
         SET status = 'cancelled', updated_at = ?, client_key = NULL
         WHERE status = 'demo_pending'
           AND client_key IS NOT NULL
           AND created_at <= ?`,
      )
      .bind(nowIso, optionalCutoff),
  ]);
  return due?.n ?? 0;
}
