import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../lib/config.js";
import * as schema from "./schema.js";

const config = getConfig();
const sql = postgres(config.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { sql };
