# Example Workflows

Common multi-agent workflows for Kronus.

---

## 🚀 Full-Stack Feature Development

**Goal**: Build a complete feature from architecture to deployment.

**Workflow**:
```
1. "Invoke planner to build user authentication with email/password and OAuth"

   planner breaks down into:
   ↓
2. "Invoke ai-engineer to recommend auth approach"
   → Recommends NextAuth.js with Prisma
   ↓
3. "Invoke backend-infra to implement NextAuth with Google OAuth"
   → Creates auth API routes, Prisma schema
   ↓
4. "Invoke frontend-dev to create login/register forms"
   → Builds forms with React Hook Form + Zod
   ↓
5. "Invoke test-generator to create auth integration tests"
   → Generates test suite
   ↓
6. "Invoke test-runner to execute auth tests"
   → Runs tests, reports results
   ↓
7. "Invoke security-auditor to audit auth implementation"
   → Checks for vulnerabilities
   ↓
8. "Invoke code-reviewer to review the auth PR"
   → Final quality check
```

**Result**: Production-ready authentication system with tests and security audit.

---

## 🔒 Security Audit Pipeline

**Goal**: Comprehensive security analysis of codebase.

**Workflow**:
```
1. "Invoke security-auditor to scan for vulnerabilities"
   → Dependency scan (npm audit)
   → SAST (SQL injection, XSS)
   → Secret detection
   ↓
2. "Invoke fuzzing-agent to generate adversarial test inputs"
   → API endpoint fuzzing
   → Injection payloads
   ↓
3. "Invoke test-generator to create security regression tests"
   → Tests for found vulnerabilities
   ↓
4. "Invoke code-reviewer to verify fixes"
   → Ensure vulnerabilities are patched
```

**Result**: Security report + regression tests + verified fixes.

---

## 📝 Client Proposal Workflow

**Goal**: Win a client project with optimized profile and compelling proposal.

**Workflow**:
```
1. "Invoke profile-optimizer to optimize my LinkedIn profile"
   → Updated headline, summary
   ↓
2. [Client reaches out]
   ↓
3. "Invoke meeting-notes to extract requirements from discovery call transcript"
   → Action items, project scope
   ↓
4. "Invoke proposal-writer to create proposal for AI chatbot, $45K, 10 weeks"
   → Complete proposal with ROI analysis
   ↓
5. [Send proposal to client]
   ↓
6. "Invoke meeting-notes to track next steps from follow-up call"
   → Contract details, timeline
```

**Result**: Professional proposal → signed contract.

---

## 🧪 Test-Driven Development

**Goal**: Build feature with tests first.

**Workflow**:
```
1. "Invoke test-generator to create tests for email validation API"
   → Test file with expected behavior
   ↓
2. "Invoke backend-infra to implement the email validation API"
   → API route with validation logic
   ↓
3. "Invoke test-runner to execute tests"
   → Tests pass ✅
   ↓
4. "Invoke fuzzing-agent to generate edge case inputs"
   → Additional test cases
   ↓
5. "Invoke test-runner to execute fuzz tests"
   → Find edge case bug 🐛
   ↓
6. "Invoke backend-infra to fix edge case handling"
   → Updated validation
   ↓
7. "Invoke test-runner to verify fix"
   → All tests pass ✅
```

**Result**: Robust, well-tested feature.

---

## 🎨 Landing Page Creation

**Goal**: Build high-converting landing page.

**Workflow**:
```
1. "Invoke seo-writer to research keywords for AI chatbot SaaS landing page"
   → Target keywords identified
   ↓
2. "Invoke frontend-dev to create landing page with hero, features, pricing, CTA"
   → Next.js page with Tailwind
   ↓
3. "Invoke seo-writer to write meta tags and optimize headings"
   → SEO-optimized content
   ↓
4. "Invoke security-auditor to check security headers"
   → CSP, HSTS configured
   ↓
5. "Invoke test-generator to create lighthouse performance tests"
   → Performance benchmarks
```

**Result**: SEO-optimized, performant landing page.

---

## 🔧 RAG System Development

**Goal**: Build production RAG system from scratch.

**Workflow**:
```
1. "Invoke ai-engineer to design RAG system for 50K documents, < 2s latency"
   → Architecture: Pinecone + Claude 3.5 Sonnet
   → Cost: $800/month
   ↓
2. "Invoke backend-infra to set up Pinecone and embedding pipeline"
   → Vector DB setup, ingestion scripts
   ↓
3. "Invoke ai-engineer to optimize chunk size and retrieval strategy"
   → Testing: 500 tokens, hybrid search
   ↓
4. "Invoke test-generator to create RAG evaluation tests"
   → Accuracy, latency, relevance tests
   ↓
5. "Invoke test-runner to execute RAG benchmarks"
   → 92% accuracy, 1.8s p95 latency
   ↓
6. "Invoke fuzzing-agent to test with adversarial queries"
   → Find hallucination edge cases
   ↓
7. "Invoke ai-engineer to add guardrails for hallucinations"
   → Confidence scoring, fallback responses
```

**Result**: Production-ready RAG system with 92% accuracy.

---

## 📊 Sprint Retrospective

**Goal**: Analyze sprint and prepare summary.

**Workflow**:
```
1. "Invoke project-summarizer to summarize last 50 commits"
   → Key changes by category
   ↓
2. "Invoke meeting-notes to extract action items from retro meeting"
   → Improvements to implement
   ↓
3. "Invoke test-runner to get test coverage report"
   → Current: 78% coverage
   ↓
4. "Invoke security-auditor to run dependency scan"
   → 3 vulnerabilities found
   ↓
5. "Invoke planner to create next sprint plan"
   → Tasks: Increase coverage to 85%, fix vulnerabilities
```

