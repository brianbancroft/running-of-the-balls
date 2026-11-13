// Spreadsheet formula cells, including a leading tab or carriage return.
// A leading space or newline only counts when a formula character follows.
const FORMULA = /^[\t\r]|[\t\r\n ]*[=+\-@]/;

export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
