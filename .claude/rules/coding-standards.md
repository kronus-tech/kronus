# Coding Standards

## TypeScript
- Use strict mode (`"strict": true` in tsconfig)
- Prefer `const` over `let`; never use `var`
- Use explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Prefer named exports over default exports
- Use async/await over raw Promises
- No `any` — use `unknown` and narrow with type guards

## Python
- Follow PEP 8 style guidelines
- Use type hints on all function signatures
- Use `dataclasses` or `pydantic` for structured data
- Prefer f-strings over `.format()` or `%`
- Use `pathlib.Path` over `os.path`

## General
- Functions should do one thing and do it well
- Keep functions under 50 lines where practical
- Use descriptive variable names — no single-letter variables except loop counters
- Error messages should be actionable
- No commented-out code in production
- No unused imports or variables
