import type { AppConfig } from "./config";
import { HttpError } from "./http";

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

export function assertAdmin(config: AppConfig, authorization: string | undefined): void {
  if (!config.adminToken) {
    throw new HttpError(
      503,
      "Offline sales are off until ADMIN_TOKEN is set in .dev.vars or as a Wrangler secret.",
    );
  }
  const provided = readBearer(authorization);
  if (!provided || !tokensMatch(config.adminToken, provided)) {
    throw new HttpError(401, "Admin token was not accepted.");
  }
}
