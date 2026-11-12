import type { AppConfig } from "./config";
import { assertPaymentsAllowed } from "./config";
import type { EmailDeliveryResult } from "./email/deliver";
import { planEmailDelivery, previewResult, sendSelectionReceipt } from "./email/deliver";
import { buildSelectionReceipt } from "./email/receipt";
import { HttpError } from "./http";
import { logError } from "./log";
import { buildDemoPayment } from "./payments/stripe-test";

export type BallStatus = "available" | "selected" | "sold";
export type PurchaseStatus = "demo_pending" | "demo_confirmed" | "cancelled";
export type PaymentMode = "stripe_test_fake" | "offline_demo";

export type Ball = {
  id: number;
  ballNumber: number;
  label: string;
  color: string;
  status: BallStatus;
};

export type PurchaseRecord = {
  id: string;
  status: PurchaseStatus;
  paymentMode: PaymentMode;
  charged: false;
  amountCents: number;
  currency: "CAD";
  stripeTestReference: string | null;
  offlineNote: string | null;
  buyerEmail: string;
  buyerName: string | null;
  selectionId: string;
  ball: Ball;
  createdAt: string;
  updatedAt: string;
};

export type SelectionRecord = {
  id: string;
  email: string;
  ballId: number;
  ballNumber: number;
  label: string;
  color: string;
  ballStatus: BallStatus;
  purchaseId: string;
  purchaseStatus: PurchaseStatus;
  createdAt: string;
};

type BallRow = {
  id: number;
  ball_number: number;
  label: string;
  color: string;
  status: BallStatus;
};

type JoinedRow = {
  purchase_id: string;
  buyer_email: string;
  buyer_name: string | null;
  purchase_status: PurchaseStatus;
  payment_mode: PaymentMode;
  stripe_test_reference: string | null;
  offline_note: string | null;
  amount_cents: number;
  currency: "CAD";
  purchase_created_at: string;
  purchase_updated_at: string;
  selection_id: string;
  selection_email: string;
  selection_created_at: string;
  ball_id: number;
  ball_number: number;
  label: string;
  color: string;
  ball_status: BallStatus;
};

type DispatchRow = {
  id: string;
  mode: "dry_run" | "resend";
  status: "previewed" | "sent" | "failed";
  idempotency_key: string;
  provider_message_id: string | null;
  error: string | null;
};

const JOINED = `
  SELECT
    p.id AS purchase_id,
    p.buyer_email,
    p.buyer_name,
    p.status AS purchase_status,
    p.payment_mode,
    p.stripe_test_reference,
    p.offline_note,
    p.amount_cents,
    p.currency,
    p.created_at AS purchase_created_at,
    p.updated_at AS purchase_updated_at,
    s.id AS selection_id,
    s.email AS selection_email,
    s.created_at AS selection_created_at,
    b.id AS ball_id,
    b.ball_number,
    b.label,
    b.color,
    b.status AS ball_status
  FROM purchases p
  JOIN ball_selections s ON s.purchase_id = p.id
  JOIN balls b ON b.id = s.ball_id
`;

function changed(result: D1Result): number {
  return result.meta.changes ?? 0;
}

function mapBall(row: BallRow): Ball {
  return {
    id: row.id,
    ballNumber: row.ball_number,
    label: row.label,
    color: row.color,
    status: row.status,
  };
}

function ballFromJoined(row: JoinedRow): Ball {
  return {
    id: row.ball_id,
    ballNumber: row.ball_number,
    label: row.label,
    color: row.color,
    status: row.ball_status,
  };
}

export function toPurchase(row: JoinedRow): PurchaseRecord {
  return {
    id: row.purchase_id,
    status: row.purchase_status,
    paymentMode: row.payment_mode,
    charged: false,
    amountCents: row.amount_cents,
    currency: "CAD",
    stripeTestReference: row.stripe_test_reference,
    offlineNote: row.offline_note,
    buyerEmail: row.buyer_email,
    buyerName: row.buyer_name,
    selectionId: row.selection_id,
    ball: ballFromJoined(row),
    createdAt: row.purchase_created_at,
    updatedAt: row.purchase_updated_at,
  };
}

