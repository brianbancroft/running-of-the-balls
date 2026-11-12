import { HttpError } from "./http";

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Enter an email address.");
  }
  const email = value.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 254 ||
    /[\r\n]/.test(email) ||
    !EMAIL_PATTERN.test(email)
  ) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

export function parseName(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "Name must be text.");
  }
  const name = value.replace(/[\r\n\t]+/g, " ").trim();
  if (name.length > 80) {
    throw new HttpError(400, "Name must be 80 characters or fewer.");
  }
  return name.length > 0 ? name : null;
}

export function parseOptionalBallId(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100_000
  ) {
    throw new HttpError(400, "ballId must be a whole number.");
  }
  return value;
}

export function parseNote(value: unknown): string {
  const fallback = "Recorded at the club table in the demo.";
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") {
    throw new HttpError(400, "Note must be text.");
  }
  const note = value.replace(/[\r\n\t]+/g, " ").trim();
  if (note.length > 200) {
    throw new HttpError(400, "Note must be 200 characters or fewer.");
  }
  return note.length > 0 ? note : fallback;
}

const RECEIPT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function parseReceiptToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "Open the receipt link from checkout. Purchases are not listed by email.");
  }
  const token = value.trim().toLowerCase();
  if (!RECEIPT_TOKEN_PATTERN.test(token)) {
    throw new HttpError(400, "That receipt link is not valid.");
  }
  return token;
}

export type BuyerAttestation = {
  age19: true;
  inBc: true;
};

export function parseAttestation(body: Record<string, unknown>): BuyerAttestation {
  if (body.attestAge19 !== true || body.attestInBc !== true) {
    throw new HttpError(
      400,
      "Confirm you are 19 or older and physically in British Columbia.",
    );
  }
  return { age19: true, inBc: true };
}

export function parsePurchaseId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HttpError(400, "That purchase id is not valid.");
  }
  return value.toLowerCase();
}

export function parseSessionCookie(value: string | undefined): string | null {
  if (!value || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function parseBallIdList(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2500) {
    throw new HttpError(400, "Choose at least one ball.");
  }
  const ids: number[] = [];
  for (const item of value) {
    const id = parseOptionalBallId(item);
    if (id == null) throw new HttpError(400, "ballId must be a whole number.");
    ids.push(id);
  }
  return [...new Set(ids)];
}
