// brain/tests/parser.test.ts
// Unit tests for parseNote() — bun:test, zero external dependencies

import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/parser.js";
import type { ParsedNote } from "../src/parser.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fm(fields: string): string {
  return `---\n${fields}\n---\n`;
}

// ─── Standard note ───────────────────────────────────────────────────────────

describe("parseNote — standard note", () => {
  const raw = [
    "---",
    "title: My Note",
    "tags: [ai, rag]",
    "status: active",
    "created: 2024-01-15",
    "---",
    "",
    "# My Note",
    "",
    "Some body text with [[target-note]] and [[other|Other Alias]].",
    "",
    "## Sub-heading",
    "",
    "Inline #inline-tag here.",
  ].join("\n");

  const result: ParsedNote = parseNote(raw, "fallback");

  test("title comes from frontmatter", () => {
    expect(result.title).toBe("My Note");
  });

  test("frontmatter parsed correctly", () => {
    expect(result.frontmatter["title"]).toBe("My Note");
    expect(result.frontmatter["status"]).toBe("active");
    expect(result.frontmatter["created"]).toBe("2024-01-15");
  });

  test("status extracted from frontmatter", () => {
    expect(result.status).toBe("active");
  });

  test("created_at extracted from frontmatter", () => {
    expect(result.created_at).toBe("2024-01-15");
  });

  test("wikilinks extracted from body", () => {
    const targets = result.wikilinks.map((w) => w.target);
    expect(targets).toContain("target-note");
    expect(targets).toContain("other");
  });

  test("wikilink alias extracted correctly", () => {
    const aliased = result.wikilinks.find((w) => w.target === "other");
    expect(aliased?.alias).toBe("Other Alias");
  });

  test("frontmatter tags merged with inline tags, deduped, sorted", () => {
    // frontmatter: [ai, rag]; inline: [inline-tag]
    expect(result.tags).toEqual(["ai", "inline-tag", "rag"]);
  });

  test("headings extracted with correct levels", () => {
    expect(result.headings).toContainEqual({ level: 1, text: "My Note" });
    expect(result.headings).toContainEqual({ level: 2, text: "Sub-heading" });
  });

  test("content does not include frontmatter block", () => {
    expect(result.content).not.toContain("---");
    expect(result.content).toContain("# My Note");
  });

  test("word_count is positive", () => {
    expect(result.word_count).toBeGreaterThan(0);
  });
});

// ─── Empty file ───────────────────────────────────────────────────────────────

describe("parseNote — empty file", () => {
  const result = parseNote("", "empty-file");

  test("title falls back to filename", () => {
    expect(result.title).toBe("empty-file");
  });

  test("tags is empty array", () => {
    expect(result.tags).toEqual([]);
  });

  test("wikilinks is empty array", () => {
    expect(result.wikilinks).toEqual([]);
  });

  test("headings is empty array", () => {
    expect(result.headings).toEqual([]);
  });

  test("content is empty string", () => {
    expect(result.content).toBe("");
  });

  test("word_count is 0", () => {
    expect(result.word_count).toBe(0);
  });

  test("frontmatter is empty object", () => {
    expect(result.frontmatter).toEqual({});
  });
});

// ─── Frontmatter-only note ───────────────────────────────────────────────────

describe("parseNote — frontmatter-only, no body", () => {
  const raw = ["---", "title: Meta Only", "tags: [meta]", "---"].join("\n");

  const result = parseNote(raw, "meta-only");

  test("title from frontmatter", () => {
    expect(result.title).toBe("Meta Only");
  });

  test("tags from frontmatter", () => {
    expect(result.tags).toEqual(["meta"]);
  });

  test("no wikilinks", () => {
    expect(result.wikilinks).toEqual([]);
  });

  test("word_count is 0", () => {
    expect(result.word_count).toBe(0);
  });
});

// ─── Wikilinks ───────────────────────────────────────────────────────────────

