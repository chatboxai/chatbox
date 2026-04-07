# Security Rules

## Secrets Management

- **Never hardcode API keys or secrets.** `ANTHROPIC_API_KEY`, `JWT_SECRET`, OAuth client secrets come from environment variables only.
- Load secrets via `.env` file locally (gitignored). On Railway, set via dashboard or CLI.
- Required env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`.
- Never log secret values. Log only that the variable "is set" or "is missing".
- Fail fast on startup if required env vars are missing — don't let the user discover this mid-session.
- Never expose `ANTHROPIC_API_KEY` to the browser. All LLM calls happen server-side.

## .gitignore

The following must always be gitignored:
```
.env
.env.*
*.pem
*.key
node_modules/
dist/
.tools/
.vscode/
.idea/
server/prisma/*.db
```

## iframe Sandboxing

Third-party apps run in sandboxed iframes. This is the primary security boundary.

### Sandbox Attributes
- Default: `sandbox="allow-scripts"` — permits JavaScript, blocks everything else.
- `allow-same-origin` — add ONLY for trusted, self-hosted demo apps that need their own localStorage/cookies.
- **Never combine `allow-scripts` and `allow-same-origin` for untrusted third-party content** — that combination allows the iframe to remove its own sandbox.
- `allow-forms` — add only if the app has form inputs.
- `allow-popups` — NOT added by default. Apps should not open popups.

### What Sandboxed Iframes Cannot Do
- Access parent DOM (`window.parent.document` → blocked)
- Read parent cookies or localStorage
- Navigate the parent window (`window.top.location` → blocked)
- Open popups (unless `allow-popups` is explicitly added)
- Submit forms (unless `allow-forms` is explicitly added)

## postMessage Security

Every postMessage received by the platform must be validated before processing.

### Validation Rules
```typescript
window.addEventListener('message', (event) => {
  // 1. Validate source is the expected iframe
  if (event.source !== iframeRef.current?.contentWindow) return

  // 2. Validate origin matches registered app URL
  const expectedOrigin = new URL(registeredAppUrl).origin
  if (event.origin !== expectedOrigin) return

  // 3. Validate message structure (type field exists, is known)
  if (!event.data?.type || !KNOWN_MESSAGE_TYPES.includes(event.data.type)) return

  // 4. Parse as structured JSON with type checking
  handleBridgeMessage(event.data)
})
```

### What NOT to Do
- Never call `eval()` on any data received via postMessage.
- Never use `innerHTML` with postMessage data.
- Never use `'*'` as targetOrigin when sending to iframes in production — use the registered app URL.
- Never trust `event.data` without validating `event.source` and `event.origin`.

## Data Isolation

### What Apps Receive
- Tool invocation parameters only: `{ type: 'tool_invoke', toolCallId, toolName, params }`.
- OAuth tokens when requested: `{ type: 'auth_token', token, provider }`.

### What Apps Never Receive
- Conversation history or user messages.
- Other apps' data or tool schemas.
- User profile information (email, name).
- Platform JWT tokens.
- Other users' data.

### What Apps Send Back
- Tool results: `{ type: 'tool_result', toolCallId, result }`.
- State updates: `{ type: 'state_update', state }` — platform decides what the LLM sees.
- Completion signals: `{ type: 'completion', result }`.
- The platform controls what enters the LLM context. Apps cannot inject arbitrary content.

## CSP Headers

Set on the Express backend for all responses:

```
Content-Security-Policy: default-src 'self'; frame-src https://*.railway.app https://localhost:*; script-src 'self'; connect-src 'self' https://api.anthropic.com wss://*
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- `frame-src` whitelist: only approved app origins. In production, dynamically generated from `app_registrations` table.
- `X-Frame-Options: DENY` prevents the platform itself from being embedded by malicious sites.
- Each third-party app is responsible for its own CSP within its iframe.

## Authentication Security

### Platform JWT
- Passwords hashed with `bcrypt`, salt rounds ≥ 10.
- JWTs signed with `HS256` using `JWT_SECRET`.
- Token expiry: 24 hours.
- Store in httpOnly cookie (preferred) or Authorization header.
- Refresh via `/api/auth/refresh` — issue new token from valid existing token.
- Rate limit login endpoint: 10 attempts per minute per IP.
- Rate limit registration: 5 per minute per IP.

### OAuth Token Storage
- Third-party OAuth tokens (access + refresh) stored in `oauth_tokens` table in Postgres.
- Associated with `user_id` — one token set per user per provider.
- Access tokens are short-lived (1 hour typical). Auto-refresh before each tool invocation.
- Refresh tokens are long-lived. If expired, user must re-authorize via popup flow.
- Never send OAuth tokens to the client browser. The backend makes authenticated API calls on behalf of the user, or passes the token to the iframe via postMessage only when the app needs to make direct API calls.

### OAuth Popup Flow
- OAuth redirects cannot happen inside iframes (`X-Frame-Options: DENY` on provider auth pages).
- Platform opens `window.open('/api/oauth/spotify/authorize')`.
- Backend handles the full OAuth dance (redirect → callback → token exchange).
- Callback page sends `window.opener.postMessage({ type: 'oauth_complete' })` and closes.
- Parent window receives the message and notifies the iframe.

## Rate Limiting

Apply at multiple levels via `express-rate-limit`:

| Endpoint Category | Limit | Key |
|---|---|---|
| Auth (login, register) | 10/minute | IP address |
| General API | 60/minute | JWT user ID |
| Tool invocations | 30/minute per app | JWT user ID + app ID |
| WebSocket messages | 30/minute | Connection (JWT user ID) |

Return `429 Too Many Requests` with a clear error message and `Retry-After` header.

## App Vetting

### Registration Status Flow
```
pending → approved → (available to users)
pending → rejected → (hidden from users)
approved → rejected → (removed from users)
```

- New registrations start as `pending`.
- Only `approved` apps are returned by `GET /api/apps`.
- For the sprint, demo apps are seeded as `approved`.
- In production, this is a manual admin review gate before any app reaches students.

### What to Check During Review
- App URL is HTTPS (no HTTP in production).
- Tool schemas are well-formed (valid JSON Schema for parameters).
- App description accurately represents functionality.
- App doesn't request unnecessary permissions.
- App doesn't attempt to mimic platform UI (phishing prevention).

## Error Response Security

- Never expose stack traces to the client.
- Never reveal file system paths, database connection strings, or internal state.
- API errors return: `{ "error": "User-friendly message" }`.
- Log full error details server-side with structured logging.
- If the LLM returns an error, return a generic "Generation failed" message to the client.
- Database errors return "Internal server error" — never expose SQL or Prisma errors.

## What Not to Log

- **Never log:** `ANTHROPIC_API_KEY`, `JWT_SECRET`, OAuth tokens, user passwords, full LLM request/response bodies.
- **Safe to log:** User IDs (not emails in production), conversation IDs, tool names, invocation durations, token counts, error types.
- When logging LLM interactions: log model name, message count, token usage, latency. Not the content.

## Dependency Security

- Pin dependencies via `package-lock.json` and `pnpm-lock.yaml` (committed to git).
- Before adding a new dependency, check if existing tools cover the need.
- Key backend dependencies: `express`, `ws`, `bcrypt`, `jsonwebtoken`, `@prisma/client`, `@anthropic-ai/sdk`, `simple-oauth2`, `express-rate-limit`.
- Key frontend: the existing Chatbox dependencies (React, Zustand, Jotai, TanStack, ai SDK).
- Run `npm audit` periodically. Fix critical vulnerabilities.

## Git Hygiene

Before committing, verify no secrets were accidentally added:
```bash
git diff --cached | grep -iE "(api_key|secret|password|token|sk-)" | grep -v "test\|mock\|example\|env\.\|\.env\."
```
Review any matches. Never commit `.env` files.