**Result**: Sprint summary + action plan for next sprint.

---

## 🚢 Pre-Release Checklist

**Goal**: Validate code before production deployment.

**Workflow**:
```
1. "Invoke test-runner to execute full test suite"
   → All tests pass ✅
   ↓
2. "Invoke security-auditor to run security scan"
   → No critical vulnerabilities ✅
   ↓
3. "Invoke code-reviewer to review changed files"
   → Code quality check ✅
   ↓
4. "Invoke fuzzing-agent to stress test API endpoints"
   → No crashes found ✅
   ↓
5. "Invoke ci-commenter to generate release notes"
   → Changelog with key features
   ↓
6. [Deploy to production]
```

**Result**: Confidence in production release.

---

## 💼 Content Marketing Campaign

**Goal**: Create content to attract clients.

**Workflow**:
```
1. "Invoke seo-writer to create blog post: 'How to Build RAG Systems in 2025'"
   → 2,500-word SEO-optimized article
   ↓
2. "Invoke profile-optimizer to update LinkedIn with new post"
   → Share article on LinkedIn
   ↓
3. [Article gets traffic]
   ↓
4. "Invoke meeting-notes to process inbound client calls"
   → Extract requirements
   ↓
5. "Invoke proposal-writer to create proposals for leads"
   → Convert leads to clients
```

**Result**: Content → Traffic → Leads → Clients.

---

## 🧪 Agent Testing & Validation

**Goal**: Ensure all agents are production-ready and compliant.

**Workflow**:
```
1. "Invoke agent-tester to validate the new custom-agent I created"
   → Format validation (YAML frontmatter)
   → Example quality check
   → Tool permission audit
   ↓
2. "Fix any issues found by agent-tester"
   → Update YAML, add examples, fix security policy
   ↓
3. "Invoke agent-tester to re-validate custom-agent"
   → All tests pass ✅
   ↓
4. "Invoke code-reviewer to review the agent file as code"
   → Quality check on agent definition
   ↓
5. "Invoke agent-tester to run full system test on all 17 agents"
   → Ensure new agent didn't break anything
   → System-wide health check ✅
```

**Result**: Validated, production-ready agent integrated into system.

---

## 🔍 System-Wide Agent Audit

**Goal**: Regular quality assurance of all agents.

**Workflow**:
```
1. "Invoke agent-tester to run comprehensive validation on all Kronus agents"
   → Tests all 17 agents
   → Checks security policies (Bash-enabled agents)
   → Validates output formats
   ↓
2. "Review test report for any warnings or failures"
   → Identify agents needing updates
   ↓
3. "Fix issues in flagged agents"
   → Update YAML, add examples, improve documentation
   ↓
4. "Invoke agent-tester to re-test fixed agents"
   → Verify all issues resolved ✅
```

**Result**: System-wide quality assurance with 100% compliance.

---

## Team-Based Workflows

### Using Agent Teams via CLI

Teams coordinate multiple agents with a single command:

```bash
# Engineering team for feature development
./scripts/kronus-team.sh --team engineering --task "Build user auth" --dir ~/myapp --strategy pipeline

# Security review team
./scripts/kronus-team.sh --team security-review --task "Audit codebase" --dir ~/myapp

# Custom ad-hoc team
./scripts/kronus-team.sh --agents security-auditor,test-runner --task "Quick check" --dir .
```

### Using team-lead Agent

For interactive team coordination in Claude Code:

```
"Invoke team-lead to coordinate the full-stack team for building a payment system"
```

The team-lead agent will:
1. Select the appropriate team
2. Assign tasks with dependencies
3. Choose execution strategy (sequential, parallel, pipeline)
4. Merge outputs into a unified report

---

## CLI Automation Workflows

### Multi-Project Execution

Run an agent across all your projects:

```bash
./scripts/kronus-run.sh \
  --task "Run security audit" \
  --agent security-auditor \
  --dirs ~/projects/* \
  --parallel --jobs 4
```

### Batch Task Execution

Execute a manifest of tasks with dependencies:

```bash
./scripts/kronus-batch.sh --manifest examples/manifests/tasks.yaml --parallel
```

### Cron-Based Automation

Install scheduled agent tasks:

```bash
./scripts/kronus-cron.sh --install --manifest examples/manifests/cron.yaml
```

### Slash Commands

Quick workflows via Claude Code:

```
/plan Build notification system with email and push
/review
/test src/api/users.ts
/audit focus on authentication
/briefing
```

See [SLASH_COMMANDS.md](./SLASH_COMMANDS.md) for full reference.

---

## Tips for Multi-Agent Workflows

1. **Start with Planner**: For complex tasks, let planner orchestrate
2. **Use Teams**: For recurring patterns, use pre-configured teams
3. **Iterate**: Run agents multiple times with refinements
4. **Save Context**: Use memory-retriever to reference past work
5. **Validate**: Always run test-runner + security-auditor before deployment
6. **Test Agents**: Use agent-tester to validate new agents and audit existing ones
7. **Document**: Use project-summarizer to create summaries for team
8. **Automate**: Set up cron jobs for recurring tasks

---

For more examples, see:
- Agent files in `.claude/agents/`
- Team configs in `.claude/teams/`
- Example sessions in `examples/team-sessions/`
- CLI recipes in `examples/cli-recipes/`
