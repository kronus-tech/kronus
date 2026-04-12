import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { safeAnalyzeRepo } from "./tools/analyze-repo.js";
import { safeDependencyGraph } from "./tools/dependency-graph.js";
import { safeFindPatterns } from "./tools/find-patterns.js";
import { safeArchitectureMap } from "./tools/architecture-map.js";

// Use the demo app's own directory as a real test fixture — resolve to avoid ".." in path.
const FIXTURE_PATH = resolve(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// analyze_repo
// ---------------------------------------------------------------------------

describe("safeAnalyzeRepo", () => {
  it("should return an AnalysisResult for a valid directory", async () => {
    const result = await safeAnalyzeRepo(FIXTURE_PATH);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.file_count).toBeGreaterThan(0);
      expect(result.languages.length).toBeGreaterThan(0);
      expect(Array.isArray(result.top_level_items)).toBe(true);
      expect(typeof result.has_package_json).toBe("boolean");
      expect(typeof result.has_tsconfig).toBe("boolean");
      expect(typeof result.has_dockerfile).toBe("boolean");
      expect(typeof result.has_readme).toBe("boolean");
    }
  });

  it("should detect package.json in the fixture", async () => {
    const result = await safeAnalyzeRepo(FIXTURE_PATH);
    if (!("error" in result)) {
      expect(result.has_package_json).toBe(true);
    }
  });

  it("should detect tsconfig.json in the fixture", async () => {
    const result = await safeAnalyzeRepo(FIXTURE_PATH);
    if (!("error" in result)) {
      expect(result.has_tsconfig).toBe(true);
    }
  });

  it("should sort languages by count descending", async () => {
    const result = await safeAnalyzeRepo(FIXTURE_PATH);
    if (!("error" in result)) {
      const counts = result.languages.map(([, count]) => count);
      for (let i = 1; i < counts.length; i++) {
        expect((counts[i - 1] ?? 0) >= (counts[i] ?? 0)).toBe(true);
      }
    }
  });

  it("should return error for a non-existent path", async () => {
    const result = await safeAnalyzeRepo("/this/does/not/exist/12345");
    expect("error" in result).toBe(true);
  });

  it("should return error for empty path", async () => {
    const result = await safeAnalyzeRepo("");
    expect("error" in result).toBe(true);
  });

  it("should return error for path with traversal", async () => {
    const result = await safeAnalyzeRepo("/some/../etc/passwd");
    expect("error" in result).toBe(true);
  });

  it("should return error for non-string input", async () => {
    const result = await safeAnalyzeRepo(42);
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dependency_graph
// ---------------------------------------------------------------------------

describe("safeDependencyGraph", () => {
  it("should parse npm dependencies from the fixture", async () => {
    const result = await safeDependencyGraph(FIXTURE_PATH);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.managers).toContain("npm");
      expect(result.dependencies.length).toBeGreaterThan(0);
      const npmDeps = result.dependencies.filter((d) => d.manager === "npm");
      expect(npmDeps.length).toBeGreaterThan(0);
    }
  });

  it("should return dev deps with type=dev", async () => {
    const result = await safeDependencyGraph(FIXTURE_PATH);
    if (!("error" in result)) {
      const devDeps = result.dependencies.filter((d) => d.type === "dev");
      expect(devDeps.length).toBeGreaterThan(0);
    }
  });

  it("should return empty result for directory with no manifest files", async () => {
    const result = await safeDependencyGraph("/tmp");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.managers.length).toBe(0);
      expect(result.dependencies.length).toBe(0);
    }
  });

  it("should return error for non-existent path", async () => {
    const result = await safeDependencyGraph("/does/not/exist/99999");
    expect("error" in result).toBe(true);
  });

  it("should return error for empty path", async () => {
    const result = await safeDependencyGraph("");
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// find_patterns
// ---------------------------------------------------------------------------

describe("safeFindPatterns", () => {
  it("should return a PatternResult for a valid directory", async () => {
    const result = await safeFindPatterns(FIXTURE_PATH, ["no_tests"]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.path).toBe(FIXTURE_PATH);
      expect(result.patterns_checked).toContain("no_tests");
      expect(Array.isArray(result.findings)).toBe(true);
    }
  });

  it("should default to all patterns when pattern_types is omitted", async () => {
    const result = await safeFindPatterns(FIXTURE_PATH, undefined);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.patterns_checked.length).toBe(3);
    }
  });

  it("should return error for unknown pattern type", async () => {
    const result = await safeFindPatterns(FIXTURE_PATH, ["not_a_real_pattern"]);
    expect("error" in result).toBe(true);
  });

  it("should return error for non-existent path", async () => {
    const result = await safeFindPatterns("/does/not/exist", ["no_tests"]);
    expect("error" in result).toBe(true);
  });

  it("should return error for empty path", async () => {
    const result = await safeFindPatterns("", ["no_tests"]);
    expect("error" in result).toBe(true);
  });

  it("should return error for path traversal", async () => {
    const result = await safeFindPatterns("/a/../b", ["no_tests"]);
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// architecture_map
// ---------------------------------------------------------------------------

describe("safeArchitectureMap", () => {
  it("should return a non-empty string for a valid directory", async () => {
    const result = await safeArchitectureMap(FIXTURE_PATH);
    expect(typeof result).toBe("string");
    if (typeof result === "string") {
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("Architecture:");
    }
  });

  it("should include src directory in the map", async () => {
    const result = await safeArchitectureMap(FIXTURE_PATH);
    if (typeof result === "string") {
      expect(result).toContain("src");
    }
  });

  it("should not include node_modules in the map", async () => {
    const result = await safeArchitectureMap(FIXTURE_PATH);
    if (typeof result === "string") {
      expect(result).not.toContain("node_modules");
    }
  });

  it("should return error for non-existent path", async () => {
    const result = await safeArchitectureMap("/does/not/exist/99999");
    expect(typeof result).toBe("object");
    if (typeof result === "object" && "error" in result) {
      expect(typeof result.error).toBe("string");
    }
  });

  it("should return error for empty path", async () => {
    const result = await safeArchitectureMap("");
    expect(typeof result).toBe("object");
  });
});