export function toSelection(row: JoinedRow): SelectionRecord {
  return {
    id: row.selection_id,
    email: row.selection_email,
    ballId: row.ball_id,
    ballNumber: row.ball_number,
    label: row.label,
    color: row.color,
    ballStatus: row.ball_status,
    purchaseId: row.purchase_id,
    purchaseStatus: row.purchase_status,
    createdAt: row.selection_created_at,
  };
}

export async function listBalls(db: D1Database): Promise<Ball[]> {
  const result = await db
    .prepare(
      `SELECT id, ball_number, label, color, status
       FROM balls
       ORDER BY ball_number ASC`,
    )
    .all<BallRow>();
  return result.results.map(mapBall);
}

export async function listPurchasesForEmail(
  db: D1Database,
  email: string,
): Promise<PurchaseRecord[]> {
  const result = await db
    .prepare(`${JOINED} WHERE p.buyer_email = ? ORDER BY p.created_at DESC`)
    .bind(email)
    .all<JoinedRow>();
  return result.results.map(toPurchase);
}

export async function listSelectionsForEmail(
  db: D1Database,
  email: string,
): Promise<SelectionRecord[]> {
  const result = await db
    .prepare(`${JOINED} WHERE s.email = ? ORDER BY s.created_at ASC, b.ball_number ASC`)
    .bind(email)
    .all<JoinedRow>();
  return result.results.map(toSelection);
}

export async function listRecentSales(db: D1Database): Promise<PurchaseRecord[]> {
  const result = await db
    .prepare(`${JOINED} ORDER BY p.created_at DESC LIMIT 100`)
    .all<JoinedRow>();
  return result.results.map(toPurchase);
}

async function loadPurchase(db: D1Database, purchaseId: string): Promise<JoinedRow | null> {
  return db.prepare(`${JOINED} WHERE p.id = ?`).bind(purchaseId).first<JoinedRow>();
}

async function getBall(db: D1Database, ballId: number): Promise<Ball | null> {
  const row = await db
    .prepare(`SELECT id, ball_number, label, color, status FROM balls WHERE id = ?`)
    .bind(ballId)
    .first<BallRow>();
  return row ? mapBall(row) : null;
}

async function chooseBall(
  db: D1Database,
  ballId: number | undefined,
  config: AppConfig,
): Promise<number> {
  if (config.allowBallPicking) {
    if (ballId == null) throw new HttpError(400, "Choose a ball.");
    return ballId;
  }
  if (ballId != null) {
    throw new HttpError(400, "Choosing a specific ball is turned off for this demo.");
  }
  const row = await db
    .prepare(
      `SELECT id FROM balls WHERE status = 'available' ORDER BY ball_number ASC LIMIT 1`,
    )
    .first<{ id: number }>();
  if (!row) throw new HttpError(409, "Every ball is already held or recorded.");
  return row.id;
}

