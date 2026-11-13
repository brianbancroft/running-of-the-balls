import type { DecisionFlags, Prize } from "./decisions.js";

export type BallStatus = "available" | "selected" | "sold";

export type Ball = {
  id: number;
  ballNumber: number;
  status: BallStatus;
};

export type BallBundle = {
  quantity: number;
  label: string;
};

export type Config = {
  allowBallPicking: boolean;
  assignment: "buyer_picks" | "assigned";
  numbering: string;
  numberPad: number;
  bundles: BallBundle[];
  prizes: Prize[];
  decisions: DecisionFlags;
  decisionsPending: boolean;
  amountCents: number;
  currency: string;
  paymentsBlocked: boolean;
  emailDelivery: string;
  licensed: boolean;
  gamingLicenceNumber: string | null;
  rulesUrl: string;
  licenceStatus: string;
};

export type Purchase = {
  id: string;
  status: string;
  paymentMode: string;
  charged: false;
  amountCents: number;
  currency: string;
  stripeTestReference: string | null;
  offlineNote: string | null;
  buyerEmail: string;
  buyerName: string | null;
  receiptToken: string;
  attestation: {
    age19: boolean;
    inBc: boolean;
    at: string | null;
    by: "buyer" | "admin" | null;
    text: string | null;
  };
  ball: Ball;
  emailRecord: { subject: string; sent: boolean; text: string | null } | null;
  void: { at: string; reason: string; by?: string } | null;
};

type ApiError = { error?: string };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

export type Session = {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  admin: boolean;
  googleSignIn: boolean;
};

export function getConfig(): Promise<Config> {
  return send<Config>("/api/config");
}

export function getSession(): Promise<Session> {
  return send<Session>("/api/auth/session");
}

export function getBalls(): Promise<Ball[]> {
  return send<{ balls: Ball[] }>("/api/balls").then((payload) => payload.balls);
}

export function buyBall(body: {
  email: string;
  buyerName: string;
  ballId?: number;
  attestAge19: true;
  attestInBc: true;
}): Promise<{
  purchase: Purchase;
  email: { sent: boolean; mode: string; preview: { subject: string; text: string } };
}> {
  return send("/api/purchases", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export function offlineSale(
  body: {
    email: string;
    buyerName: string;
    ballId: number;
    note: string;
    attestAge19: true;
    attestInBc: true;
  },
  token: string,
): Promise<{ purchase: Purchase; email: { sent: boolean } }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token.trim()) headers.authorization = `Bearer ${token}`;
  return send("/api/admin/offline-sales", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(body),
  });
}

export function purchaseForToken(token: string): Promise<{ purchase: Purchase }> {
  return send(`/api/purchases?token=${encodeURIComponent(token)}`);
}

function adminHeaders(token: string, json = false): Record<string, string> {
  const headers: Record<string, string> = { accept: json ? "application/json" : "text/csv" };
  if (json) headers["content-type"] = "application/json";
  if (token.trim()) headers.authorization = `Bearer ${token}`;
  return headers;
}

export function listSales(token: string): Promise<{ purchases: Purchase[] }> {
  return send("/api/admin/sales", { credentials: "same-origin", headers: adminHeaders(token, true) });
}

export function voidSale(
  purchaseId: string,
  reason: string,
  token: string,
): Promise<{ purchase: Purchase }> {
  return send(`/api/admin/purchases/${encodeURIComponent(purchaseId)}/void`, {
    method: "POST",
    credentials: "same-origin",
    headers: adminHeaders(token, true),
    body: JSON.stringify({ reason }),
  });
}

export async function downloadCsv(filename: string, token: string): Promise<void> {
  const response = await fetch(`/api/admin/exports/${encodeURIComponent(filename)}`, {
    credentials: "same-origin",
    headers: adminHeaders(token),
  });
  if (!response.ok) {
    let message = "Download failed.";
    try {
      const payload = (await response.json()) as ApiError;
      if (payload.error) message = payload.error;
    } catch {
      message = "Download failed.";
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type ReservationHold = {
  id: string;
  ballId: number;
  ballNumber: number;
  state: "pending_payment" | "confirmed" | "released" | "expired";
  createdAt: string;
  expiresAt: string;
};

export type OwnedBall = {
  ballId: number;
  ballNumber: number;
  purchaseId: string;
  receiptToken: string;
};

export type Reservation = {
  session: {
    id: string;
    status: "open" | "completed" | "expired";
    createdAt: string;
    expiresAt: string;
    remainingMs: number;
  } | null;
  holds: ReservationHold[];
  owned: OwnedBall[];
  hold?: ReservationHold;
};

export function getReservation(): Promise<Reservation> {
  return send<Reservation>("/api/reservations");
}

export function holdReservation(ballId: number): Promise<Reservation> {
  return send<Reservation>("/api/reservations", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ballId }),
  });
}

export function releaseReservation(ballId: number): Promise<Reservation> {
  return send<Reservation>("/api/reservations/release", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ballId }),
  });
}

export function checkoutReservation(body: {
  email: string;
  buyerName: string;
  ballIds: number[];
  attestAge19: true;
  attestInBc: true;
}): Promise<{
  purchases: Array<{
    purchase: Purchase;
    email: { sent: boolean; mode: string; preview: { subject: string; text: string } };
  }>;
  released: Array<{ ballId: number; ballNumber: number }>;
}> {
  return send("/api/reservations/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export function selectionsFor(
  email: string,
  token: string,
): Promise<{
  selections: Array<{
    id: string;
    email: string;
    label: string;
    ballNumber: number;
    ballStatus: string;
    purchaseStatus: string;
    receiptToken: string;
    voidReason: string | null;
    emailRecord: { subject: string; sent: boolean; text: string | null } | null;
  }>;
}> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token.trim()) headers.authorization = `Bearer ${token}`;
  return send(`/api/admin/selections?email=${encodeURIComponent(email)}`, {
    credentials: "same-origin",
    headers,
  });
}
