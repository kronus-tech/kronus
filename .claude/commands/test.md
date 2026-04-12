Generate and run tests for the specified target.

Target: $ARGUMENTS

Instructions:
1. Invoke the **test-generator** agent to create tests for the target
2. Once tests are generated, invoke the **test-runner** agent to execute them
3. If any tests fail, have test-runner triage failures with root-cause analysis
4. Report coverage and any gaps

Current test files:
```
!find . -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" 2>/dev/null | head -20
```
