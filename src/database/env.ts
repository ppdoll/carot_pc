import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let loaded = false;

export function loadLocalEnv(): void {
  if (loaded) {
    return;
  }
  loaded = true;

  for (const filename of ['.env.local', '.env']) {
    const path = join(process.cwd(), filename);
    if (!existsSync(path)) {
      continue;
    }

    const content = readFileSync(path, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!process.env[key]) {
        process.env[key] = unquote(value);
      }
    }
  }
}




export function databaseUrl(): string | null {
  loadLocalEnv();
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  if (process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) {
      continue;
    }
    if (/^.+_DATABASE_URL$/.test(key) || /^.+_POSTGRES_URL$/.test(key)) {
      return value;
    }
  }
  return null;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
