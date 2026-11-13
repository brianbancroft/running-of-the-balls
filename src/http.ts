export type ClientStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503;

export class HttpError extends Error {
  readonly status: ClientStatus;

  constructor(status: ClientStatus, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMissingSchema(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}
