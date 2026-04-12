import { readdir, stat } from "fs/promises";
import { join } from "path";

const SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
]);

const MAX_SUBENTRIES_SHOWN = 10;

export async function architectureMap(path: string): Promise<string> {
  const projectName = path.split("/").pop() ?? path;

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return `Architecture: ${projectName}\n${"=".repeat(40)}\n\nError: cannot read directory\n`;
  }

  const sorted = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  let map = `Architecture: ${projectName}\n${"=".repeat(40)}\n\n`;

  for (const entry of sorted) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_NAMES.has(entry.name)) continue;

    if (entry.isDirectory()) {
      map += `[dir]  ${entry.name}/\n`;

      try {
        const subEntries = await readdir(join(path, entry.name));
        const subSorted = subEntries
          .filter((n) => !n.startsWith(".") && !SKIP_NAMES.has(n))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

        const shown = subSorted.slice(0, MAX_SUBENTRIES_SHOWN);
        const remaining = subSorted.length - shown.length;

        for (const sub of shown) {
          map += `   |-- ${sub}\n`;
        }
        if (remaining > 0) {
          map += `   \`-- ... (${remaining} more)\n`;
        }
      } catch {
        map += `   \`-- (unreadable)\n`;
      }
    } else if (entry.isFile()) {
      map += `[file] ${entry.name}\n`;
    }
  }

  return map;
}

export async function safeArchitectureMap(
  path: unknown
): Promise<string | { error: string }> {
  if (typeof path !== "string" || path.trim() === "") {
    return { error: "path must be a non-empty string" };
  }

  const normalized = path.replace(/\/+$/, "");
  if (normalized.includes("..")) {
    return { error: "path must not contain '..' segments" };
  }

  try {
    const s = await stat(normalized);
    if (!s.isDirectory()) {
      return { error: "path must point to a directory" };
    }
  } catch {
    return { error: `path does not exist or is not accessible: ${normalized}` };
  }

  return architectureMap(normalized);
}
