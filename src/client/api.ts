export type BallStatus = "available" | "selected" | "sold";

export type Ball = {
  id: number;
  ballNumber: number;
  label: string;
  color: string;
  status: BallStatus;
};

export type Config = {
  allowBallPicking: boolean;
  amountCents: number;
  currency: string;
  paymentsBlocked: boolean;
  emailDelivery: string;
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
  ball: Ball;
  emailRecord: { subject: string; sent: boolean } | null;
};

type ApiError = { error?: string };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

export function getConfig(): Promise<Config> {
  return send<Config>("/api/config");
}

export function getBalls(): Promise<Ball[]> {
  return send<{ balls: Ball[] }>("/api/balls").then((payload) => payload.balls);
}

export function buyBall(body: { email: string; buyerName: string; ballId?: number }): Promise<{
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
  body: { email: string; buyerName: string; ballId: number; note: string },
  token: string,
): Promise<{ purchase: Purchase; email: { sent: boolean } }> {
  return send("/api/admin/offline-sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export function purchasesFor(email: string): Promise<{ purchases: Purchase[] }> {
  return send(`/api/purchases?email=${encodeURIComponent(email)}`);
}

export function selectionsFor(email: string): Promise<{
  selections: Array<{
    id: string;
    email: string;
    label: string;
    ballNumber: number;
    ballStatus: string;
    purchaseStatus: string;
    emailRecord: { subject: string; sent: boolean } | null;
  }>;
}> {
  return send(`/api/selections?email=${encodeURIComponent(email)}`);
}
