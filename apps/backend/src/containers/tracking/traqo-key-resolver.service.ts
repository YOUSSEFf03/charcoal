import { Injectable } from '@nestjs/common';

/**
 * The single choke point that ever reads a raw Traqo API key value. Every
 * other piece of code (TraqoAccount rows, API responses, logs, error
 * messages) only ever sees `envKeyName` — a label like "TRAQO_API_KEY_2" —
 * never the key itself. Auditing "does a key ever leak" reduces to auditing
 * this one file.
 *
 * Account 1 (`envKeyName: "TRAQO_API_KEY_1"`) falls back to the legacy
 * `TRAQO_API_KEY` var if `TRAQO_API_KEY_1` is unset, preserving continuity
 * for the pre-existing single-account deployment without forcing an env var
 * rename. Accounts 2/3 have no such fallback — they never existed before.
 */
@Injectable()
export class TraqoKeyResolver {
  resolve(envKeyName: string): string | undefined {
    const value = process.env[envKeyName];
    if (value) return value;
    if (envKeyName === 'TRAQO_API_KEY_1') return process.env.TRAQO_API_KEY || undefined;
    return undefined;
  }
}
