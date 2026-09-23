import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getPgPool } from "./pool";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    _db = drizzle(getPgPool(), { schema });
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;
