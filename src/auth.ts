import type { AppConfig } from "./config";
import { HttpError } from "./http";
import { readSession } from "./session";

function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export function tokensMatch(expected: string, provided: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(provided);
  if (a.byteLength === 0 || a.byteLength !== b.byteLength) {
    crypto.subtle.timingSafeEqual(a, a);
    return false;
  }
  return crypto.subtle.timingSafeEqual(a, b);
}

export function isAdminEmail(config: AppConfig, email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase());
}

export async function assertAdmin(
  config: AppConfig,
  authorization: string | undefined,
  cookieHeader: string | undefined,
): Promise<void> {
  const provided = readBearer(authorization);
  if (provided) {
    if (config.adminToken && tokensMatch(config.adminToken, provided)) return;
    throw new HttpError(401, "Admin token was not accepted.");
  }
  const session = await readSession(config, cookieHeader);
  if (session && isAdminEmail(config, session.email)) return;
  if (!config.adminToken && config.adminEmails.length === 0) {
    throw new HttpError(
      503,
      "Admin tools are off until ADMIN_TOKEN or ADMIN_EMAILS is set in .dev.vars or as a Wrangler secret.",
    );
  }
  throw new HttpError(401, "Admin access was not accepted.");
}