async function tryHold(
  db: D1Database,
  ballId: number,
  input: { email: string; buyerName: string | null },
  config: AppConfig,
): Promise<PurchaseRecord | null> {
  const purchaseId = crypto.randomUUID();
  const selectionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(`UPDATE balls SET status = 'selected' WHERE id = ? AND status = 'available'`)
      .bind(ballId),
    db
      .prepare(
        `INSERT INTO purchases (
           id, buyer_email, buyer_name, status, payment_mode,
           stripe_test_reference, offline_note, amount_cents, currency, demo_only,
           created_at, updated_at
         )
         SELECT ?, ?, ?, 'demo_pending', 'stripe_test_fake', NULL, NULL, ?, 'CAD', 1, ?, ?
         WHERE changes() = 1`,
      )
      .bind(purchaseId, input.email, input.buyerName, config.amountCents, now, now),
    db
      .prepare(
        `INSERT INTO ball_selections (id, ball_id, email, purchase_id, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(selectionId, ballId, input.email, purchaseId, now),
  ]);
  const ballUpdate = results[0];
  const purchaseInsert = results[1];
  const selectionInsert = results[2];
  if (!ballUpdate || !purchaseInsert || !selectionInsert) {
    throw new HttpError(500, "Could not record the selection.");
  }
  if (changed(ballUpdate) !== 1) return null;
  if (changed(purchaseInsert) !== 1 || changed(selectionInsert) !== 1) {
    await db
      .prepare(`UPDATE balls SET status = 'available' WHERE id = ? AND status = 'selected'`)
      .bind(ballId)
      .run();
    logError({ message: "hold rolled back after a partial write", ballId });
    throw new HttpError(500, "Could not record the selection.");
  }
  const row = await loadPurchase(db, purchaseId);
  if (!row) throw new HttpError(500, "Could not record the selection.");
  return toPurchase(row);
}

export async function holdBall(
  db: D1Database,
  input: { email: string; buyerName: string | null; ballId: number | undefined },
  config: AppConfig,
): Promise<PurchaseRecord> {
  assertPaymentsAllowed(config);
  const attempts = config.allowBallPicking ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ballId = await chooseBall(db, input.ballId, config);
    const held = await tryHold(db, ballId, input, config);
    if (held) return held;
    if (config.allowBallPicking) {
      throw new HttpError(409, "That ball is already held or recorded.");
    }
  }
  throw new HttpError(409, "Every ball is already held or recorded.");
}

function receiptFor(row: JoinedRow, config: AppConfig) {
  const reference =
    row.stripe_test_reference ??
    (row.payment_mode === "offline_demo" ? "offline demo record" : "demo record");
  return buildSelectionReceipt({
    to: row.buyer_email,
    from: config.emailFrom,
    buyerName: row.buyer_name,
    ballNumber: row.ball_number,
    ballLabel: row.label,
    purchaseId: row.purchase_id,
    selectionId: row.selection_id,
    reference,
    amountCents: row.amount_cents,
    kind: row.payment_mode === "offline_demo" ? "offline_demo" : "online_demo",
  });
}

async function loadDispatch(db: D1Database, purchaseId: string): Promise<DispatchRow | null> {
  return db
    .prepare(
      `SELECT id, mode, status, idempotency_key, provider_message_id, error
       FROM email_dispatches
       WHERE purchase_id = ?`,
    )
    .bind(purchaseId)
    .first<DispatchRow>();
}

function deliveryFromDispatch(
  dispatch: DispatchRow,
  receipt: ReturnType<typeof buildSelectionReceipt>,
  reason: string | null,
): EmailDeliveryResult {
  return {
    mode: dispatch.mode,
    status: dispatch.status,
    sent: dispatch.status === "sent",
    idempotencyKey: dispatch.idempotency_key,
    providerMessageId: dispatch.provider_message_id,
    error: dispatch.error,
    reason,
    preview: {
      to: receipt.to,
      from: receipt.from,
      subject: receipt.subject,
      text: receipt.text,
    },
  };
}

async function finishEmail(
  db: D1Database,
  row: JoinedRow,
  config: AppConfig,
): Promise<EmailDeliveryResult> {
  const receipt = receiptFor(row, config);
  const plan = planEmailDelivery({
    delivery: config.emailDelivery,
    apiKey: config.resendApiKey,
  });
  const dispatch = await loadDispatch(db, row.purchase_id);
  if (!dispatch) return previewResult(receipt, plan);
  if (dispatch.status !== "previewed" || dispatch.mode !== "resend" || !plan.shouldSend) {
    return deliveryFromDispatch(dispatch, receipt, plan.reason);
  }
  const apiKey = config.resendApiKey;
  if (!apiKey) return deliveryFromDispatch(dispatch, receipt, plan.reason);
  const sent = await sendSelectionReceipt(receipt, apiKey);
  await db
    .prepare(
      `UPDATE email_dispatches
       SET status = ?, provider_message_id = ?, error = ?
       WHERE id = ?`,
    )
    .bind(sent.status, sent.providerMessageId, sent.error, dispatch.id)
    .run();
  return sent;
}

export type ConfirmedPurchase = {
  purchase: PurchaseRecord;
  email: EmailDeliveryResult;
};

async function requireOwnedPurchase(
  db: D1Database,
  purchaseId: string,
  email: string,
): Promise<JoinedRow> {
  const row = await loadPurchase(db, purchaseId);
  if (!row || row.buyer_email !== email) {
    throw new HttpError(404, "Purchase not found.");
  }
  return row;
}

export async function confirmDemoPurchase(
  db: D1Database,
  purchaseId: string,
  email: string,
  config: AppConfig,
): Promise<ConfirmedPurchase> {
  assertPaymentsAllowed(config);
  const current = await requireOwnedPurchase(db, purchaseId, email);
  if (current.purchase_status === "cancelled") {
    throw new HttpError(409, "This hold was cancelled.");
  }
  if (current.purchase_status === "demo_confirmed") {
    return { purchase: toPurchase(current), email: await finishEmail(db, current, config) };
  }
  if (current.ball_status !== "selected" || current.payment_mode !== "stripe_test_fake") {
    throw new HttpError(409, "This hold cannot be confirmed.");
  }

  let payment;
  try {
    payment = buildDemoPayment({
      paymentMode: config.paymentMode,
      stripeSecretKey: config.stripeSecretKey,
      purchaseId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment refused.";
    throw new HttpError(403, message);
  }

  const plan = planEmailDelivery({
    delivery: config.emailDelivery,
    apiKey: config.resendApiKey,
  });
  const receipt = buildSelectionReceipt({
    to: email,
    from: config.emailFrom,
    buyerName: current.buyer_name,
    ballNumber: current.ball_number,
    ballLabel: current.label,
    purchaseId,
    selectionId: current.selection_id,
    reference: payment.stripeTestReference,
    amountCents: current.amount_cents,
    kind: "online_demo",
  });
  const now = new Date().toISOString();
  const dispatchId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET status = 'demo_confirmed', stripe_test_reference = ?, updated_at = ?
         WHERE id = ?
           AND buyer_email = ?
           AND status = 'demo_pending'
           AND payment_mode = 'stripe_test_fake'
           AND demo_only = 1
           AND offline_note IS NULL
           AND EXISTS (
             SELECT 1
             FROM ball_selections s
             JOIN balls b ON b.id = s.ball_id
             WHERE s.purchase_id = purchases.id
               AND s.email = purchases.buyer_email
               AND b.status = 'selected'
           )`,
      )
      .bind(payment.stripeTestReference, now, purchaseId, email),
    db
      .prepare(
        `UPDATE balls
         SET status = 'sold'
         WHERE id = (
           SELECT ball_id FROM ball_selections WHERE purchase_id = ? AND email = ?
         )
           AND status = 'selected'
           AND changes() = 1`,
      )
      .bind(purchaseId, email),
    db
      .prepare(
        `INSERT INTO email_dispatches (
           id, purchase_id, selection_id, to_email, mode, status,
           idempotency_key, provider_message_id, error, created_at
         )
         SELECT ?, ?, ?, ?, ?, 'previewed', ?, NULL, NULL, ?
         WHERE changes() = 1`,
      )
      .bind(
        dispatchId,
        purchaseId,
        current.selection_id,
        email,
        plan.mode,
        receipt.idempotencyKey,
        now,
      ),
  ]);
  const purchaseUpdate = results[0];
  const ballUpdate = results[1];
  const dispatchInsert = results[2];
  if (!purchaseUpdate || !ballUpdate || !dispatchInsert) {
    throw new HttpError(500, "Could not confirm this hold.");
  }
  if (changed(purchaseUpdate) !== 1) {
    const again = await requireOwnedPurchase(db, purchaseId, email);
    if (again.purchase_status === "demo_confirmed") {
      return { purchase: toPurchase(again), email: await finishEmail(db, again, config) };
    }
    throw new HttpError(409, "This hold cannot be confirmed.");
  }
  if (changed(ballUpdate) !== 1 || changed(dispatchInsert) !== 1) {
    logError({ message: "confirm wrote an incomplete demo purchase", purchaseId });
    throw new HttpError(500, "Could not confirm this hold.");
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not confirm this hold.");
  return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config) };
}

