import { toCsv } from "./csv";

type Cell = string | number | null;

const PURCHASE_COLUMNS = [
  "purchase_id",
  "buyer_email",
  "buyer_name",
  "status",
  "payment_mode",
  "void_status",
  "amount_cents",
  "currency",
  "stripe_test_reference",
  "offline_note",
  "attested_age_19",
  "attested_in_bc",
  "attested_at",
  "attested_by",
  "attestation_text",
  "voided_at",
  "void_reason",
  "voided_by",
  "ball_id",
  "ball_number",
  "created_at",
  "updated_at",
] as const;

const SELECTION_COLUMNS = [
  "selection_id",
  "email",
  "ball_id",
  "ball_number",
  "ball_status",
  "purchase_id",
  "purchase_status",
  "void_status",
  "created_at",
] as const;

const DISPATCH_COLUMNS = [
  "dispatch_id",
  "purchase_id",
  "selection_id",
  "ball_id",
  "to_email",
  "subject",
  "text_body",
  "html_body",
  "mode",
  "status",
  "created_at",
] as const;

function shownStatus(status: string, voidedAt: string | null): string {
  return voidedAt ? "voided" : status;
}

function redactReceiptSecrets(value: string | null): string | null {
  if (value == null) return null;
  return value.replace(/\/purchase\?token=[0-9a-f]{64}/gi, "/purchase?token=redacted");
}

export async function purchasesCsv(db: D1Database): Promise<string> {
  const result = await db
    .prepare(
      `SELECT
         p.id, p.buyer_email, p.buyer_name, p.status, p.payment_mode, p.voided_at,
         p.amount_cents, p.currency, p.stripe_test_reference, p.offline_note,
         p.attested_age_19, p.attested_in_bc, p.attested_at, p.attested_by, p.attestation_text,
         p.void_reason, p.voided_by, s.ball_id, b.ball_number, p.created_at, p.updated_at
       FROM purchases p
       JOIN ball_selections s ON s.purchase_id = p.id
       JOIN balls b ON b.id = s.ball_id
       ORDER BY p.created_at ASC, p.id ASC`,
    )
    .all<{
      id: string;
      buyer_email: string;
      buyer_name: string | null;
      status: string;
      payment_mode: string;
      voided_at: string | null;
      amount_cents: number;
      currency: string;
      stripe_test_reference: string | null;
      offline_note: string | null;
      attested_age_19: number;
      attested_in_bc: number;
      attested_at: string | null;
      attested_by: string | null;
      attestation_text: string | null;
      void_reason: string | null;
      voided_by: string | null;
      ball_id: number;
      ball_number: number;
      created_at: string;
      updated_at: string;
    }>();
  const rows: Cell[][] = result.results.map((row) => [
    row.id,
    row.buyer_email,
    row.buyer_name,
    shownStatus(row.status, row.voided_at),
    row.payment_mode,
    row.voided_at ? "voided" : "not_voided",
    row.amount_cents,
    row.currency,
    row.stripe_test_reference,
    row.offline_note,
    row.attested_age_19,
    row.attested_in_bc,
    row.attested_at,
    row.attested_by,
    row.attestation_text,
    row.voided_at,
    row.void_reason,
    row.voided_by,
    row.ball_id,
    row.ball_number,
    row.created_at,
    row.updated_at,
  ]);
  return toCsv([Array.from(PURCHASE_COLUMNS), ...rows]);
}

export async function selectionsCsv(db: D1Database): Promise<string> {
  const result = await db
    .prepare(
      `SELECT
         s.id, s.email, s.ball_id, b.ball_number, b.status AS ball_status,
         s.purchase_id, p.status AS purchase_status, p.voided_at, s.created_at
       FROM ball_selections s
       JOIN purchases p ON p.id = s.purchase_id
       JOIN balls b ON b.id = s.ball_id
       ORDER BY s.created_at ASC, s.id ASC`,
    )
    .all<{
      id: string;
      email: string;
      ball_id: number;
      ball_number: number;
      ball_status: string;
      purchase_id: string;
      purchase_status: string;
      voided_at: string | null;
      created_at: string;
    }>();
  const rows: Cell[][] = result.results.map((row) => [
    row.id,
    row.email,
    row.ball_id,
    row.ball_number,
    row.ball_status,
    row.purchase_id,
    shownStatus(row.purchase_status, row.voided_at),
    row.voided_at ? "voided" : "not_voided",
    row.created_at,
  ]);
  return toCsv([Array.from(SELECTION_COLUMNS), ...rows]);
}

export async function dispatchesCsv(db: D1Database): Promise<string> {
  const result = await db
    .prepare(
      `SELECT id, purchase_id, selection_id, ball_id, to_email, subject, text_body, html_body, mode, status, created_at
       FROM email_dispatches
       ORDER BY created_at ASC, id ASC`,
    )
    .all<{
      id: string;
      purchase_id: string;
      selection_id: string;
      ball_id: number | null;
      to_email: string;
      subject: string | null;
      text_body: string | null;
      html_body: string | null;
      mode: string;
      status: string;
      created_at: string;
    }>();
  const rows: Cell[][] = result.results.map((row) => [
    row.id,
    row.purchase_id,
    row.selection_id,
    row.ball_id,
    row.to_email,
    row.subject,
    redactReceiptSecrets(row.text_body),
    redactReceiptSecrets(row.html_body),
    row.mode,
    row.status,
    row.created_at,
  ]);
  return toCsv([Array.from(DISPATCH_COLUMNS), ...rows]);
}
