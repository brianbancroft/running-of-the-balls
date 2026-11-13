import type { AppConfig } from "./config";
import { assertPaymentsAllowed } from "./config";
import { expireDueHolds } from "./hold-expiry";
import { assertClientHoldRoom } from "./hold-limits";
import type { EmailDeliveryResult } from "./email/deliver";
import { planEmailDelivery, previewResult, sendSelectionReceipt } from "./email/deliver";
import { buildSelectionReceipt, receiptLink } from "./email/receipt";
import { HttpError } from "./http";
import { logError } from "./log";
import { buildDemoPayment } from "./payments/stripe-test";

export type BallStatus = "available" | "selected" | "sold";
export type PurchaseStatus = "demo_pending" | "demo_confirmed" | "cancelled" | "voided";
export type PaymentMode = "stripe_test_fake" | "offline_demo";

export type AttestationRecord = {
  age19: boolean;
  inBc: boolean;
  at: string | null;
  by: "buyer" | "admin" | null;
  text: string | null;
};

export type SaleAttestation = {
  by: "buyer" | "admin";
  text: string;
};

export type Ball = {
  id: number;
  ballNumber: number;
  label: string;
  color: string;
  status: BallStatus;
};

export type SaleVoid = {
  at: string;
  by: string;
  reason: string;
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
  receiptToken: string;
  attestation: AttestationRecord;
  selectionId: string;
  ball: Ball;
  emailRecord: StoredEmail | null;
  void: SaleVoid | null;
  createdAt: string;
  updatedAt: string;
};

export type BuyerPurchase = Omit<PurchaseRecord, "void"> & {
  void: { at: string; reason: string } | null;
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
  receiptToken: string;
  emailRecord: StoredEmail | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  createdAt: string;
};

