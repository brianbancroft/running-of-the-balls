const PICKS = "rotb-picks";
const DEADLINE = "rotb-hold-deadline";
const QTY = "rotb-qty";
const PAUSED = "rotb-paused";
const SEED = "rotb-field-seed";
const RECEIPT = "rotb-last-receipt";
const DETAILS = "rotb-buyer";

export type ReceiptBall = {
  number: number;
  status: "recorded" | "taken";
  reference: string | null;
  receiptToken: string;
};

export type StoredReceipt = {
  email: string;
  name: string;
  balls: ReceiptBall[];
  amountCents: number;
  currency: string;
  charged: false;
  incomplete?: boolean;
};

export function readPicks(): number[] {
  const raw = sessionStorage.getItem(PICKS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === "number" && Number.isInteger(value));
  } catch {
    return [];
  }
}

export function writePicks(picks: number[]): void {
  sessionStorage.setItem(PICKS, JSON.stringify(picks));
}

export function readDeadline(): string | null {
  const value = sessionStorage.getItem(DEADLINE);
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return value;
}

export function writeDeadline(deadline: string | null): void {
  if (deadline) sessionStorage.setItem(DEADLINE, deadline);
  else sessionStorage.removeItem(DEADLINE);
}

export function readQty(): number {
  const value = Number(sessionStorage.getItem(QTY) ?? "1");
  if (!Number.isInteger(value) || value < 1) return 1;
  return value;
}

export function writeQty(qty: number): void {
  sessionStorage.setItem(QTY, String(qty));
}

export function readPaused(): boolean {
  return sessionStorage.getItem(PAUSED) === "1";
}

export function writePaused(paused: boolean): void {
  sessionStorage.setItem(PAUSED, paused ? "1" : "0");
}

export function fieldSeed(): number {
  const existing = sessionStorage.getItem(SEED);
  if (existing && /^\d+$/.test(existing)) return Number(existing);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  sessionStorage.setItem(SEED, String(seed));
  return seed;
}

export function readBuyer(): { name: string; email: string } {
  const raw = sessionStorage.getItem(DETAILS);
  if (!raw) return { name: "", email: "" };
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
    };
  } catch {
    return { name: "", email: "" };
  }
}

export function writeBuyer(name: string, email: string): void {
  sessionStorage.setItem(DETAILS, JSON.stringify({ name, email }));
}

export function readReceipt(): StoredReceipt | null {
  const raw = sessionStorage.getItem(RECEIPT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredReceipt;
  } catch {
    return null;
  }
}

export function writeReceipt(receipt: StoredReceipt): void {
  sessionStorage.setItem(RECEIPT, JSON.stringify(receipt));
}
