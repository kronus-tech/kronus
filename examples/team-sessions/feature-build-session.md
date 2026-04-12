# Example: Full-Stack Feature Build Session

## Scenario
Build a complete user profile management feature with API, UI, and tests.

## Team Configuration
- **Team:** full-stack
- **Strategy:** pipeline
- **Agents:** planner, backend-infra, frontend-dev, test-generator, security-auditor

## Invocation

```bash
# Using kronus-team.sh
./scripts/kronus-team.sh \
  --team full-stack \
  --task "Build user profile management: view, edit, avatar upload, privacy settings" \
  --dir ~/projects/myapp \
  --strategy pipeline
```

## Expected Flow

### Step 1: planner
- Breaks feature into subtasks
- Identifies data model requirements
- Creates task dependencies
- Output: Task manifest

### Step 2: backend-infra
- Creates Prisma schema for user profiles
- Builds REST API endpoints (GET/PUT /api/profile)
- Adds avatar upload with S3/local storage
- Implements privacy settings logic
- Output: API routes, schema, migration files

### Step 3: frontend-dev
- Builds profile view page with user data
- Creates profile edit form with React Hook Form
- Adds avatar upload component with preview
- Implements privacy settings toggle UI
- Output: React components, pages

### Step 4: test-generator
- Creates API integration tests for all endpoints
- Generates component tests for profile UI
- Adds upload and validation edge case tests
- Output: Test files (Jest + React Testing Library)

### Step 5: security-auditor
- Audits file upload for path traversal, size limits
- Checks authorization (users can only edit own profile)
- Verifies privacy settings enforcement
- Output: Security report

## Expected Output

Complete feature with:
- Database schema and migrations
- API endpoints with validation
- React UI components
- Comprehensive test suite
- Security audit report
