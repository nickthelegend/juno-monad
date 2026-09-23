import { Pool, type PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __junoPgPool: Pool | undefined;
}

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function sslConfig(url: string): PoolConfig["ssl"] {
  if (process.env.DATABASE_SSL === "disable") return undefined;
  if (process.env.DATABASE_SSL === "require") return { rejectUnauthorized: false };

  const normalized = url.toLowerCase();
  if (
    normalized.includes("sslmode=require") ||
    normalized.includes("supabase.") ||
    normalized.includes("pooler.supabase.com")
  ) {
    return { rejectUnauthorized: false };
  }

  return undefined;
}

/**
 * `sslmode` in the connection string is redundant once `ssl` is passed
 * explicitly, and pg now warns that the aliases ('prefer', 'require',
 * 'verify-ca') change meaning in v9. Dropping the parameter keeps this pool on
 * the policy `sslConfig` decides rather than one libpq semantics will shift
 * under us.
 */
function stripSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getPgPool() {
  const rawUrl = databaseUrl();
  const connectionString = stripSslMode(rawUrl);

  if (!globalThis.__junoPgPool) {
    globalThis.__junoPgPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: sslConfig(rawUrl),
    });
  }

  return globalThis.__junoPgPool;
}
