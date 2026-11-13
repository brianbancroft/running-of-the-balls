// A spreadsheet treats a cell as a formula only from its first character.
// Tab or carriage return counts on its own. Space or newline counts only when
// =, +, -, or @ follows. A hyphen, @, or = later in the cell is ordinary text,
// so emails, ids, and dates stay as written.
const FORMULA = /^(?:[\t\r]|[\t\r\n ]*[=+\-@])/;

export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
