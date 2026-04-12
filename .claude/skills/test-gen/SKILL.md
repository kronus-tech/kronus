---
name: test-gen
description: Generate unit/integration tests for a file or module. Auto-invoked when user says "write tests for", "test this", "generate tests", or "add tests".
model: sonnet
context: fork
allowed-tools: Read, Write, Glob, Grep
---

Generate comprehensive tests for the following target right now:

**Target:** $ARGUMENTS (file path or module name)

Steps:
1. Read the target file and understand all exports, functions, classes
2. Detect the test framework from the project (package.json → Jest/Vitest, pyproject.toml → pytest, go.mod → go test, Cargo.toml → cargo test, foundry.toml → Foundry)
3. Write tests following AAA pattern (Arrange-Act-Assert)

Coverage requirements:
- Happy path for every exported function/method
- Edge cases: empty inputs, null/undefined, boundary values, zero, negative numbers
- Error paths: invalid inputs, thrown exceptions, rejected promises
- Target 80%+ coverage (95%+ for auth/payments/data paths)

Quality rules:
- Descriptive names: `it("should return 401 when token is expired")`
- One assertion per test where practical
- Use factories/fixtures for test data — no hardcoded magic values
- Mock external services, use real deps for integration tests

Write the test file(s) to the appropriate location. Return a summary of what was generated.
