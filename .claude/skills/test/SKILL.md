---
name: test
description: Generate and run tests for a specified target. Chains test generation and execution. Invoke with a file path or module name.
model: sonnet
context: fork
allowed-tools: Read, Write, Bash, Glob, Grep
---

Run the full test pipeline right now for:

**Target:** $ARGUMENTS (file path or module)

Steps:
1. Read and analyze the target code
2. Generate comprehensive tests (unit + integration). AAA pattern, descriptive names, edge cases, error paths.
3. Write test files to the appropriate location
4. Execute the tests with coverage enabled
5. For any failures: root-cause analysis with file:line and suggested fix
6. Report coverage — target 80%+

Bash restricted to test runners only: `npm test`, `pytest`, `go test`, `cargo test`, `forge test`. No installs or code modification via bash.
