export function logInfo(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify(fields));
}
