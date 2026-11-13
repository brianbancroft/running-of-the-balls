import type { AppConfig } from "./config";
import { parseEmail } from "./validation";

export const SESSION_COOKIE = "rob_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type BrowserSession = {
  email: string;
  name: string | null;
  exp: number;
};

export async function signSession(
  secret: string,
  session: { email: string; name: string | null },
): Promise<string> {
  return seal(secret, {
    email: parseEmail(session.email),
    name: session.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
}

export async function readSession(
  config: AppConfig,
  cookieHeader: string | undefined,
): Promise<BrowserSession | null> {
  if (!config.sessionSecret) return null;
  const payload = await unseal(config.sessionSecret, readCookie(cookieHeader, SESSION_COOKIE));
  if (!payload) return null;
  const exp = payload.exp;
  const now = Math.floor(Date.now() / 1000);
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= now) return null;
  if (exp > now + SESSION_TTL_SECONDS + 60) return null;
  try {
    const email = parseEmail(payload.email);
    const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 80) : null;
    return { email, name, exp };
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function seal(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(secret, body));
  return `${body}.${signature}`;
}

export async function unseal(
  secret: string,
  token: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!token || token.length > 2_000) return null;
  const separator = token.indexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const expected = await hmac(secret, body);
  const actual = base64UrlToBytes(signature);
  if (!actual || !(await safeEqual(expected, actual))) return null;
  const decoded = base64UrlToBytes(body);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decoded)) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function safeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", a),
    crypto.subtle.digest("SHA-256", b),
  ]);
  const equal = crypto.subtle.timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
  return a.byteLength > 0 && b.byteLength > 0 && equal;
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}
