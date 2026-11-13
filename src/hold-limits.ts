import { HttpError } from "./http";

export const HOLD_WINDOW_MS = 5 * 60 * 1000;

// Unpaid balls only. Checkout and direct purchase are not limited.
export const MAX_PENDING_HOLDS_PER_RESERVATION = 40;
export const MAX_PENDING_HOLDS_PER_CLIENT = 120;

const ADDRESS = /^[0-9a-fA-F:.]+$/;

export async function clientHoldKey(address: string | undefined): Promise<string | null> {
  const ip = address?.trim() ?? "";
  if (!ip || ip.length > 64 || !ADDRESS.test(ip)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rob-hold-v1:${ip}`));
  const bytes = new Uint8Array(digest).subarray(0, 8);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function reservationHoldLimitMessage(): string {
  return `This checkout already holds ${MAX_PENDING_HOLDS_PER_RESERVATION} unpaid balls. Pay for them or release one before holding more.`;
}

export function clientHoldLimitMessage(): string {
  return "Too many balls are held unpaid from this network. Pay, release, or wait five minutes. You can still buy as many balls as you want.";
}

export async function pendingHoldsForClient(db: D1Database, clientKey: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
         (
           SELECT COUNT(*)
           FROM ball_holds h
           JOIN reservation_sessions s ON s.id = h.session_id
           WHERE s.client_key = ? AND h.state = 'pending_payment'
         ) + (
           SELECT COUNT(*)
           FROM purchases
           WHERE client_key = ? AND status = 'demo_pending'
         ) AS n`,
    )
    .bind(clientKey, clientKey)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function assertClientHoldRoom(db: D1Database, clientKey: string): Promise<void> {
  const pending = await pendingHoldsForClient(db, clientKey);
  if (pending >= MAX_PENDING_HOLDS_PER_CLIENT) {
    throw new HttpError(429, clientHoldLimitMessage());
  }
}