export async function cancelHold(
  db: D1Database,
  purchaseId: string,
  email: string,
): Promise<PurchaseRecord> {
  const current = await requireOwnedPurchase(db, purchaseId, email);
  if (current.purchase_status === "demo_confirmed") {
    throw new HttpError(409, "A confirmed demo record stays on the ball.");
  }
  if (current.purchase_status === "cancelled") return toPurchase(current);
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET status = 'cancelled', updated_at = ?
         WHERE id = ?
           AND buyer_email = ?
           AND status = 'demo_pending'
           AND payment_mode = 'stripe_test_fake'`,
      )
      .bind(now, purchaseId, email),
    db
      .prepare(
        `UPDATE balls
         SET status = 'available'
         WHERE id = (
           SELECT ball_id FROM ball_selections WHERE purchase_id = ? AND email = ?
         )
           AND status = 'selected'
           AND changes() = 1`,
      )
      .bind(purchaseId, email),
  ]);
  const purchaseUpdate = results[0];
  const ballUpdate = results[1];
  if (!purchaseUpdate || !ballUpdate) throw new HttpError(500, "Could not cancel this hold.");
  if (changed(purchaseUpdate) === 1 && changed(ballUpdate) !== 1) {
    await db
      .prepare(`UPDATE balls SET status = 'available' WHERE id = ? AND status = 'selected'`)
      .bind(current.ball_id)
      .run();
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not cancel this hold.");
  return toPurchase(saved);
}

export async function recordOfflineSale(
  db: D1Database,
  input: { email: string; buyerName: string | null; ballId: number; note: string },
  config: AppConfig,
): Promise<ConfirmedPurchase> {
  assertPaymentsAllowed(config);
  const ball = await getBall(db, input.ballId);
  if (!ball) throw new HttpError(404, "That ball does not exist.");
  if (ball.status === "selected") {
    throw new HttpError(409, "That ball is held. Cancel the hold before an offline demo record.");
  }
  if (ball.status === "sold") throw new HttpError(409, "That ball is already recorded.");

  const purchaseId = crypto.randomUUID();
  const selectionId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const plan = planEmailDelivery({
    delivery: config.emailDelivery,
    apiKey: config.resendApiKey,
  });
  const receipt = buildSelectionReceipt({
    to: input.email,
    from: config.emailFrom,
    buyerName: input.buyerName,
    ballNumber: ball.ballNumber,
    ballLabel: ball.label,
    purchaseId,
    selectionId,
    reference: "offline demo record",
    amountCents: config.amountCents,
    kind: "offline_demo",
  });
  const results = await db.batch([
    db
      .prepare(`UPDATE balls SET status = 'sold' WHERE id = ? AND status = 'available'`)
      .bind(input.ballId),
    db
      .prepare(
        `INSERT INTO purchases (
           id, buyer_email, buyer_name, status, payment_mode,
           stripe_test_reference, offline_note, amount_cents, currency, demo_only,
           created_at, updated_at
         )
         SELECT ?, ?, ?, 'demo_confirmed', 'offline_demo', NULL, ?, ?, 'CAD', 1, ?, ?
         WHERE changes() = 1`,
      )
      .bind(purchaseId, input.email, input.buyerName, input.note, config.amountCents, now, now),
    db
      .prepare(
        `INSERT INTO ball_selections (id, ball_id, email, purchase_id, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(selectionId, input.ballId, input.email, purchaseId, now),
    db
      .prepare(
        `INSERT INTO email_dispatches (
           id, purchase_id, selection_id, to_email, mode, status,
           idempotency_key, provider_message_id, error, created_at
         )
         SELECT ?, ?, ?, ?, ?, 'previewed', ?, NULL, NULL, ?
         WHERE changes() = 1`,
      )
      .bind(
        dispatchId,
        purchaseId,
        selectionId,
        input.email,
        plan.mode,
        receipt.idempotencyKey,
        now,
      ),
  ]);
  const ballUpdate = results[0];
  const purchaseInsert = results[1];
  const selectionInsert = results[2];
  const dispatchInsert = results[3];
  if (!ballUpdate || !purchaseInsert || !selectionInsert || !dispatchInsert) {
    throw new HttpError(500, "Could not record the offline demo sale.");
  }
  if (changed(ballUpdate) !== 1) {
    throw new HttpError(409, "That ball is already held or recorded.");
  }
  if (
    changed(purchaseInsert) !== 1 ||
    changed(selectionInsert) !== 1 ||
    changed(dispatchInsert) !== 1
  ) {
    await db
      .prepare(`UPDATE balls SET status = 'available' WHERE id = ? AND status = 'sold'`)
      .bind(input.ballId)
      .run();
    logError({ message: "offline sale rolled back after a partial write", ballId: input.ballId });
    throw new HttpError(500, "Could not record the offline demo sale.");
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not record the offline demo sale.");
  return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config) };
}
