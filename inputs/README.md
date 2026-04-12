# Input Files Directory

Place personal profile and context files here for agent personalization.

## Recommended Files

### 1. Resume/CV
**Filename:** `resume.pdf` or `resume.md`
**Purpose:** Provide work history, skills, and accomplishments for profile optimization and proposal writing

### 2. LinkedIn Profile
**Filename:** `linkedin_url.txt`
**Purpose:** Single line with your LinkedIn public profile URL
**Example:** `https://www.linkedin.com/in/yourusername`

### 3. Upwork Profile
**Filename:** `upwork_url.txt`
**Purpose:** Single line with your Upwork profile URL
**Example:** `https://www.upwork.com/freelancers/~01234567890abcdef`

### 4. Portfolio Links (Optional)
**Filename:** `portfolio.md`
**Purpose:** List of notable projects with descriptions and links

## How Agents Use These Files

- **profile-optimizer**: Reads resume and profile URLs to generate optimized headlines, summaries, and portfolio bullets
- **proposal-writer**: References your experience to tailor proposals
- **ai-engineer**: Uses past project context for recommendations
- **planner**: Incorporates your background into task planning

## Privacy & Security

- These files are read locally only
- Never auto-published or shared
- Add to `.gitignore` if containing sensitive info
- Agents only use for context, not storage

## Setup Checklist

- [ ] Add resume.pdf or resume.md
- [ ] Add linkedin_url.txt (optional)
- [ ] Add upwork_url.txt (optional)
- [ ] Review files for sensitive information
- [ ] Consider adding to .gitignore if needed
