import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import type { AnalysisResult } from "../types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  ".cache",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
]);

export async function walkDir(
  dir: string,
  maxDepth = 5,
  currentDepth = 0
): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const fullPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const nested = await walkDir(fullPath, maxDepth, currentDepth + 1);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function analyzeRepo(path: string): Promise<AnalysisResult> {
  const files = await walkDir(path);

  const languages: Record<string, number> = {};
  for (const file of files) {
    const ext = extname(file).toLowerCase() || "no-ext";
    languages[ext] = (languages[ext] ?? 0) + 1;
  }

  let topLevel: string[] = [];
  try {
    topLevel = await readdir(path);
  } catch {
    // path unreadable — leave empty
  }

  const sortedLanguages = Object.entries(languages).sort(
    (a, b) => b[1] - a[1]
  );

  return {
    path,
    file_count: files.length,
    languages: sortedLanguages,
    top_level_items: topLevel,
    has_package_json: topLevel.includes("package.json"),
    has_tsconfig: topLevel.includes("tsconfig.json"),
    has_dockerfile: topLevel.includes("Dockerfile"),
    has_readme: topLevel.some((f) => f.toLowerCase().startsWith("readme")),
  };
}

export async function safeAnalyzeRepo(
  path: unknown
): Promise<AnalysisResult | { error: string }> {
  if (typeof path !== "string" || path.trim() === "") {
    return { error: "path must be a non-empty string" };
  }

  // Prevent path traversal
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

  return analyzeRepo(normalized);
}
