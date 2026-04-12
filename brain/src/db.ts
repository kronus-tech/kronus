import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "./config.js";
import { runMigrations } from "./migrations.js";

const config = loadConfig();

// Ensure ~/.kronus/ directory exists before opening the database
mkdirSync(dirname(config.dbPath), { recursive: true });

// Open database — WAL mode + foreign keys enforced from the start
const db = new Database(config.dbPath);
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA foreign_keys=ON");
db.run("PRAGMA busy_timeout=3000");

// Run pending migrations on startup (idempotent)
runMigrations(db);

export function getDb(): Database {
  return db;
}

export function closeDb(): void {
  db.close();
}