export type StoredEmail = {
  id: string;
  subject: string;
  text: string | null;
  status: "previewed" | "sent" | "failed";
  sent: boolean;
  mode: "dry_run" | "resend";
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
  receipt_token: string;
  attested_age_19: number;
  attested_in_bc: number;
  attested_at: string | null;
  attested_by: "buyer" | "admin" | null;
  attestation_text: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  selection_id: string;
  selection_email: string;
  selection_created_at: string;
  ball_id: number;
  ball_number: number;
  label: string;
  color: string;
  ball_status: BallStatus;
  email_id: string | null;
  email_subject: string | null;
  email_status: "previewed" | "sent" | "failed" | null;
  email_mode: "dry_run" | "resend" | null;
  email_text: string | null;
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
    p.receipt_token,
    p.attested_age_19,
    p.attested_in_bc,
    p.attested_at,
    p.attested_by,
    p.attestation_text,
    p.voided_at,
    p.void_reason,
    p.voided_by,
    s.id AS selection_id,
    s.email AS selection_email,
    s.created_at AS selection_created_at,
    b.id AS ball_id,
    b.ball_number,
    b.label,
    b.color,
    b.status AS ball_status,
    (
      SELECT d.id FROM email_dispatches d
      WHERE d.selection_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) AS email_id,
    (
      SELECT d.subject FROM email_dispatches d
      WHERE d.selection_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) AS email_subject,
    (
      SELECT d.status FROM email_dispatches d
      WHERE d.selection_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) AS email_status,
    (
      SELECT d.mode FROM email_dispatches d
      WHERE d.selection_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) AS email_mode,
    (
      SELECT d.text_body FROM email_dispatches d
      WHERE d.selection_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) AS email_text
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

function emailFromRow(row: JoinedRow): StoredEmail | null {
  if (!row.email_id || !row.email_status || !row.email_mode) return null;
  return {
    id: row.email_id,
    subject: row.email_subject ?? "",
    text: row.email_text,
    status: row.email_status,
    sent: row.email_status === "sent",
    mode: row.email_mode,
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

function shownStatus(row: JoinedRow): PurchaseStatus {
  if (row.voided_at) return "voided";
  return row.purchase_status;
}

function voidFromRow(row: JoinedRow): SaleVoid | null {
  if (!row.voided_at || !row.voided_by || !row.void_reason) return null;
  return { at: row.voided_at, by: row.voided_by, reason: row.void_reason };
}

export function purchaseForBuyer(purchase: PurchaseRecord): BuyerPurchase {
  return {
    ...purchase,
    void: purchase.void ? { at: purchase.void.at, reason: purchase.void.reason } : null,
  };
}

export function toPurchase(row: JoinedRow): PurchaseRecord {
  return {
    id: row.purchase_id,
    status: shownStatus(row),
    paymentMode: row.payment_mode,
    charged: false,
    amountCents: row.amount_cents,
    currency: "CAD",
    stripeTestReference: row.stripe_test_reference,
    offlineNote: row.offline_note,
    buyerEmail: row.buyer_email,
    buyerName: row.buyer_name,
    receiptToken: row.receipt_token,
    attestation: {
      age19: row.attested_age_19 === 1,
      inBc: row.attested_in_bc === 1,
      at: row.attested_at,
      by: row.attested_by,
      text: row.attestation_text,
    },
    selectionId: row.selection_id,
    ball: ballFromJoined(row),
    emailRecord: emailFromRow(row),
    void: voidFromRow(row),
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
    purchaseStatus: shownStatus(row),
    receiptToken: row.receipt_token,
    emailRecord: emailFromRow(row),
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    voidedBy: row.voided_by,
    createdAt: row.selection_created_at,
  };
}

export async function listBalls(
  db: D1Database,
): Promise<Array<Pick<Ball, "id" | "ballNumber" | "status">>> {
  const result = await db
    .prepare(
      `SELECT id, ball_number, status
       FROM balls
       ORDER BY ball_number ASC`,
    )
    .all<Pick<BallRow, "id" | "ball_number" | "status">>();
  return result.results.map((row) => ({
    id: row.id,
    ballNumber: row.ball_number,
    status: row.status,
  }));
}

export function newReceiptToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export async function purchaseForReceiptToken(
  db: D1Database,
  token: string,
): Promise<PurchaseRecord | null> {
  const row = await db.prepare(`${JOINED} WHERE p.receipt_token = ?`).bind(token).first<JoinedRow>();
  return row ? toPurchase(row) : null;
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
  const open = await db
    .prepare(`SELECT id FROM balls WHERE status = 'available'`)
    .all<{ id: number }>();
  if (open.results.length === 0) {
    throw new HttpError(409, "Every ball is already held or recorded.");
  }
  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  const index = sample[0]! % open.results.length;
  const chosen = open.results[index];
  if (!chosen) throw new HttpError(409, "Every ball is already held or recorded.");
  return chosen.id;
}

async function tryHold(
  db: D1Database,
  ballId: number,
  input: { email: string; buyerName: string | null },
  config: AppConfig,
  clientKey: string | null,
): Promise<PurchaseRecord | null> {
  const purchaseId = crypto.randomUUID();
  const selectionId = crypto.randomUUID();
  const receiptToken = newReceiptToken();
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
           receipt_token, client_key, created_at, updated_at
         )
         SELECT ?, ?, ?, 'demo_pending', 'stripe_test_fake', NULL, NULL, ?, 'CAD', 1, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(purchaseId, input.email, input.buyerName, config.amountCents, receiptToken, clientKey, now, now),
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
  clientKey: string | null = null,
): Promise<PurchaseRecord> {
  assertPaymentsAllowed(config);
  if (clientKey) await assertClientHoldRoom(db, clientKey);
  const attempts = config.allowBallPicking ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ballId = await chooseBall(db, input.ballId, config);
    const held = await tryHold(db, ballId, input, config, clientKey);
    if (held) return held;
    if (config.allowBallPicking) {
      throw new HttpError(409, "That ball is already held or recorded.");
    }
  }
  throw new HttpError(409, "Every ball is already held or recorded.");
}

function receiptFor(row: JoinedRow, config: AppConfig, origin: string) {
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
    numberPad: config.numberPad,
    priceConfirmed: config.decisions.price,
    kind: row.payment_mode === "offline_demo" ? "offline_demo" : "online_demo",
    receiptUrl: receiptLink(origin, row.receipt_token),
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
  origin: string,
): Promise<EmailDeliveryResult> {
  const receipt = receiptFor(row, config, origin);
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
  attestation: SaleAttestation,
  config: AppConfig,
  origin: string,
): Promise<ConfirmedPurchase> {
  assertPaymentsAllowed(config);
  const current = await requireOwnedPurchase(db, purchaseId, email);
  if (current.voided_at) throw new HttpError(409, "This sale was voided.");
  if (current.purchase_status === "cancelled") {
    throw new HttpError(409, "This hold was cancelled.");
  }
  if (current.purchase_status === "demo_confirmed") {
    return { purchase: toPurchase(current), email: await finishEmail(db, current, config, origin) };
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
    numberPad: config.numberPad,
    priceConfirmed: config.decisions.price,
    kind: "online_demo",
    receiptUrl: receiptLink(origin, current.receipt_token),
  });
  const now = new Date().toISOString();
  const dispatchId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET status = 'demo_confirmed',
             stripe_test_reference = ?,
             updated_at = ?,
             attested_age_19 = 1,
             attested_in_bc = 1,
             attested_at = ?,
             attested_by = ?,
             attestation_text = ?
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
      .bind(
        payment.stripeTestReference,
        now,
        now,
        attestation.by,
        attestation.text,
        purchaseId,
        email,
      ),
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
           id, purchase_id, selection_id, ball_id, to_email, subject, text_body, html_body,
           mode, status, idempotency_key, provider_message_id, error, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, NULL, NULL, ?
         WHERE changes() = 1`,
      )
      .bind(
        dispatchId,
        purchaseId,
        current.selection_id,
        current.ball_id,
        email,
        receipt.subject,
        receipt.text,
        receipt.html,
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
      return { purchase: toPurchase(again), email: await finishEmail(db, again, config, origin) };
    }
    throw new HttpError(409, "This hold cannot be confirmed.");
  }
  if (changed(ballUpdate) !== 1 || changed(dispatchInsert) !== 1) {
    logError({ message: "confirm wrote an incomplete demo purchase", purchaseId });
    throw new HttpError(500, "Could not confirm this hold.");
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not confirm this hold.");
  return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config, origin) };
}

export async function cancelHold(
  db: D1Database,
  purchaseId: string,
  email: string,
): Promise<PurchaseRecord> {
  const current = await requireOwnedPurchase(db, purchaseId, email);
  if (current.voided_at) throw new HttpError(409, "This sale was voided.");
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

async function writeLockedSale(
  db: D1Database,
  input: {
    ballId: number;
    email: string;
    buyerName: string | null;
    paymentMode: PaymentMode;
    stripeTestReference: string | null;
    offlineNote: string | null;
    amountCents: number;
    purchaseId: string;
    selectionId: string;
    receiptToken: string;
    attestation: SaleAttestation;
    receipt: ReturnType<typeof buildSelectionReceipt>;
    dispatchMode: "dry_run" | "resend";
    nowIso: string;
  },
): Promise<void> {
  const now = input.nowIso;
  const dispatchId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE balls
         SET status = 'sold'
         WHERE id = ?
           AND status = 'available'
           AND NOT EXISTS (
             SELECT 1 FROM ball_holds
             WHERE ball_id = ?
               AND state = 'pending_payment'
               AND expires_at > ?
           )`,
      )
      .bind(input.ballId, input.ballId, input.nowIso),
    db
      .prepare(
        `INSERT INTO purchases (
           id, buyer_email, buyer_name, status, payment_mode,
           stripe_test_reference, offline_note, amount_cents, currency, demo_only,
           receipt_token, attested_age_19, attested_in_bc, attested_at, attested_by,
           attestation_text, created_at, updated_at
         )
         SELECT ?, ?, ?, 'demo_confirmed', ?, ?, ?, ?, 'CAD', 1, ?, 1, 1, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(
        input.purchaseId,
        input.email,
        input.buyerName,
        input.paymentMode,
        input.stripeTestReference,
        input.offlineNote,
        input.amountCents,
        input.receiptToken,
        now,
        input.attestation.by,
        input.attestation.text,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO ball_selections (id, ball_id, email, purchase_id, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(input.selectionId, input.ballId, input.email, input.purchaseId, now),
    db
      .prepare(
        `INSERT INTO email_dispatches (
           id, purchase_id, selection_id, ball_id, to_email, subject, text_body, html_body,
           mode, status, idempotency_key, provider_message_id, error, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, NULL, NULL, ?
         WHERE changes() = 1`,
      )
      .bind(
        dispatchId,
        input.purchaseId,
        input.selectionId,
        input.ballId,
        input.email,
        input.receipt.subject,
        input.receipt.text,
        input.receipt.html,
        input.dispatchMode,
        input.receipt.idempotencyKey,
        now,
      ),
  ]);
  const ballUpdate = results[0];
  const purchaseInsert = results[1];
  const selectionInsert = results[2];
  const dispatchInsert = results[3];
  if (!ballUpdate || !purchaseInsert || !selectionInsert || !dispatchInsert) {
    throw new HttpError(500, "Could not record the purchase.");
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
    logError({ message: "purchase rolled back after a partial write", ballId: input.ballId });
    throw new HttpError(500, "Could not record the purchase.");
  }
}

export async function undoReservationPurchase(
  db: D1Database,
  purchaseId: string,
  ballId: number,
  holdId: string,
): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM email_dispatches WHERE purchase_id = ?`).bind(purchaseId),
    db.prepare(`DELETE FROM ball_selections WHERE purchase_id = ?`).bind(purchaseId),
    db
      .prepare(
        `UPDATE ball_holds
         SET state = 'pending_payment', purchase_id = NULL
         WHERE id = ? AND ball_id = ? AND state = 'confirmed'`,
      )
      .bind(holdId, ballId),
    db
      .prepare(
        `DELETE FROM purchases
         WHERE id = ?
           AND status = 'demo_confirmed'
           AND payment_mode = 'stripe_test_fake'
           AND voided_at IS NULL`,
      )
      .bind(purchaseId),
  ]);
  await db
    .prepare(
      `UPDATE balls
       SET status = 'selected'
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM ball_holds
           WHERE ball_id = balls.id AND state = 'pending_payment'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM ball_selections s
           JOIN purchases p ON p.id = s.purchase_id
           WHERE s.ball_id = balls.id
             AND p.status = 'demo_confirmed'
             AND p.voided_at IS NULL
         )`,
    )
    .bind(ballId)
    .run();
}

