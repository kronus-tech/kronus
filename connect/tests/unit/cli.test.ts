// tests/unit/cli.test.ts
// CLI tests run the CLI as a subprocess to avoid commander's process.exit() calls
// affecting the test runner process. Each test spawns a fresh process.
//
// Run from the connect/ directory: bun test tests/unit/cli.test.ts

import { describe, it, expect } from "bun:test";
import { $ } from "bun";

// All CLI invocations are relative to the connect/ package root so that
// `bun run src/cli.ts` resolves correctly regardless of where `bun test` is
// launched from.
const CLI = "src/cli.ts";

// Helper: run the CLI with the given arguments and return stdout + stderr combined.
// nothrow() prevents Bun from throwing on non-zero exit codes (commander exits 0
// for --help/--version but the tests should be resilient either way).
async function runCli(...args: string[]): Promise<string> {
  const result = await $`bun run ${CLI} ${args} 2>&1`.nothrow().text();
  return result;
}

describe("kronus CLI", () => {
  // ------------------------------------------------------------------
  // Help & version
  // ------------------------------------------------------------------

  describe("--help", () => {
    it('should include "Kronus Connect" in the help output', async () => {
      // Arrange
      // (no setup needed — just the CLI binary)

      // Act
      const output = await runCli("--help");

      // Assert
      expect(output).toContain("Kronus Connect");
    });

    it("should list the kronus binary name in the help output", async () => {
      // Arrange & Act
      const output = await runCli("--help");

      // Assert
      expect(output).toContain("kronus");
    });
  });

  describe("--version", () => {
    it('should output "5.3.0-dev"', async () => {
      // Arrange & Act
      const output = await runCli("--version");

      // Assert
      expect(output.trim()).toBe("5.3.0-dev");
    });
  });

  // ------------------------------------------------------------------
  // Implemented commands (connect, disconnect, status)
  // These now have real implementations — test behavior, not stubs
  // ------------------------------------------------------------------

  describe("disconnect command", () => {
    it("should output not connected when no identity exists", async () => {
      // Act — disconnect with no identity.json should say not connected
      const output = await runCli("disconnect");

      // Assert
      expect(output).toContain("Not connected");
    });
  });

  describe("status command", () => {
    it("should output not connected when no identity exists", async () => {
      // Act
      const output = await runCli("status");

      // Assert
      expect(output).toContain("Not connected");
    });
  });

  // Note: 'kronus connect' requires interactive readline input so it cannot
  // be tested as a subprocess here. Integration tests cover the connect flow.

  // ------------------------------------------------------------------
  // Implemented commands (require connection — test error behavior)
  // ------------------------------------------------------------------

  describe("apps command", () => {
    it("should error when not connected", async () => {
      const output = await runCli("apps");
      expect(output).toContain("Not connected");
    });
  });

  describe("install command", () => {
    it("should error when not connected", async () => {
      const output = await runCli("install", "test-app");
      expect(output).toContain("Not connected");
    });
  });

  describe("usage command", () => {
    it("should show no apps when none installed", async () => {
      const output = await runCli("usage");
      expect(output).toContain("No apps installed");
    });
  });

  describe("publish command", () => {
    it("should error when manifest not found", async () => {
      const output = await runCli("publish", "./nonexistent-dir");
      expect(output).toContain("Could not read");
    });
  });
});
