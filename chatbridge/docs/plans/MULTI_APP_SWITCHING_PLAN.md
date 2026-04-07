# Multi-App Switching Plan

Enable switching between multiple third-party apps within a single conversation session, preserving each app's state when switching away and restoring it when switching back.

**Branch:** `feat/multi-app-switching`

---

## Step 1 — Refactor `chatBridgeStore` session structure

**File:** `src/renderer/stores/chatBridgeStore.ts`

The current `SessionState` tracks a flat list of active app names and a shared `appStates` map:

```typescript
// CURRENT
type SessionState = {
  active: boolean
  apps: string[]                        // active app names
  appStates: Record<string, unknown>    // latest state_update per app name
  failureCounts: Record<string, number> // circuit breaker counts per app name
}
```

Change to a per-app map with explicit status and one `activeApp` pointer:

```typescript
// NEW
type AppEntry = {
  context: Record<string, unknown>  // last state_update from this app
  status: 'active' | 'suspended'
}

type SessionState = {
  active: boolean
  activeApp: string | null
  apps: Record<string, AppEntry>
  failureCounts: Record<string, number>
}
```

**Functions to update:**

| Function | Current signature | Change |
|---|---|---|
| `isActive(sessionId)` | Returns `sessions[sessionId]?.active === true` | No change needed — still checks `active` boolean. |
| `getAppContext(sessionId)` | Returns `{ activeApps: session.apps, appStates: session.appStates }` | Return context for `session.activeApp` only: `{ activeApp: session.activeApp, state: session.apps[session.activeApp]?.context }`. |
| `activateApp(sessionId, appName)` | Pushes `appName` into `session.apps` array | Sets `session.activeApp = appName`, adds/updates entry in `session.apps[appName]` with `status: 'active'`. If another app was active, sets its status to `'suspended'`. |
| `deactivateApp(sessionId, appName)` | Removes from `session.apps` array, sets `active = false` if empty | Removes entry from `session.apps` map. If it was `activeApp`, clears `activeApp` to `null`. Sets `active = false` only if the map is empty. |
| `updateAppState(sessionId, appName, state)` | Writes into `session.appStates[appName]` | Writes into `session.apps[appName].context` instead. |

Add a new getter `getActiveApp(sessionId): string | null` that returns `session.activeApp`.

