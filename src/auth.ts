import type { AppConfig } from "./config";
import { HttpError } from "./http";
import { readSession } from "./session";

function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export async function tokensMatch(expected: string, provided: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [expectedDigest, providedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(`rob-admin:${expected}`)),
    crypto.subtle.digest("SHA-256", encoder.encode(`rob-admin:${provided}`)),
  ]);
  const equal = crypto.subtle.timingSafeEqual(new Uint8Array(expectedDigest), new Uint8Array(providedDigest));
  return expected.length > 0 && provided.length > 0 && equal;
}

export function isAdminEmail(config: AppConfig, email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase());
}

export type AdminActor = {
  by: string;
};

export async function assertAdmin(
  config: AppConfig,
  authorization: string | undefined,
  cookieHeader: string | undefined,
): Promise<AdminActor> {
  const provided = readBearer(authorization);
  if (provided) {
    if (config.adminToken && (await tokensMatch(config.adminToken, provided))) return { by: "admin-token" };
    throw new HttpError(401, "Admin token was not accepted.");
  }
  const session = await readSession(config, cookieHeader);
  if (session && isAdminEmail(config, session.email)) return { by: session.email };
  if (!config.adminToken && config.adminEmails.length === 0) {
    throw new HttpError(
      503,
      "Admin tools are off until ADMIN_TOKEN or ADMIN_EMAILS is set in .dev.vars or as a Wrangler secret.",
    );
  }
  throw new HttpError(401, "Admin access was not accepted.");
}