export async function sellFromReservation(
  db: D1Database,
  input: {
    holdId: string;
    sessionId: string;
    ballId: number;
    email: string;
    buyerName: string | null;
    attestation: SaleAttestation;
    now: string;
  },
  config: AppConfig,
  origin: string,
): Promise<ConfirmedPurchase | null> {
  assertPaymentsAllowed(config);
  const ball = await getBall(db, input.ballId);
  if (!ball) throw new HttpError(404, "That ball does not exist.");
  const purchaseId = crypto.randomUUID();
  const selectionId = crypto.randomUUID();
  const receiptToken = newReceiptToken();
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
    to: input.email,
    from: config.emailFrom,
    buyerName: input.buyerName,
    ballNumber: ball.ballNumber,
    ballLabel: ball.label,
    purchaseId,
    selectionId,
    reference: payment.stripeTestReference,
    amountCents: config.amountCents,
    numberPad: config.numberPad,
    priceConfirmed: config.decisions.price,
    kind: "online_demo",
    receiptUrl: receiptLink(origin, receiptToken),
  });
  const dispatchId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE ball_holds
         SET state = 'confirmed'
         WHERE id = ?
           AND session_id = ?
           AND ball_id = ?
           AND state = 'pending_payment'
           AND expires_at > ?`,
      )
      .bind(input.holdId, input.sessionId, input.ballId, input.now),
    db
      .prepare(
        `INSERT INTO purchases (
           id, buyer_email, buyer_name, status, payment_mode,
           stripe_test_reference, offline_note, amount_cents, currency, demo_only,
           receipt_token, attested_age_19, attested_in_bc, attested_at, attested_by,
           attestation_text, created_at, updated_at
         )
         SELECT ?, ?, ?, 'demo_confirmed', 'stripe_test_fake', ?, NULL, ?, 'CAD', 1, ?, 1, 1, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(
        purchaseId,
        input.email,
        input.buyerName,
        payment.stripeTestReference,
        config.amountCents,
        receiptToken,
        input.now,
        input.attestation.by,
        input.attestation.text,
        input.now,
        input.now,
      ),
    db
      .prepare(
        `UPDATE ball_holds
         SET purchase_id = ?
         WHERE id = ? AND state = 'confirmed' AND purchase_id IS NULL AND changes() = 1`,
      )
      .bind(purchaseId, input.holdId),
    db
      .prepare(
        `UPDATE balls
         SET status = 'sold'
         WHERE id = ? AND status = 'selected' AND changes() = 1`,
      )
      .bind(input.ballId),
    db
      .prepare(
        `INSERT INTO ball_selections (id, ball_id, email, purchase_id, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(selectionId, input.ballId, input.email, purchaseId, input.now),
    db
      .prepare(
        `INSERT INTO email_dispatches (
           id, purchase_id, selection_id, ball_id, to_email, subject, text_body, html_body,
           mode, status, idempotency_key, provider_message_id, error, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, NULL, NULL, ?
         WHERE changes() = 1`,
      )
      .bind(
        dispatchId,
        purchaseId,
        selectionId,
        input.ballId,
        input.email,
        receipt.subject,
        receipt.text,
        receipt.html,
        plan.mode,
        receipt.idempotencyKey,
        input.now,
      ),
  ]);
  const holdUpdate = results[0];
  const purchaseInsert = results[1];
  const holdLink = results[2];
  const ballUpdate = results[3];
  const selectionInsert = results[4];
  const dispatchInsert = results[5];
  if (!holdUpdate || !purchaseInsert || !holdLink || !ballUpdate || !selectionInsert || !dispatchInsert) {
    throw new HttpError(500, "Could not record the purchase.");
  }
  if (changed(holdUpdate) !== 1) return null;
  if (
    changed(purchaseInsert) !== 1 ||
    changed(holdLink) !== 1 ||
    changed(ballUpdate) !== 1 ||
    changed(selectionInsert) !== 1 ||
    changed(dispatchInsert) !== 1
  ) {
    await undoReservationPurchase(db, purchaseId, input.ballId, input.holdId);
    logError({ message: "reservation purchase rolled back after a partial write", ballId: input.ballId });
    throw new HttpError(500, "Could not record the purchase.");
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not record the purchase.");
  return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config, origin) };
}

export async function purchaseBall(
  db: D1Database,
  input: {
    email: string;
    buyerName: string | null;
    ballId: number | undefined;
    attestation: SaleAttestation;
  },
  config: AppConfig,
  origin: string,
): Promise<ConfirmedPurchase> {
  assertPaymentsAllowed(config);
  const now = new Date();
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  const attempts = config.allowBallPicking ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ballId = await chooseBall(db, input.ballId, config);
    const ball = await getBall(db, ballId);
    if (!ball || ball.status !== "available") {
      if (config.allowBallPicking) {
        throw new HttpError(409, "That ball is already held or recorded.");
      }
      continue;
    }
    const purchaseId = crypto.randomUUID();
    const selectionId = crypto.randomUUID();
    const receiptToken = newReceiptToken();
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
      to: input.email,
      from: config.emailFrom,
      buyerName: input.buyerName,
      ballNumber: ball.ballNumber,
      ballLabel: ball.label,
      purchaseId,
      selectionId,
      reference: payment.stripeTestReference,
      amountCents: config.amountCents,
      numberPad: config.numberPad,
    priceConfirmed: config.decisions.price,
      kind: "online_demo",
      receiptUrl: receiptLink(origin, receiptToken),
    });
    try {
      await writeLockedSale(db, {
        ballId,
        email: input.email,
        buyerName: input.buyerName,
        paymentMode: "stripe_test_fake",
        stripeTestReference: payment.stripeTestReference,
        offlineNote: null,
        amountCents: config.amountCents,
        purchaseId,
        selectionId,
        receiptToken,
        attestation: input.attestation,
        receipt,
        dispatchMode: plan.mode,
        nowIso,
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 409 && !config.allowBallPicking) continue;
      throw error;
    }
    const saved = await loadPurchase(db, purchaseId);
    if (!saved) throw new HttpError(500, "Could not record the purchase.");
    return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config, origin) };
  }
  throw new HttpError(409, "Every ball is already held or recorded.");
}

export async function recordOfflineSale(
  db: D1Database,
  input: {
    email: string;
    buyerName: string | null;
    ballId: number;
    note: string;
    attestation: SaleAttestation;
  },
  config: AppConfig,
  origin: string,
): Promise<ConfirmedPurchase> {
  assertPaymentsAllowed(config);
  const now = new Date();
  const nowIso = now.toISOString();
  await expireDueHolds(db, now);
  const ball = await getBall(db, input.ballId);
  if (!ball) throw new HttpError(404, "That ball does not exist.");
  const liveHold = await db
    .prepare(
      `SELECT id
       FROM ball_holds
       WHERE ball_id = ? AND state = 'pending_payment' AND expires_at > ?`,
    )
    .bind(input.ballId, nowIso)
    .first<{ id: string }>();
  if (liveHold || ball.status === "selected") {
    throw new HttpError(409, "That ball is held. Cancel the hold before an offline demo record.");
  }
  if (ball.status === "sold") throw new HttpError(409, "That ball is already recorded.");

  const purchaseId = crypto.randomUUID();
  const selectionId = crypto.randomUUID();
  const receiptToken = newReceiptToken();
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
    numberPad: config.numberPad,
    priceConfirmed: config.decisions.price,
    kind: "offline_demo",
    receiptUrl: receiptLink(origin, receiptToken),
  });
  await writeLockedSale(db, {
    ballId: input.ballId,
    email: input.email,
    buyerName: input.buyerName,
    paymentMode: "offline_demo",
    stripeTestReference: null,
    offlineNote: input.note,
    amountCents: config.amountCents,
    purchaseId,
    selectionId,
    receiptToken,
    attestation: input.attestation,
    receipt,
    dispatchMode: plan.mode,
    nowIso,
  });
  const saved = await loadPurchase(db, purchaseId);
  if (!saved) throw new HttpError(500, "Could not record the offline demo sale.");
  return { purchase: toPurchase(saved), email: await finishEmail(db, saved, config, origin) };
}

async function restoreVoidAttempt(
  db: D1Database,
  purchaseId: string,
  ballId: number,
  stampedAt: string,
  previousUpdatedAt: string,
  auditId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET voided_at = NULL, void_reason = NULL, voided_by = NULL, updated_at = ?
         WHERE id = ? AND voided_at = ?`,
      )
      .bind(previousUpdatedAt, purchaseId, stampedAt),
    db
      .prepare(
        `UPDATE balls
         SET status = 'sold'
         WHERE id = ?
           AND status = 'available'
           AND changes() = 1
           AND NOT EXISTS (
             SELECT 1
             FROM ball_selections s
             JOIN purchases p ON p.id = s.purchase_id
             WHERE s.ball_id = balls.id
               AND p.id != ?
               AND p.status = 'demo_confirmed'
               AND p.voided_at IS NULL
           )`,
      )
      .bind(ballId, purchaseId),
    db.prepare(`DELETE FROM sale_voids WHERE id = ?`).bind(auditId),
  ]);
}

