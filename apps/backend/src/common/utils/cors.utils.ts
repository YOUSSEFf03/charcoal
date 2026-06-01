/** Parse a comma-separated CORS_ORIGINS string into a trimmed string array. */
export function parseCorsOrigins(raw: string): string[] {
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}
