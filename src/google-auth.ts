import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { googleSignInReady, readConfig, type AppConfig } from "./config";
import { HttpError } from "./http";
import { logError, logInfo } from "./log";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, seal, signSession, unseal } from "./session";
import { parseEmail } from "./validation";

const OAUTH_COOKIE = "rob_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;
const ALLOWED_NEXT = new Set(["/", "/admin", "/purchase", "/selections"]);

type AppContext = Context<{ Bindings: CloudflareBindings }>;

type GoogleProfile = {
  email: string;
  name: string | null;
};

export async function beginGoogleSignIn(c: AppContext): Promise<Response> {
  const config = readConfig(c.env);
  if (!googleSignInReady(config) || !config.sessionSecret || !config.googleClientId) {
    throw new HttpError(
      503,
      "Google sign-in is not set up. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET.",
    );
  }
  const next = safeNext(c.req.query("next"));
  const state = randomToken(16);
  const verifier = randomToken(32);
  const sealed = await seal(config.sessionSecret, {
    state,
    verifier,
    next,
    exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS,
  });
  setCookie(c, OAUTH_COOKIE, sealed, cookieOptions(c, OAUTH_TTL_SECONDS));
  const redirect = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  redirect.searchParams.set("client_id", config.googleClientId);
  redirect.searchParams.set("redirect_uri", callbackUrl(c.req.url));
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", "openid email profile");
  redirect.searchParams.set("state", state);
  redirect.searchParams.set("code_challenge", await pkceChallenge(verifier));
  redirect.searchParams.set("code_challenge_method", "S256");
  redirect.searchParams.set("prompt", "select_account");
  return c.redirect(redirect.toString(), 302);
}

export async function finishGoogleSignIn(c: AppContext): Promise<Response> {
  const config = readConfig(c.env);
  if (!googleSignInReady(config) || !config.sessionSecret || !config.googleClientId || !config.googleClientSecret) {
    throw new HttpError(
      503,
      "Google sign-in is not set up. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET.",
    );
  }
  const pending = await unseal(config.sessionSecret, getCookie(c, OAUTH_COOKIE));
  clearOauthCookie(c);
  const next = safeNext(typeof pending?.next === "string" ? pending.next : undefined);
  const state = typeof pending?.state === "string" ? pending.state : "";
  const verifier = typeof pending?.verifier === "string" ? pending.verifier : "";
  const exp = typeof pending?.exp === "number" ? pending.exp : 0;
  const code = c.req.query("code") ?? "";
  if (
    c.req.query("error") ||
    !code ||
    !state ||
    !verifier ||
    state !== (c.req.query("state") ?? "") ||
    exp <= Math.floor(Date.now() / 1000)
  ) {
    return c.redirect(withAuth(next, "failed"), 302);
  }
  try {
    const profile = await exchangeCode({
      code,
      verifier,
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: callbackUrl(c.req.url),
    });
    const session = await signSession(config.sessionSecret, profile);
    setCookie(c, SESSION_COOKIE, session, cookieOptions(c, SESSION_TTL_SECONDS));
    logInfo({ message: "google sign-in", admin: isListed(config, profile.email) });
    return c.redirect(next, 302);
  } catch (error) {
    const reason = error instanceof Error && error.message === "unverified" ? "unverified" : "unavailable";
    logError({ message: "google sign-in failed", reason });
    return c.redirect(withAuth(next, reason), 302);
  }
}

export function clearSession(c: AppContext): void {
  const options = cookieOptions(c, 0);
  deleteCookie(c, SESSION_COOKIE, options);
  deleteCookie(c, OAUTH_COOKIE, options);
}

function isListed(config: AppConfig, email: string): boolean {
  return config.adminEmails.includes(email);
}

function clearOauthCookie(c: AppContext): void {
  deleteCookie(c, OAUTH_COOKIE, cookieOptions(c, 0));
}

function cookieOptions(c: AppContext, maxAge: number): {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
  maxAge: number;
} {
  return {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge,
  };
}

function callbackUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/auth/google/callback`;
}

function safeNext(value: string | undefined): string {
  if (!value || !ALLOWED_NEXT.has(value)) return "/admin";
  return value;
}

function withAuth(path: string, reason: string): string {
  return `${path}?auth=${reason}`;
}

function randomToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function exchangeCode(input: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleProfile> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
    redirect: "error",
  });
  if (!tokenResponse.ok) throw new Error("unavailable");
  const token = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof token.access_token !== "string" || token.access_token.length === 0) {
    throw new Error("unavailable");
  }
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
    redirect: "error",
  });
  if (!profileResponse.ok) throw new Error("unavailable");
  const profile = (await profileResponse.json()) as {
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };
  if (profile.email_verified !== true) throw new Error("unverified");
  let email: string;
  try {
    email = parseEmail(profile.email);
  } catch {
    throw new Error("unverified");
  }
  const name = typeof profile.name === "string" ? profile.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 80) : "";
  return { email, name: name.length > 0 ? name : null };
}