export async function voidConfirmedSale(
  db: D1Database,
  purchaseId: string,
  reason: string,
  voidedBy: string,
): Promise<PurchaseRecord> {
  const current = await loadPurchase(db, purchaseId);
  if (!current) throw new HttpError(404, "That sale was not found.");
  if (current.voided_at) throw new HttpError(409, "This sale is already voided.");
  if (current.purchase_status !== "demo_confirmed") {
    throw new HttpError(409, "Only a recorded sale can be voided.");
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE purchases
         SET voided_at = ?, void_reason = ?, voided_by = ?, updated_at = ?
         WHERE id = ?
           AND status = 'demo_confirmed'
           AND voided_at IS NULL
           AND demo_only = 1
           AND EXISTS (
             SELECT 1
             FROM ball_selections s
             JOIN balls b ON b.id = s.ball_id
             WHERE s.purchase_id = purchases.id
               AND s.ball_id = ?
               AND b.status = 'sold'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM ball_selections s
             JOIN purchases other ON other.id = s.purchase_id
             WHERE s.ball_id = ?
               AND other.id != purchases.id
               AND other.status = 'demo_confirmed'
               AND other.voided_at IS NULL
           )`,
      )
      .bind(now, reason, voidedBy, now, purchaseId, current.ball_id, current.ball_id),
    db
      .prepare(
        `UPDATE balls
         SET status = 'available'
         WHERE id = ?
           AND status = 'sold'
           AND changes() = 1`,
      )
      .bind(current.ball_id),
    db
      .prepare(
        `INSERT INTO sale_voids (id, purchase_id, ball_id, reason, voided_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(auditId, purchaseId, current.ball_id, reason, voidedBy, now),
  ]);
  const purchaseUpdate = results[0];
  const ballUpdate = results[1];
  const auditInsert = results[2];
  if (!purchaseUpdate || !ballUpdate || !auditInsert) {
    throw new HttpError(500, "Could not void this sale.");
  }
  const voided = changed(purchaseUpdate) === 1 && changed(ballUpdate) === 1 && changed(auditInsert) === 1;
  if (!voided) {
    if (changed(purchaseUpdate) === 1) {
      await restoreVoidAttempt(db, purchaseId, current.ball_id, now, current.purchase_updated_at, auditId);
      logError({ message: "void rolled back after a partial write", purchaseId, ballId: current.ball_id });
    }
    const again = await loadPurchase(db, purchaseId);
    if (again?.voided_at) throw new HttpError(409, "This sale is already voided.");
    throw new HttpError(409, "This sale could not be voided.");
  }
  const saved = await loadPurchase(db, purchaseId);
  if (!saved?.voided_at) throw new HttpError(500, "Could not void this sale.");
  return toPurchase(saved);
}
