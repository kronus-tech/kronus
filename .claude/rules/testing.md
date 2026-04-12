# Testing Rules

## Coverage
- Target 80%+ code coverage on all projects
- Critical paths (auth, payments, data) require 95%+ coverage
- Coverage reports must be generated on every CI run

## Test Quality
- Use descriptive test names: `it("should return 401 when token is expired")`
- One assertion per test where practical
- Test behavior, not implementation details
- Include edge cases: empty inputs, boundary values, null/undefined
- Test error paths, not just happy paths

## Test Structure
- Arrange-Act-Assert (AAA) pattern
- Use factories/fixtures for test data — no hardcoded test values
- Mock external services (APIs, databases) in unit tests
- Use real dependencies in integration tests

## Frameworks
- TypeScript/JavaScript: Jest or Vitest
- Python: pytest with pytest-cov
- React: React Testing Library (not Enzyme)
- E2E: Playwright or Cypress

## CI Integration
- Tests must pass before merge
- Flaky tests must be fixed immediately or quarantined
- Test runs should complete in under 5 minutes
