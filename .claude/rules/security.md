# Security Rules

## Secrets Management
- Never hardcode API keys, passwords, tokens, or credentials
- Use environment variables or secret managers (AWS SSM, Vault)
- Never commit `.env` files — they must be in `.gitignore`
- Rotate credentials if accidentally exposed

## Input Validation
- Validate all user input at system boundaries
- Use parameterized queries — never string-concatenate SQL
- Sanitize HTML output to prevent XSS
- Validate file uploads (type, size, content)

## Authentication & Authorization
- Hash passwords with bcrypt/argon2 (never MD5/SHA1)
- Use CSRF tokens on state-changing requests
- Implement rate limiting on auth endpoints
- Use short-lived JWTs with refresh tokens

## Dependencies
- Run `npm audit` / `pip audit` before releases
- Pin dependency versions in production
- Review new dependencies before adding
- Keep dependencies updated regularly

## Headers & Transport
- Use HTTPS everywhere
- Set security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- Use SameSite cookies
- Disable directory listing
