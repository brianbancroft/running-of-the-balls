export type BallStatus = "available" | "selected" | "sold";

export type Ball = {
  id: number;
  ballNumber: number;
  status: BallStatus;
};

export type Config = {
  allowBallPicking: boolean;
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
};

type ApiError = { error?: string };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
