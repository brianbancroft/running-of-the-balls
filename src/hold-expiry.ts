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
