# Chatbox Virtual CLI

> Last updated: 2026-07

The built-in `chatbox-product-info` skill can use `chatbox_cli`, a controlled in-app command surface. It is not a system shell and does not execute arbitrary programs.

## Layers

1. The model tool adapter accepts a legacy command string or preferred structured `argv`.
2. The parser tokenizes virtual commands without invoking a shell.
3. The registry dispatches to domain commands: `account`, `settings`, `chats`, and `image`.
4. Domain handlers call existing Chatbox stores and services.
5. The app-action approval pause protects image generation independently from agent Full Access and carries structured details for the localized approval UI.

## Permission policy

| Operation | Approval |
| --- | --- |
| Account, version, settings reads | No |
| Conversation list, search, read | No |
| Settings changes | Unsupported; guide the user to the Settings UI |
| Image history and status | No |
| Starting image generation | Yes |

Settings access uses an explicit read-only allowlist. Provider credentials, license keys, MCP headers, publish keys, and other secret-bearing settings are never exposed by generic path traversal. Each settings result includes the relevant Chatbox Settings page so the model can guide the user to make a requested change manually.

Account quota commands expose the unified compute-point balance as `remainingPercentage` on a 0–100 scale. The source API's `remaining_quota_unified` field is a 0–1 ratio; it must not be rendered as an absolute point count.

## Background image tasks

`image generate` first shows a dedicated localized approval card. It shows the complete prompt plus the resolved provider, model, image count, aspect ratio, and optional style. The structured request remains attached to the paused tool call, and approval continuation or crash recovery executes that exact request instead of resolving the default model again. For Chatbox AI models it also identifies cached remaining image quota, cached remaining compute-point percentage derived from unified token usage and limit, and that exact compute-point usage is determined after generation. Third-party models instead disclose provider billing without claiming Chatbox quota usage.

After approval, the command starts the existing image-generation pipeline and returns a record id without waiting for completion. Before any potentially billable provider request starts, it durably binds the originating session/tool call and exact request signature to the local image record. The image record also retains its CLI source so recovery from either the original chat or Image Creator can reconnect the completion callback. A renderer reload therefore reuses the same record and backend task id when available; it never automatically submits the approved request a second time. The result declares callback waiting with `wait.mode = "callback"` and `wait.modelShouldPoll = false`. The generation harness removes `chatbox_cli` from the remainder of that model tool loop, so prompt adherence is not the only polling guard. Its completion promise queues a session follow-up anchored to the originating tool call. If the user switches threads, the follow-up is still appended to the thread that started the task.

As the bound image record receives generated images, the originating tool step renders them inline through the same `PictureGallery` used by regular conversation images. Local storage keys and remote image URLs therefore share the existing PhotoSwipe zoom viewer and cross-platform download path instead of introducing a separate preview implementation.

That originating tool step is the single inline display, so the results returned to the model must not lead to a second rendering of the same images in the follow-up reply. The completion notification tells the model that Chatbox already displays the images and that a brief text confirmation is enough. In addition, `image status` and `image history` replace the result references of records whose images are already displayed in the current chat with `already shown` placeholders plus an explanatory note, so the model never receives a renderable URL it could paste back as a Markdown image. A record only counts as displayed while its originating tool call is still part of the active thread's messages with the accepted background-task result persisted — the exact condition under which the chat UI binds the inline gallery. Records inspected from a different session, from Image Creator, from an archived thread, after message deletion, or after a restored non-gallery result shape keep their compact references, because nothing in the active view displays those images.

Human sends, forked regenerations, approval continuations, retries, and background follow-ups share a per-session generation lock. The manual "Reply Again Below" action is an intentional exception: chat sessions may run multiple alternative replies concurrently, while legacy picture sessions remain serialized. The follow-up atomically persists an automated user-role message plus an assistant placeholder before resuming the normal generation loop; tasks participating in the lock wait for one another, and transient delivery failures retry without duplicating the messages. The notification always states that no human sent it and that it grants no new approval. It contains only compact task metadata; image data and base64 payloads are never copied into session messages. The persisted message also carries structured background-task metadata so the chat UI can render a neutral, compact completion status and elapsed wait time instead of a normal user bubble.

While a task is active, the original tool step reads the image-generation record cache and shows a live elapsed wait time. A record left in `pending`/`generating` without an active in-memory runner is shown as waiting for recovery rather than as still polling. When a backend task id exists, the original tool step offers an explicit Resume action, and Image Creator retains the same recovery entry. Either path polls the already-submitted task and reconnects the completion callback without a second approval or provider submission. `image status` likewise returns `wait.mode = "manual_resume"` instead of promising a callback that no longer exists. Interrupted direct-provider requests without a backend task id are not resumable; they return `wait.mode = "manual_retry"` and require a newly approved request rather than risking a duplicate billable submission.

Image history is backed by the platform's device-wide `ImageGenerationStorage`; it is shared with Image Creator and is not scoped to the originating chat session. The default model is the first configured catalog entry. Chatbox AI catalog order is preserved from the server manifest, so the service can change the default model by changing the first item without a client release.

An explicitly requested `--provider`/`--model` is canonicalized against the catalog before approval comparison, signature binding, and execution. Matching tolerates case, display names, and punctuation variants ("GPT Image 2" resolves to `gpt-image-2`), in that priority order, and rejects references that match several different model ids instead of guessing. A reference that cannot be resolved fails with a usage error that embeds the available provider/model list, so the model can correct the id in one step instead of dropping `--model` and silently falling back to the default catalog model — that fallback loop is what previously made CLI image generation look locked to the default model. Provider-only requests keep defaulting to that provider's first catalog model.

This background behavior is in-app: closing the app stops the running renderer task. Existing Chatbox AI task ids remain available to the image-generation resume flow.
