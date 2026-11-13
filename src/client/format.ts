const PALETTE = [
  "#FFC234",
  "#FF8A3D",
  "#FF5C7A",
  "#FF85C0",
  "#9370F0",
  "#3DA9F5",
  "#18BFA9",
  "#7CCF4E",
  "#2F6BD8",
];

function mix(hex: string, other: string, t: number): string {
  const channel = (value: string, index: number) => Number.parseInt(value.slice(index, index + 2), 16);
  const parts = [1, 3, 5].map((index) => {
    const from = channel(hex, index);
    const to = channel(other, index);
    return Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${parts.join("")}`;
}

export function ballColour(n: number): { c: string; hi: string; lo: string } {
  const c = PALETTE[(n * 7 + Math.floor(n / 9)) % PALETTE.length] ?? PALETTE[0] ?? "#FFC234";
  return { c, hi: mix(c, "#FFFFFF", 0.45), lo: mix(c, "#000000", 0.28) };
}

// Public label for sequential_from_1. The pad is a placeholder, not a decided format.
// 0 prints the integer. A longer number is not cut: 2500 stays 2500 when the pad is 3.
let numberPad = 3;

export function useBallNumberPad(pad: number): void {
  numberPad = pad;
}

export function formatBallNumber(n: number, pad: number): string {
  const text = String(n);
  if (pad <= 0 || text.length >= pad) return text;
  return text.padStart(pad, "0");
}

export function ballNumber(n: number): string {
  return formatBallNumber(n, numberPad);
}

function mixSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffleNumbers(items: number[], seed: number): number[] {
  const copy = [...items];
  const random = mixSeed(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = copy[index];
    const right = copy[swap];
    if (left === undefined || right === undefined) continue;
    copy[index] = right;
    copy[swap] = left;
  }
  return copy;
}

export function marqueeNumbers(
  balls: Array<{ ballNumber: number; status: string }>,
  count: number,
  seed: number,
): number[] {
  if (count <= 0 || balls.length === 0) return [];
  const shaded = balls.filter((ball) => ball.status !== "available").map((ball) => ball.ballNumber);
  const open = balls.filter((ball) => ball.status === "available").map((ball) => ball.ballNumber);
  const shadedOrder = shuffleNumbers(shaded, seed);
  const chosen =
    shadedOrder.length >= count
      ? shadedOrder.slice(0, count)
      : [...shadedOrder, ...shuffleNumbers(open, seed + 1).slice(0, count - shadedOrder.length)];
  return shuffleNumbers(chosen, seed + 2);
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

export type CustomerHoldSummary = {
  confirmed: Array<{ ballId: number; ballNumber: number; receiptToken: string }>;
  pending: Array<{ ballId: number; ballNumber: number; expiresAt: string }>;
  remainingMs: number;
};

export function customerHoldSummary(reservation: {
  session: { status: string; remainingMs: number } | null;
  holds: Array<{ ballId: number; ballNumber: number; state: string; expiresAt: string }>;
  owned: Array<{ ballId: number; ballNumber: number; receiptToken: string }>;
}): CustomerHoldSummary {
  const pending = reservation.holds.filter((hold) => hold.state === "pending_payment");
  const open = reservation.session?.status === "open" && pending.length > 0;
  return {
    confirmed: reservation.owned.map((ball) => ({
      ballId: ball.ballId,
      ballNumber: ball.ballNumber,
      receiptToken: ball.receiptToken,
    })),
    pending: pending.map((hold) => ({
      ballId: hold.ballId,
      ballNumber: hold.ballNumber,
      expiresAt: hold.expiresAt,
    })),
    remainingMs: open ? Math.max(0, reservation.session?.remainingMs ?? 0) : 0,
  };
}
