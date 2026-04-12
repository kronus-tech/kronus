import { type Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

interface MetadataRow {
  value: string;
}

export function runMigrations(db: Database): void {
  // Get current schema version from metadata table.
  // On first run the table doesn't exist yet — that's fine, version = 0.
  let currentVersion = 0;
  try {
    const row = db
      .query<MetadataRow, []>("SELECT value FROM metadata WHERE key = 'schema_version'")
      .get();
    currentVersion = row ? parseInt(row.value, 10) : 0;
  } catch {
    // metadata table doesn't exist yet — first run
    currentVersion = 0;
  }

  // Find migration files: 001_initial.sql, 002_add_feature.sql, etc.
  const migrationsDir = join(import.meta.dir, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const versionStr = file.split("_")[0];
    if (versionStr === undefined) continue;
    const version = parseInt(versionStr, 10);
    if (isNaN(version) || version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf-8");

    // Execute the full migration SQL in a transaction.
    // INSERT OR REPLACE handles the case where metadata row already exists
    // from a previous partial run.
    db.transaction(() => {
      db.exec(sql);
      db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)",
        [String(version)]
      );
    })();

    console.log(`[brain] Migration ${file} applied (schema version → ${version})`);
  }
}
