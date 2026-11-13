const FORMULA = /^[\t\r\n ]*[=+\-@]/;

export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
