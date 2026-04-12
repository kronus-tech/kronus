# Agent Reference Guide

Complete reference for all 18 Kronus agents.

---

## Quick Reference Table

| Agent | Tier | Purpose | Bash? | Memory | MaxTurns | Examples |
|-------|------|---------|-------|--------|----------|----------|
| [planner](#planner) | 1 | Task orchestration | No | project | 50 | 5 |
| [team-lead](#team-lead) | 1 | Team (swarm) orchestrator | No | project | 50 | 3 |
| [project-summarizer](#project-summarizer) | 2 | Compress updates | Yes | project | 15 | 4 |
| [memory-retriever](#memory-retriever) | 2 | Query history | No | project | 10 | 5 |
| [ai-engineer](#ai-engineer) | 3 | RAG & AI systems | No | project | 30 | 5 |
| [test-generator](#test-generator) | 3 | Generate tests | No | local | 20 | 4 |
| [test-runner](#test-runner) | 3 | Execute tests | **Yes** | local | 15 | 5 |
| [code-reviewer](#code-reviewer) | 3 | PR analysis | **Yes** | local | 20 | 3 |
| [frontend-dev](#frontend-dev) | 3 | React/Next.js | No | local | 25 | 5 |
| [backend-infra](#backend-infra) | 3 | APIs/DBs/IaC | No | local | 25 | 5 |
| [security-auditor](#security-auditor) | 3 | Security scans | **Yes** | local | 20 | 5 |
| [fuzzing-agent](#fuzzing-agent) | 3 | Fuzz testing | No | local | 15 | 5 |
| [proposal-writer](#proposal-writer) | 4 | Proposals/SOWs | No | user | 15 | 3 |
| [profile-optimizer](#profile-optimizer) | 4 | Profile optimization | No | user | 10 | 3 |
| [seo-writer](#seo-writer) | 4 | SEO content | No | local | 15 | 3 |
| [meeting-notes](#meeting-notes) | 4 | Meeting summaries | No | project | 10 | 2 |
| [ci-commenter](#ci-commenter) | 4 | CI/CD comments | No | local | 10 | 2 |
| [agent-tester](#agent-tester) | 4 | Agent testing & validation | No | local | 30 | 5 |

---

## Tier 1: Orchestration

### planner

**Purpose**: Top-level orchestrator that breaks down complex tasks and dispatches to specialized agents.

**When to Use**:
- Complex multi-step projects
- Need coordination between multiple agents
- High-level feature requests

**Example Invocations**:
```
"Invoke planner to build a payment processing feature with Stripe"
"Invoke planner to create a complete RAG system from scratch"
```

**Output**: Task breakdown with agent assignments, dependencies, and timeline.

**File**: `.claude/agents/planner.md` (15.3 KB, 417 lines)

---

### team-lead

**Purpose**: Meta-orchestrator for agent team (swarm) mode. Coordinates multiple agents working simultaneously on complex tasks.

**When to Use**:
- Tasks requiring multiple agents working together
- Complex projects needing coordinated execution
- When you want agents to share context in a pipeline

**Example Invocations**:
```
"Invoke team-lead to coordinate the engineering team for building a payment system"
"Invoke team-lead to run the security-review team on this codebase"
```

**Output**: Team coordination report with task assignments, execution strategy, and merged outputs.

**File**: `.claude/agents/team-lead.md`

---

## Tier 2: Memory & Context

### project-summarizer

**Purpose**: Compresses commits, PRs, meetings, and documentation into 2-4 sentence summaries.

**When to Use**:
- End of sprint/week summaries
- Compressing PR descriptions
- Meeting recap generation

**Example Invocations**:
```
"Invoke project-summarizer to summarize the last 10 commits"
"Invoke project-summarizer to compress this PR into a 3-sentence summary"
```

**Output**: Concise 2-4 sentence summary with key changes and impact.

**File**: `.claude/agents/project-summarizer.md` (13.2 KB, 350 lines)

---

### memory-retriever

**Purpose**: Queries past project context with 5 search modes (namespace, keyword, date, filepath, combined).

**When to Use**:
- Find past decisions or discussions
- Locate code by keyword
- Search by date range
- Retrieve specific file changes

**Example Invocations**:
```
"Invoke memory-retriever to find all auth-related decisions from last month"
"Invoke memory-retriever to search for database migration discussions"
```

**Output**: Ranked search results with relevance scores and context.

**File**: `.claude/agents/memory-retriever.md` (17.1 KB, 554 lines)

---

## Tier 3: Engineering & Development

### ai-engineer

**Purpose**: RAG architecture, prompt engineering, model selection, LLM cost optimization.

**When to Use**:
- Design RAG systems
- Optimize prompts
- Choose between LLM models
- Reduce AI costs
- Evaluate AI system performance

**Example Invocations**:
```
"Invoke ai-engineer to design a RAG system for 10K documents"
"Invoke ai-engineer to optimize this prompt and reduce costs by 50%"
"Invoke ai-engineer to recommend a model for code generation"
```

**Output**: Technical architecture, cost estimates, implementation recommendations.

**File**: `.claude/agents/ai-engineer.md` (44 KB, 688 lines)

---

### test-generator

**Purpose**: Auto-generates unit and integration tests for Jest, PyTest, Foundry, Go, React Testing Library.

**When to Use**:
- Need tests for new code
- Increase code coverage
- Create integration test scaffolds

**Example Invocations**:
```
"Invoke test-generator to create tests for app/api/users/route.ts"
"Invoke test-generator to add integration tests for the auth flow"
```

**Output**: Complete test files with fixtures, mocks, and assertions.

**File**: `.claude/agents/test-generator.md` (38 KB, 810 lines)

---

### test-runner 🔒

**Purpose**: Executes tests and triages failures with root-cause analysis.

**Bash Access**: Yes (test commands only: npm test, pytest, etc.)

**When to Use**:
- Run test suites
- Diagnose test failures
- Validate code changes

**Example Invocations**:
```
"Invoke test-runner to execute all tests"
"Invoke test-runner to diagnose failing auth tests"
```

**Output**: Test results, failure triage, suggested fixes, severity assessment.

**File**: `.claude/agents/test-runner.md` (21 KB, 467 lines)

---

### code-reviewer 🔒

**Purpose**: Analyzes PRs for code quality, security, performance issues.

**Bash Access**: Yes (git read operations only: git diff, git log)

**When to Use**:
- Review pull requests
- Check code quality
- Find security vulnerabilities
- Identify performance issues

**Example Invocations**:
```
"Invoke code-reviewer to analyze this PR"
"Invoke code-reviewer to check for security issues in auth code"
```

**Output**: Detailed review with severity ratings, code snippets, suggested fixes.

**File**: `.claude/agents/code-reviewer.md` (30 KB, 598 lines)

---

### frontend-dev

**Purpose**: React/Next.js/Tailwind development with forms, state management, routing.

**When to Use**:
- Build React components
- Create Next.js pages
- Implement forms with validation
- Set up state management (Zustand, Redux)
- Design responsive UIs

**Example Invocations**:
```
"Invoke frontend-dev to create a contact form with validation"
"Invoke frontend-dev to build a responsive navigation bar"
"Invoke frontend-dev to set up Zustand for shopping cart state"
```

**Output**: React/Next.js code with TypeScript, Tailwind styling, accessibility features.

**File**: `.claude/agents/frontend-dev.md` (28 KB, 1,001 lines)

---

### backend-infra

**Purpose**: APIs (REST/GraphQL/tRPC), databases (Postgres/Mongo), Docker, Terraform, authentication, caching.

**When to Use**:
- Design REST/GraphQL APIs
- Set up databases and ORMs
- Create Docker containers
- Write Terraform/IaC
- Implement authentication
- Add Redis caching

**Example Invocations**:
```
"Invoke backend-infra to create a REST API with Prisma and Postgres"
"Invoke backend-infra to set up Docker Compose for local development"
"Invoke backend-infra to add NextAuth authentication"
```

**Output**: API routes, database schemas, Docker/Terraform configs, auth setup.

**File**: `.claude/agents/backend-infra.md` (36 KB, 1,461 lines)

---

### security-auditor 🔒

**Purpose**: SAST, dependency scanning, secret detection, OWASP Top 10 coverage.

**Bash Access**: Yes (security tools only: npm audit, semgrep, grep)

**When to Use**:
- Security audits
- Dependency vulnerability scans
- Find hardcoded secrets
- Check authentication security
- Verify security headers

**Example Invocations**:
```
"Invoke security-auditor to scan for vulnerabilities"
"Invoke security-auditor to find secrets in my codebase"
"Invoke security-auditor to check security headers configuration"
```

**Output**: Security findings with severity, CWE/OWASP references, remediation steps.

**File**: `.claude/agents/security-auditor.md` (32 KB, 808 lines)

---

### fuzzing-agent

**Purpose**: Generates fuzz test inputs to find edge cases, boundary conditions, and vulnerabilities.

**When to Use**:
- Test API endpoints with adversarial inputs
- Find edge cases
- Generate property-based tests
- Test input validation
- Stress test with large/malformed data

**Example Invocations**:
```
"Invoke fuzzing-agent to generate fuzz inputs for my registration API"
"Invoke fuzzing-agent to create property-based tests for my sort function"
```

**Output**: Comprehensive test cases with boundary, invalid, malicious, and edge case inputs.

**File**: `.claude/agents/fuzzing-agent.md` (38 KB, 1,140 lines)

---

## Tier 4: Business & Automation

### proposal-writer

**Purpose**: Technical proposals, SOWs, RFP responses with cost estimates and timelines.

**When to Use**:
- Write client proposals
- Create statements of work
- Respond to RFPs
- Generate project estimates

**Example Invocations**:
```
"Invoke proposal-writer to create a proposal for AI chatbot project, $45K budget"
"Invoke proposal-writer to write an SOW for 3-month RAG implementation"
```

**Output**: Complete proposal with exec summary, technical approach, pricing, timeline.

**File**: `.claude/agents/proposal-writer.md` (17 KB, 540 lines)

---

### profile-optimizer

**Purpose**: LinkedIn/Upwork profile optimization for maximum visibility and conversions.

**When to Use**:
- Optimize LinkedIn headline
- Write compelling LinkedIn summary
- Create Upwork profile overview
- Improve portfolio descriptions

**Example Invocations**:
```
"Invoke profile-optimizer to optimize my LinkedIn headline"
"Invoke profile-optimizer to write my Upwork profile overview"
```

**Output**: Optimized profile sections with keywords, before/after comparisons, recommendations.

**File**: `.claude/agents/profile-optimizer.md` (11 KB, 313 lines)

---

### seo-writer

**Purpose**: SEO-optimized blog posts and content with keyword research.

**When to Use**:
- Write blog posts
- Create landing page copy
- Optimize content for search engines

**Example Invocations**:
```
"Invoke seo-writer to create a blog post on RAG systems for AI engineers"
```

**Output**: SEO-optimized content with meta tags, keyword placement, readability scoring.

**File**: `.claude/agents/seo-writer.md` (7.5 KB, 234 lines)

---

### meeting-notes

**Purpose**: Extracts action items, decisions, and blockers from meeting transcripts.

**When to Use**:
- Process meeting transcripts
- Extract action items
- Identify decisions made
- Track blockers

**Example Invocations**:
```
"Invoke meeting-notes to extract action items from this client call transcript"
"Invoke meeting-notes to summarize our sprint planning meeting"
```

**Output**: Structured meeting summary with action items (owner + deadline), decisions, blockers.

**File**: `.claude/agents/meeting-notes.md` (6.9 KB, 225 lines)

---

### ci-commenter

**Purpose**: Analyzes CI/CD results and posts informative PR comments.

**When to Use**:
- Generate CI/CD PR comments
- Analyze test results
- Track code coverage changes
- Report build status

**Example Invocations**:
```
"Invoke ci-commenter to generate a PR comment from these test results"
```

**Output**: Formatted PR comment with test results, coverage deltas, actionable feedback.

**File**: `.claude/agents/ci-commenter.md` (6.8 KB, 283 lines)

---

### agent-tester

**Purpose**: Systematically tests and validates Claude Code subagents for format compliance, security, and quality.

**When to Use**:
- Validate new agents before deployment
- Audit existing agents for compliance
- Check Bash security policies
- Run system-wide agent health checks

**Example Invocations**:
```
"Invoke agent-tester to validate the planner agent"
"Invoke agent-tester to check security policies for all Bash-enabled agents"
"Invoke agent-tester to run full system validation on all 17 agents"
```

**Output**: Comprehensive test report with pass/fail status, issues found, severity ratings, and remediation recommendations.

**File**: `.claude/agents/agent-tester.md` (24 KB, 703 lines)

---

## Agent Combinations

### Full Feature Development
```
planner → ai-engineer → frontend-dev → backend-infra → test-generator → test-runner → code-reviewer
```

### Security Pipeline
```
security-auditor → fuzzing-agent → test-generator → code-reviewer
```

### Client Acquisition
```
profile-optimizer → proposal-writer → meeting-notes (after call)
```

### Content Creation
```
ai-engineer (architecture) → seo-writer (blog post) → ci-commenter (publish workflow)
```

### Agent Testing & Quality Assurance
```
agent-tester → (validate all agents) → code-reviewer (review fixes) → agent-tester (re-test)
```

---

For detailed examples, see individual agent files in `.claude/agents/`.
