const RECEIPT_TOKEN = /\b[0-9a-f]{64}\b/gi;

function scrub(value: unknown): unknown {
  if (typeof value === "string") return value.replace(RECEIPT_TOKEN, "[redacted]");
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrub(item);
    return out;
  }
  return value;
}

export function logInfo(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(scrub(fields)));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify(scrub(fields)));
}
