import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use a direct/unpooled URL for DDL operations when the provider exposes one.
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_DIRECT_URL ??
      process.env.DATABASE_URL!,
  },
} satisfies Config;
