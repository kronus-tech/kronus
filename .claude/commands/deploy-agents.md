Deploy Kronus agents to a target directory.

Target: $ARGUMENTS

Instructions:
1. If a target directory is specified, run the deploy script:
```
!./scripts/deploy-to-project.sh "$ARGUMENTS"
```
2. If no target specified, show available options:
   - `--global` — Install to ~/.claude/ for system-wide availability
   - `<path>` — Install to a specific project directory
   - `--dry-run` — Preview what would be copied
3. Verify deployment by listing the agents in the target directory
