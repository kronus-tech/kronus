import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

export interface BrainRoot {
  readonly path: string;
  readonly label: string; // "personal" or "project"
}

export interface BrainConfig {
  readonly brainRoots: BrainRoot[];
  readonly brainRoot: string;   // backward compat: first root path
  readonly dbPath: string;
  readonly uiPort: number;
}

export function loadConfig(): BrainConfig {
  const home = homedir();

  const dbPath = process.env["BRAIN_DB"] ?? join(home, ".kronus", "brain.sqlite");
  const uiPort = Number(process.env["BRAIN_UI_PORT"] ?? 4242);

  // Multi-root: BRAIN_ROOTS=path1|label1,path2|label2
  // Default: personal brain + project memories
  let brainRoots: BrainRoot[];

  if (process.env["BRAIN_ROOTS"]) {
    brainRoots = process.env["BRAIN_ROOTS"].split(",")
      .map(entry => {
        const [path, label] = entry.split("|");
        return { path: path.trim(), label: (label?.trim() || "personal") };
      })
      .filter(r => r.path.length > 0); // Filter out blank entries from trailing commas
  } else {
    brainRoots = [
      { path: join(home, "second-brain"), label: "personal" },
      { path: join(home, ".claude", "projects"), label: "project" },
    ];
  }

  // Warn about missing roots (but don't crash)
  for (const root of brainRoots) {
    if (!existsSync(root.path)) {
      console.error(
        `[brain] WARNING: brain root does not exist: ${root.path} (${root.label})`
      );
    }
  }

  return {
    brainRoots,
    brainRoot: brainRoots[0]?.path ?? join(home, "second-brain"),
    dbPath,
    uiPort,
  };
}
