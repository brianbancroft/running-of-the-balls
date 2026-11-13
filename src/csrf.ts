import { HttpError } from "./http";
import { SESSION_COOKIE } from "./session";

const BEARER = /^Bearer\s+\S+$/i;

/**
 * Cookie-authenticated mutations must come from this site.
 * A bearer token is not sent by a browser on its own, so those clients skip this check.
 * A cross-site form cannot set Origin to this site. SameSite=Lax still sends the
 * session cookie on a same-site request, including another host under bancroft.io.
 */
export function assertCookieSameOrigin(c: {
  req: {
    method: string;
    url: string;
    header: (name: string) => string | undefined;
  };
}): void {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return;
  const authorization = c.req.header("authorization");
  if (authorization && BEARER.test(authorization.trim())) return;
  const cookie = c.req.header("cookie") ?? "";
  const hasSession = cookie.split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!hasSession) return;
  let expected = "";
  try {
    expected = new URL(c.req.url).origin;
  } catch {
    expected = "";
  }
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  if (!origin || origin !== expected || (site !== undefined && site !== "same-origin")) {
    throw new HttpError(403, "This action has to come from the same site.");
  }
}