describe("parseNote — wikilink extraction", () => {
  test("simple wikilink extracts target", () => {
    const result = parseNote("See [[my-note]] for details.", "test");
    expect(result.wikilinks).toHaveLength(1);
    expect(result.wikilinks[0]?.target).toBe("my-note");
    expect(result.wikilinks[0]?.alias).toBeUndefined();
  });

  test("piped wikilink extracts target and alias", () => {
    const result = parseNote("See [[my-note|My Note Title]].", "test");
    const link = result.wikilinks[0];
    expect(link?.target).toBe("my-note");
    expect(link?.alias).toBe("My Note Title");
  });

  test("target is lowercased", () => {
    const result = parseNote("[[My-Note]]", "test");
    expect(result.wikilinks[0]?.target).toBe("my-note");
  });

  test("multiple wikilinks all extracted", () => {
    const raw = "[[note-a]], [[note-b]], [[note-c|C]]";
    const result = parseNote(raw, "test");
    expect(result.wikilinks).toHaveLength(3);
    const targets = result.wikilinks.map((w) => w.target);
    expect(targets).toEqual(["note-a", "note-b", "note-c"]);
  });

  test("wikilink context contains surrounding text", () => {
    const raw = "Before the link [[note-a]] after the link";
    const result = parseNote(raw, "test");
    expect(result.wikilinks[0]?.context).toContain("Before the link");
    expect(result.wikilinks[0]?.context).toContain("after the link");
  });

  test("wikilink inside fenced code block is skipped", () => {
    const raw = "Normal text.\n```\n[[inside-code]]\n```\nEnd.";
    const result = parseNote(raw, "test");
    expect(result.wikilinks).toHaveLength(0);
  });

  test("wikilink inside triple-backtick block with language hint is skipped", () => {
    const raw = "```typescript\nconst x = '[[code-link]]';\n```";
    const result = parseNote(raw, "test");
    expect(result.wikilinks).toHaveLength(0);
  });

  test("wikilink inside inline code is skipped", () => {
    const raw = "Run `[[inline-link]]` here.";
    const result = parseNote(raw, "test");
    expect(result.wikilinks).toHaveLength(0);
  });

  test("wikilink outside code block is still extracted when code block is present", () => {
    const raw = "[[real-link]]\n```\n[[fake-link]]\n```";
    const result = parseNote(raw, "test");
    expect(result.wikilinks).toHaveLength(1);
    expect(result.wikilinks[0]?.target).toBe("real-link");
  });
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

describe("parseNote — tag extraction", () => {
  test("inline tag extracted from body", () => {
    const result = parseNote("Hello #my-tag world", "test");
    expect(result.tags).toContain("my-tag");
  });

  test("inline tag lowercased", () => {
    const result = parseNote("#MyTag text", "test");
    expect(result.tags).toContain("mytag");
  });

  test("tag inside fenced code block is skipped", () => {
    const raw = "```\n#skipped-tag\n```";
    const result = parseNote(raw, "test");
    expect(result.tags).toHaveLength(0);
  });

  test("tag inside inline code is skipped", () => {
    const raw = "Run `#not-a-tag` to proceed.";
    const result = parseNote(raw, "test");
    expect(result.tags).toHaveLength(0);
  });

  test("frontmatter tags merged with inline tags", () => {
    const raw = fm("tags: [alpha, beta]") + "Body with #gamma inline.";
    const result = parseNote(raw, "test");
    expect(result.tags).toContain("alpha");
    expect(result.tags).toContain("beta");
    expect(result.tags).toContain("gamma");
  });

  test("duplicate tags deduplicated", () => {
    // 'alpha' appears in both frontmatter and inline
    const raw = fm("tags: [alpha]") + "Body #alpha again.";
    const result = parseNote(raw, "test");
    const alphaCount = result.tags.filter((t) => t === "alpha").length;
    expect(alphaCount).toBe(1);
  });

  test("merged tags are sorted alphabetically", () => {
    const raw = fm("tags: [zebra, apple]") + "#mango text";
    const result = parseNote(raw, "test");
    expect(result.tags).toEqual(["apple", "mango", "zebra"]);
  });

  test("frontmatter string tag (not array) accepted", () => {
    const raw = fm("tags: single-tag") + "body";
    const result = parseNote(raw, "test");
    expect(result.tags).toContain("single-tag");
  });
});

// ─── Headings ─────────────────────────────────────────────────────────────────

describe("parseNote — heading extraction", () => {
  const raw = [
    "# H1 Title",
    "## H2 Section",
    "### H3 Subsection",
    "#### H4 Deep",
    "Regular paragraph.",
  ].join("\n");

  const result = parseNote(raw, "test");

  test("H1 extracted", () => {
    expect(result.headings).toContainEqual({ level: 1, text: "H1 Title" });
  });

  test("H2 extracted", () => {
    expect(result.headings).toContainEqual({ level: 2, text: "H2 Section" });
  });

  test("H3 extracted", () => {
    expect(result.headings).toContainEqual({ level: 3, text: "H3 Subsection" });
  });

  test("H4 extracted", () => {
    expect(result.headings).toContainEqual({ level: 4, text: "H4 Deep" });
  });

  test("non-heading line not included", () => {
    const texts = result.headings.map((h) => h.text);
    expect(texts).not.toContain("Regular paragraph.");
  });

  test("heading count is correct", () => {
    expect(result.headings).toHaveLength(4);
  });
});

// ─── Title resolution ─────────────────────────────────────────────────────────

describe("parseNote — title resolution priority", () => {
  test("frontmatter title takes priority over H1", () => {
    const raw = fm("title: FM Title") + "# H1 Title\n\nbody";
    const result = parseNote(raw, "fallback");
    expect(result.title).toBe("FM Title");
  });

  test("H1 heading used when no frontmatter title", () => {
    const raw = "# H1 Title\n\nbody text";
    const result = parseNote(raw, "fallback");
    expect(result.title).toBe("H1 Title");
  });

  test("H1 heading used when frontmatter has no title key", () => {
    const raw = fm("tags: [test]") + "# My H1\n\nbody";
    const result = parseNote(raw, "fallback");
    expect(result.title).toBe("My H1");
  });

  test("fallback to filename when no frontmatter title and no H1", () => {
    const raw = "## Just an H2\n\nSome body text.";
    const result = parseNote(raw, "my-filename");
    expect(result.title).toBe("my-filename");
  });

  test("frontmatter title empty string falls through to H1", () => {
    const raw = fm("title: ''") + "# Real Title\n\nbody";
    const result = parseNote(raw, "fallback");
    // empty string should not be used as title — falls through
    expect(result.title).toBe("Real Title");
  });
});

// ─── Frontmatter parsing ─────────────────────────────────────────────────────

describe("parseNote — frontmatter parsing", () => {
  test("boolean values parsed", () => {
    const raw = fm("published: true\ndraft: false") + "body";
    const result = parseNote(raw, "test");
    expect(result.frontmatter["published"]).toBe(true);
    expect(result.frontmatter["draft"]).toBe(false);
  });

  test("numeric values parsed", () => {
    const raw = fm("priority: 42") + "body";
    const result = parseNote(raw, "test");
    expect(result.frontmatter["priority"]).toBe(42);
  });

  test("inline array parsed as array", () => {
    const raw = fm("tags: [a, b, c]") + "body";
    const result = parseNote(raw, "test");
    expect(result.frontmatter["tags"]).toEqual(["a", "b", "c"]);
  });

  test("YAML list (dash style) parsed as array", () => {
    const raw = ["---", "tags:", "  - alpha", "  - beta", "---", "body"].join("\n");
    const result = parseNote(raw, "test");
    expect(result.frontmatter["tags"]).toEqual(["alpha", "beta"]);
  });

  test("malformed YAML frontmatter returns empty object without throwing", () => {
    // Intentionally weird YAML that could cause parse errors
    const raw = "---\n: invalid: : yaml ::\n---\nbody";
    let result: ParsedNote | undefined;
    expect(() => {
      result = parseNote(raw, "test");
    }).not.toThrow();
    // Should still return a usable ParsedNote
    expect(result).toBeDefined();
    expect(result?.content).toContain("body");
  });

  test("aliases array extracted into aliases field", () => {
    const raw = fm("aliases: [alias-one, alias-two]") + "body";
    const result = parseNote(raw, "test");
    expect(result.aliases).toEqual(["alias-one", "alias-two"]);
  });

  test("aliases string extracted into aliases array", () => {
    const raw = fm("aliases: single-alias") + "body";
    const result = parseNote(raw, "test");
    expect(result.aliases).toEqual(["single-alias"]);
  });

  test("missing aliases returns empty array", () => {
    const result = parseNote("just body", "test");
    expect(result.aliases).toEqual([]);
  });
});

// ─── Word count ───────────────────────────────────────────────────────────────

describe("parseNote — word count", () => {
  test("counts words in body correctly", () => {
    const result = parseNote("one two three four five", "test");
    expect(result.word_count).toBe(5);
  });

  test("frontmatter words excluded from count", () => {
    const raw = fm("title: Frontmatter Words Should Not Count") + "one two three";
    const result = parseNote(raw, "test");
    expect(result.word_count).toBe(3);
  });

  test("extra whitespace does not inflate word count", () => {
    const result = parseNote("word1   word2\n\nword3", "test");
    expect(result.word_count).toBe(3);
  });

  test("empty body has word count of 0", () => {
    const result = parseNote(fm("title: Empty"), "test");
    expect(result.word_count).toBe(0);
  });
});

// ─── UTF-8 content ────────────────────────────────────────────────────────────

describe("parseNote — UTF-8 content", () => {
  test("unicode characters in body handled correctly", () => {
    const raw = "Héllo wörld — こんにちは 🧠 [[unicode-link]]";
    const result = parseNote(raw, "utf8-test");
    expect(result.content).toContain("こんにちは");
    expect(result.content).toContain("🧠");
  });

  test("unicode title in frontmatter parsed", () => {
    const raw = fm("title: 日本語タイトル") + "body text";
    const result = parseNote(raw, "fallback");
    expect(result.title).toBe("日本語タイトル");
  });

  test("unicode in wikilink target lowercased correctly", () => {
    const raw = "See [[Über-Note]] here.";
    const result = parseNote(raw, "test");
    expect(result.wikilinks[0]?.target).toBe("über-note");
  });
});
