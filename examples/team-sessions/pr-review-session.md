# Example: PR Review Team Session

## Scenario
A pull request has been submitted with changes to the authentication system. We need a thorough review covering code quality, security, and test coverage.

## Team Configuration
- **Team:** security-review
- **Strategy:** sequential
- **Agents:** security-auditor, fuzzing-agent, test-generator, code-reviewer

## Invocation

```bash
# Using kronus-team.sh
./scripts/kronus-team.sh \
  --team security-review \
  --task "Review PR #42: Add OAuth2 authentication with Google provider" \
  --dir ~/projects/myapp \
  --strategy sequential
```

## Expected Flow

### Step 1: security-auditor
- Scans auth code for OWASP Top 10 vulnerabilities
- Checks token storage, session management
- Verifies CSRF protection
- Output: Security findings report

### Step 2: fuzzing-agent
- Generates adversarial inputs for OAuth callback endpoint
- Tests token validation with malformed JWTs
- Tests session fixation scenarios
- Output: Fuzz test cases

### Step 3: test-generator
- Creates integration tests for OAuth flow
- Generates edge case tests from fuzzing results
- Output: Test files

### Step 4: code-reviewer
- Reviews code quality and maintainability
- Checks error handling and logging
- Verifies PR follows coding standards
- Output: Review comments with severity ratings

## Expected Output

Combined report with:
- Security findings (critical/high/medium/low)
- Fuzz test results and edge cases discovered
- Generated test files
- Code review comments
- Overall PR approval recommendation
