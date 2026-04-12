Run a security audit pipeline on the codebase.

Focus area: $ARGUMENTS

Instructions:
1. Invoke the **security-auditor** agent to scan for vulnerabilities:
   - Dependency scanning
   - SAST (SQL injection, XSS, secret detection)
   - OWASP Top 10 coverage
2. Invoke the **fuzzing-agent** to generate adversarial test inputs for any API endpoints found
3. Combine findings into a prioritized security report

Dependency check:
```
!npm audit --json 2>/dev/null || echo "No package.json found"
```

Project files:
```
!find . -maxdepth 3 -name "*.ts" -o -name "*.js" -o -name "*.py" 2>/dev/null | head -30
```
