import { stat } from "fs/promises";
import { walkDir } from "./analyze-repo.js";
import type { PatternFinding, PatternResult } from "../types.js";

const VALID_PATTERN_TYPES = new Set(["large_files", "deep_nesting", "no_tests"]);

const LARGE_FILE_THRESHOLD = 100_000; // 100 KB

async function checkLargeFiles(
  files: string[],
  findings: PatternFinding[]
): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      try {
        const s = await stat(file);
        if (s.size > LARGE_FILE_THRESHOLD) {
          findings.push({
            type: "large_files",
            file,
            detail: `${Math.round(s.size / 1024)}KB`,
          });
        }
      } catch {
        // file vanished during walk — skip
      }
    })
  );
}

function checkDeepNesting(
  files: string[],
  basePath: string,
  findings: PatternFinding[]
): void {
  for (const file of files) {
    const relative = file.replace(basePath, "");
    // Count path segments after the base — depth is number of slashes minus leading slash
    const depth = relative.split("/").length - 1;
    if (depth > 6) {
      findings.push({
        type: "deep_nesting",
        file,
        detail: `depth: ${depth}`,
      });
    }
  }
}

function checkNoTests(
  files: string[],
  basePath: string,
  findings: PatternFinding[]
): void {
  const hasTests = files.some((f) => {
    const lower = f.toLowerCase();
    return lower.includes("test") || lower.includes("spec") || lower.includes("__tests__");
  });

  if (!hasTests) {
    findings.push({
      type: "no_tests",
      file: basePath,
      detail: "No test files found in repository",
    });
  }
}

export async function findPatterns(
  path: string,
  patternTypes: string[]
): Promise<PatternResult> {
  const findings: PatternFinding[] = [];
  const files = await walkDir(path);

  const checks: Array<Promise<void> | void> = [];

  if (patternTypes.includes("large_files")) {
    checks.push(checkLargeFiles(files, findings));
  }

  if (patternTypes.includes("deep_nesting")) {
    checks.push(Promise.resolve(checkDeepNesting(files, path, findings)));
  }

  if (patternTypes.includes("no_tests")) {
    checks.push(Promise.resolve(checkNoTests(files, path, findings)));
  }

  await Promise.all(checks);

  return {
    path,
    patterns_checked: patternTypes,
    findings,
  };
}

export async function safeFindPatterns(
  path: unknown,
  patternTypes: unknown
): Promise<PatternResult | { error: string }> {
  if (typeof path !== "string" || path.trim() === "") {
    return { error: "path must be a non-empty string" };
  }

  const normalized = path.replace(/\/+$/, "");
  if (normalized.includes("..")) {
    return { error: "path must not contain '..' segments" };
  }

  let types: string[];
  if (Array.isArray(patternTypes) && patternTypes.length > 0) {
    types = patternTypes.map(String);
    const invalid = types.filter((t) => !VALID_PATTERN_TYPES.has(t));
    if (invalid.length > 0) {
      return {
        error: `unknown pattern types: ${invalid.join(", ")}. Valid types: ${[...VALID_PATTERN_TYPES].join(", ")}`,
      };
    }
  } else {
    // Default: run all patterns
    types = [...VALID_PATTERN_TYPES];
  }

  try {
    const s = await stat(normalized);
    if (!s.isDirectory()) {
      return { error: "path must point to a directory" };
    }
  } catch {
    return { error: `path does not exist or is not accessible: ${normalized}` };
  }

  return findPatterns(normalized, types);
}