**Edge case:** If `activateApp` is called for an app already marked `active`, it should be a no-op (don't re-suspend and re-activate the same app).

---

## Step 2 — Update `controller.ts` activate_app logic

**File:** `src/renderer/packages/chatbridge/controller.ts`

Currently `chatBridgeController.activate(sessionId, app)` calls `store.activateSession` then `store.activateApp`, connects the WebSocket, and logs. It does not check whether another app is already active.

Change the `activate` method to implement this flow:

1. **Check for a currently active app.** Read `store.getActiveApp(sessionId)`. If it equals `app.name`, return early (already active).
2. **If another app is active:** Call `store.activateApp(sessionId, app.name)` — the store setter (Step 1) handles suspending the previous app and setting the new one as active. No explicit "save context" call needed here because `updateAppState` already persists context on every `state_update` message.
3. **Check if the requested app was previously used in this session.** Read `store.sessions[sessionId].apps[app.name]`. If the entry exists with `status: 'suspended'`, this is a restore — the store setter marks it `active`, and `ChatBridgeFrame` (Step 3) shows the hidden iframe. Optionally send a `{ type: 'restore', state: savedContext }` postMessage to the iframe so the app can re-hydrate if needed.
4. **If the app is new to this session:** The store setter creates a fresh entry with `status: 'active'`. `ChatBridgeFrame` renders a new iframe.
5. **WebSocket connection** is unchanged — shared across all apps in the session.

Add a `suspend(sessionId, appName)` method that explicitly suspends an app without activating another (used when closing the side panel).

**Edge case:** If the app being suspended has pending tool calls, wait for them to resolve or time out before suspending. Do not cancel in-flight tool calls.

---

## Step 3 — Update `ChatBridgeFrame.tsx` to handle iframe swapping

**File:** `src/renderer/components/ChatBridgeFrame.tsx`

**Recommendation: Option (b) — keep all iframes in the DOM, show/hide with CSS.** This preserves iframe internal state (chess board position, Spotify playback, etc.) without needing a restore postMessage. Destroying and recreating iframes would lose all in-memory app state and require every app to implement state restoration from a serialized snapshot.

Currently the component reads `activeApps[0]` to find the single active app and renders one iframe. Change to:

1. Subscribe to `sessions[sessionId]?.apps` (the full map) and `sessions[sessionId]?.activeApp`.
2. Render one `<iframe>` per entry in the apps map (each app that has been activated during this session).
3. Set `style={{ display: entry.status === 'active' ? 'block' : 'none' }}` on each iframe's wrapper div. The `active` iframe gets `display: block`, `suspended` ones get `display: none`.
4. Each iframe keeps its own `ref`, `status` state, `retryKey`, and postMessage listener. Extract the per-iframe logic into a child component (e.g., `ChatBridgeAppFrame`) to avoid a single component managing N refs.
5. The `invokeToolAndWait` callback and `setToolInvoker` registration must reference the **active** app's iframe ref, not a stale one. When the active app changes, update the store's `toolInvoker` to point to the new active iframe's invoker.
6. The header bar shows the active app's name. Add a dropdown or tab bar showing all apps in the session, allowing manual switching.

**Edge case:** If an iframe fails to load (error status), keep it in the DOM but show the error overlay only when that app is the active one. Don't block other apps from working.

---

## Step 4 — Update tool injection in `stream-text.ts`

**File:** `src/renderer/packages/model-calls/stream-text.ts` (~line 296)

Currently, tools for **all** registered apps are injected into the tool set regardless of which app is active. Change to:

1. Always inject `activate_app` — this is the global meta-tool that allows switching. Its description lists all available apps.
2. Only inject app-specific tools (the `for (const app of chatBridgeRegistry)` loop) for the **currently active app**. Read `chatBridgeStore.getState().getActiveApp(sessionId)` (new getter from Step 1) and filter: `chatBridgeRegistry.filter(a => a.name === activeAppName)`.
3. If no app is active (`activeApp === null`), only inject `activate_app` with no app-specific tools. This lets Claude activate an app on demand.

This change reduces token cost (fewer tool schemas in the prompt) and prevents Claude from trying to call tools for a suspended app.

**Edge case:** If the LLM calls `activate_app` to switch apps in one turn, then wants to call the new app's tools in the same turn — the current polling invoker pattern (8s deadline) handles this because the new iframe's invoker will be registered once React renders. No change needed to the polling logic.

---

## Step 5 — Update `generation.ts` appContext

**File:** `src/renderer/stores/session/generation.ts` (~line 177)

The ChatBridge interception block reads `getAppContext(sessionId)` and sends it via WebSocket as `appContext`. After Step 1, `getAppContext` already returns only the active app's context. Two additional changes:

1. Include a `previousApps` field in the context — an array of app names that are suspended in this session (just names, no state). This lets the LLM say "You were also using Chess earlier — want to switch back?" without polluting the system prompt with full state for every app.
2. The `onToolCall` handler currently reads `sessions[sessionId]?.apps[0]` to get the active app name for failure tracking. Change to read `sessions[sessionId]?.activeApp` (the new field from Step 1).

**Edge case:** If the user sends a message while no app is active (all suspended), `getAppContext` returns null/empty. The LLM should still receive the `previousApps` list so it can suggest reactivating one.

---

## Step 6 — Update backend `chatHandler.ts`

**File:** `server/src/ws/chatHandler.ts`

The backend is mostly stateless for this change. It receives `appContext` and tool schemas from the client on each WebSocket message. Review these areas:

1. **`buildSystemPrompt(appContext)`** — currently iterates `appContext.activeApps` (plural). After Step 5, the client sends a single `activeApp` plus `previousApps`. Update the prompt builder to say "Active application: Chess" (singular) and optionally "Previously used: Weather, Spotify" instead of listing all as active.
2. **`getAnthropicTools(activeApps)`** — currently maps the `activeApps` array to hardcoded tool definitions. After Step 4, the client only sends tools for the active app, so this function receives a single-element array. If the backend currently uses its own hardcoded tool map (it does), it should filter to only the active app. Long-term, the backend should accept tool schemas from the client rather than hardcoding them.
3. **No session-level caching of tool schemas** exists in the current backend, so no cache invalidation is needed on app switch.

**Edge case:** If the client sends a `tool_result` for a tool that belongs to a now-suspended app (race condition during switch), the backend should still accept it — tool results are keyed by `toolCallId`, not app name.

---

## Step 7 — Handle edge cases

**File(s):** Various — documented per scenario.

- **App iframe fails to load on restore:** The `ChatBridgeAppFrame` child component already has error/retry logic. If a hidden iframe enters error state and the user switches back to it, show the error overlay with a Retry button. On retry, destroy and recreate just that iframe (reset `retryKey`). Don't affect other iframes.
- **Circuit breaker triggered on one app:** The `failureCounts` map in `SessionState` is already per-app. `recordFailure` calls `deactivateApp` for the failed app only. After Step 1, this removes the app from the `apps` map and clears `activeApp` if it was the active one. Other apps remain unaffected. If the failed app was active, the side panel should show a "no active app" state, and the LLM's next turn will only have `activate_app` available.
- **Ambiguous user query ("what should I do?"):** The system prompt (Step 5/6) only includes the active app's state, so the LLM naturally responds in the active app's context. No special handling needed.
- **Closing the side panel entirely:** Should call `chatBridgeController.suspend(sessionId, activeAppName)` (new method from Step 2), which sets the active app's status to `suspended` and clears `activeApp` to `null`. The hidden iframes remain in the DOM. The session stays `active: true` so `isActive()` still returns true and the ChatBridge interception in `generation.ts` still fires — but with no active app, the LLM gets `previousApps` and can suggest reactivating.

---

## Step 8 — Tests

**Test scenarios to add:**

1. **Activate chess, then activate weather.** Verify: chess entry in `sessions[sid].apps` has `status: 'suspended'` and its context is preserved. Weather entry has `status: 'active'`. `activeApp === 'Weather'`. Weather iframe is visible, chess iframe is hidden (`display: none`). Files: `chatBridgeStore` unit test, `ChatBridgeFrame` component test.

2. **Activate chess, switch to weather, switch back to chess.** Verify: chess entry returns to `status: 'active'` with its original context intact. Chess iframe becomes visible again with board state preserved (no fresh load). The `toolInvoker` in the store now points to chess's iframe. Files: `chatBridgeStore` unit test, `controller.ts` unit test, `ChatBridgeFrame` component test.

3. **Tool injection only includes active app's tools plus `activate_app`.** Verify: when chess is active, `tools` object has `start_game`, `make_move`, `get_board_state`, `activate_app` but not `get_current_weather` or `search_tracks`. When no app is active, only `activate_app` is present. Files: `stream-text.ts` unit test (mock `chatBridgeStore.getState()`).

4. **`appContext` sent to backend only includes active app's state.** Verify: when chess is active with FEN state and weather is suspended with temperature state, the WebSocket `user_message` payload contains `appContext.activeApp === 'Chess'` and `appContext.state` is the chess FEN, not the weather data. `appContext.previousApps` is `['Weather']`. Files: `generation.ts` unit test, `chatHandler.ts` integration test.

5. **Circuit breaker on one app doesn't disable other apps.** Verify: trigger 3 failures on chess (via `recordFailure`). Chess is removed from `apps` map. Weather (if active or suspended) remains in the map with its status unchanged. `failureCounts['Weather']` is still 0. Files: `chatBridgeStore` unit test.
