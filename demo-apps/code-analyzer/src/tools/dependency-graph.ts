import { readFile, stat } from "fs/promises";
import { join } from "path";
import type { DepGraph, Dependency, DependencyType } from "../types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function parsePackageJson(
  path: string,
  result: DepGraph
): Promise<void> {
  const pkgPath = join(path, "package.json");
  if (!(await fileExists(pkgPath))) return;

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    result.managers.push("npm");

    const addDeps = (
      deps: unknown,
      type: DependencyType
    ): void => {
      if (deps === null || typeof deps !== "object") return;
      for (const [name, version] of Object.entries(
        deps as Record<string, unknown>
      )) {
        result.dependencies.push({
          name,
          version: String(version),
          manager: "npm",
          type,
        });
      }
    };

    addDeps(pkg["dependencies"], "runtime");
    addDeps(pkg["devDependencies"], "dev");
    addDeps(pkg["peerDependencies"], "peer");
  } catch {
    // malformed package.json — skip
  }
}

async function parseRequirementsTxt(
  path: string,
  result: DepGraph
): Promise<void> {
  const reqPath = join(path, "requirements.txt");
  if (!(await fileExists(reqPath))) return;

  try {
    const raw = await readFile(reqPath, "utf-8");
    result.managers.push("pip");

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
        continue;
      }
      // Split on first occurrence of version specifier chars
      const match = trimmed.match(/^([A-Za-z0-9_.\-[\]]+)\s*([>=<!~,\s].*)?$/);
      if (!match) continue;
      const name = (match[1] ?? trimmed).trim();
      const version = match[2] ? match[2].trim() : "*";
      result.dependencies.push({
        name,
        version,
        manager: "pip",
        type: "runtime",
      });
    }
  } catch {
    // unreadable — skip
  }
}

async function parseGoMod(path: string, result: DepGraph): Promise<void> {
  const gomodPath = join(path, "go.mod");
  if (!(await fileExists(gomodPath))) return;

  try {
    const raw = await readFile(gomodPath, "utf-8");
    result.managers.push("go");

    // Match single-line requires: require module/path v1.2.3
    const singleLineRe = /^require\s+(\S+)\s+(\S+)/gm;
    for (const match of raw.matchAll(singleLineRe)) {
      const name = match[1];
      const version = match[2];
      if (name && version) {
        result.dependencies.push({
          name,
          version,
          manager: "go",
          type: "runtime",
        });
      }
    }

    // Match block requires: require ( ... )
    const blockMatch = raw.match(/require\s*\(([\s\S]*?)\)/);
    if (blockMatch?.[1]) {
      for (const line of blockMatch[1].split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] && parts[1]) {
          // Avoid duplicating single-line requires already captured
          const alreadyAdded = result.dependencies.some(
            (d) => d.manager === "go" && d.name === parts[0]
          );
          if (!alreadyAdded) {
            result.dependencies.push({
              name: parts[0],
              version: parts[1],
              manager: "go",
              type: "runtime",
            });
          }
        }
      }
    }
  } catch {
    // unreadable — skip
  }
}

export async function dependencyGraph(path: string): Promise<DepGraph> {
  const result: DepGraph = { managers: [], dependencies: [] };

  await Promise.all([
    parsePackageJson(path, result),
    parseRequirementsTxt(path, result),
    parseGoMod(path, result),
  ]);

  return result;
}

export async function safeDependencyGraph(
  path: unknown
): Promise<DepGraph | { error: string }> {
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

  return dependencyGraph(normalized);
}
