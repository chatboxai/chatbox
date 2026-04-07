# Trust & Safety Strategy for K-12 Deployment

ChatBridge enables third-party apps to run inside an educational chat platform used by K-12 students. This document describes the defense-in-depth approach to ensuring that no third-party app can harm students, exfiltrate data, or degrade the platform experience.

## 1. Sandbox Isolation

Third-party apps run inside iframes with `sandbox="allow-scripts"` and explicitly without `allow-same-origin`. This browser-enforced boundary prevents apps from accessing the parent page's DOM, cookies, localStorage, or session tokens. The iframe cannot navigate the parent window, open popups, or submit forms unless explicitly permitted.

All communication between the platform and apps flows through a typed `postMessage` protocol with a fixed set of message types (`ready`, `register_tools`, `tool_invoke`, `tool_result`, `state_update`, `completion`). The platform validates `event.origin` and `event.source` on every received message, rejecting anything from unexpected sources (see `ChatBridgeFrame.tsx`). An app cannot inject arbitrary content into the platform — it can only respond to tool invocations and send structured state updates.

## 2. Data Minimization

Apps receive only the structured parameters defined in their tool schemas — for example, `{ from: "e2", to: "e4" }` for a chess move. They never see conversation history, user email addresses, other apps' data, or the platform JWT. OAuth tokens are passed via postMessage only when the app has declared an auth requirement and the user has explicitly authorized the provider.

State updates from apps are injected into the LLM's system prompt context, not displayed directly to the student. The platform controls what context the LLM receives and how it presents app information. No app can exfiltrate student data because no student data is ever sent to the app.

## 3. App Vetting Gate

Every new app registration enters a `pending` state and is invisible to students until an admin explicitly approves it via `PATCH /api/apps/:id/status`. The admin panel provides visibility into pending registrations, tool schemas, and app URLs. Only apps with `status: "approved"` are returned by the public `GET /api/apps` endpoint.

In production, the review process should include: verifying HTTPS-only URLs, inspecting tool schemas for overly broad parameter types, and testing the app in a sandboxed preview environment before approval. The `pending -> approved -> rejected` flow ensures no app reaches students without human review.

## 4. Content Filtering via LLM

All app output passes through Claude before reaching the student. App `state_update` messages are injected into the system prompt context, not rendered directly. When the LLM generates a response that references app state, Claude's built-in safety training acts as a content filter. If an app returns harmful, inappropriate, or misleading content in a tool result, Claude will refuse to relay it verbatim or will flag the issue in its response. This makes the LLM the last line of defense between third-party content and the student.

## 5. Runtime Protections

Multiple runtime layers limit blast radius:

- **Circuit breaker**: After 3 consecutive tool invocation failures, an app's tools are removed from the active tool set for the session, preventing a broken or malicious app from degrading the chat experience (see `chatBridgeStore.ts`).
- **Rate limiting**: Per-user and per-app rate limits cap tool invocations at 30/minute. Auth endpoints are limited to 10/minute per IP (see `rateLimit.ts`).
- **Timeouts**: Iframe load timeout of 5 seconds and tool call timeout of 10 seconds prevent hung apps from blocking the conversation.
- **Graceful error handling**: Timeout and error results are injected as normal tool results so the LLM can explain failures conversationally rather than crashing the session.

## 6. What's Not Built Yet (Production Roadmap)

The current implementation provides defense-in-depth through sandbox isolation, data minimization, and LLM content filtering, with the admin review gate as the human checkpoint. The following gaps should be addressed before a production K-12 deployment:

- **Role-based admin access**: Currently any authenticated user can access the admin panel. Production needs an admin role with separate permissions.
- **Per-app CSP headers**: Dynamic `Content-Security-Policy` `frame-src` directives generated from the approved app list, rather than a static allowlist.
- **Automated content scanning**: Periodic or on-load scanning of iframe-rendered content for inappropriate material, beyond what the LLM catches.
- **Audit logging**: Logging of all admin approval/rejection actions with timestamps and actor identity for compliance and accountability.
- **Automated tool schema validation**: Deeper validation of tool parameter schemas beyond JSON structure — detecting overly permissive `additionalProperties: true` or unbounded string inputs.

These are the next priorities, not missing features. The current architecture is designed so each layer can be strengthened independently without restructuring the system.
