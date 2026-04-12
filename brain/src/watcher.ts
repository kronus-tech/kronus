// brain-mcp Phase 1 — File watcher with debounce

import { watch, existsSync, type FSWatcher } from "fs";
import { join, resolve } from "path";
import { Indexer } from "./indexer.js";
import type { BrainRoot } from "./config.js";

export class BrainWatcher {
  private watchers: FSWatcher[] = [];
  private readonly debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 500;

  start(roots: BrainRoot[], indexer: Indexer): void {
    for (const root of roots) {
      if (!existsSync(root.path)) continue;

      const w = watch(
        root.path,
        { recursive: true },
        (event: string, filename: string | null) => {
          if (!filename || !filename.endsWith(".md")) return;
          // For project roots, only watch memory subdirs
          if (root.label === "project" && !filename.includes("/memory/")) return;
          // BRAIN-015: Resolve and validate path stays within root
          const abs = resolve(join(root.path, filename));
          if (!abs.startsWith(resolve(root.path) + "/")) return;
          this.debounce(abs, () => this.handleChange(abs, event, indexer, root.path, root.label));
        }
      );
      this.watchers.push(w);
      console.error(`[brain] Watching ${root.path} (${root.label})`);
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    for (const timer of this.debounceMap.values()) clearTimeout(timer);
    this.debounceMap.clear();
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceMap.get(key);
    if (existing) clearTimeout(existing);
    this.debounceMap.set(
      key,
      setTimeout(() => {
        this.debounceMap.delete(key);
        fn();
      }, this.DEBOUNCE_MS)
    );
  }

  private handleChange(abs: string, event: string, indexer: Indexer, rootPath: string, rootLabel: string): void {
    if (event === "rename" && !existsSync(abs)) {
      indexer.removeFile(abs, rootPath);
      console.error(`[brain] Removed: ${abs}`);
    } else {
      try {
        const changed = indexer.indexFile(abs, rootPath, rootLabel);
        if (changed) console.error(`[brain] Indexed: ${abs} (${rootLabel})`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[brain] Error indexing ${abs}:`, err);
        }
      }
    }
  }
}
