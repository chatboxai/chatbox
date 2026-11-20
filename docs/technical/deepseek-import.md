# DeepSeek conversation import

> Last updated: 2026-11

Settings → Data → Import from DeepSeek accepts a DeepSeek version 3 export ZIP or its HTTPS download link. Desktop and Capacitor share the renderer flow; React Native uses the same core importer with native file and download adapters.

## Import contract

- Each source conversation becomes a new local conversation. Reimporting creates another copy; there is no source identity index or merging.
- Titles and pinned state are retained. Session metadata and thread creation times use import time; message timestamps retain their source time.
- Conversation order follows the ZIP entry order within each pinned/unpinned group.
- All valid question and answer branches are retained. `current_message_id` selects the initial visible path; inactive subtrees select their most recent child. Multiple first-question versions share an empty system root that only exposes branch navigation.
- Markdown, Mermaid and LaTeX remain text for existing renderers. Thinking becomes reasoning content. Available image originals enter resource storage; missing originals and non-image attachments become informational placeholders. Search and link results become expandable references, rather than executable tool calls.
- Historical messages omit model/provider identity and use the existing Assistant fallback. New sessions use the current default chat model with Agent mode off; continuing uses the normal selected-path context and attachment pipeline.
- Conversations publish independently through `stageImportRows`. A malformed conversation is skipped. Cancellation retains already published conversations. No database schema change or complete-session runtime cache is introduced.

## Input and ownership

The shared importer reads one conversation at a time from a task-owned backup workspace. Images use fresh resource keys. Existing ZIP validation and bounded streaming readers handle the archive.

Desktop URL downloads use Electron's native network stack and an owner-scoped temporary file. Capacitor uses Filesystem download into cache; React Native streams native fetch into cache. Browser builds use fetch and offer ZIP selection when the server does not allow cross-origin reads. Signed query strings pass unchanged, credentials are omitted, and the submitted URL is cleared from the form. No Chatbox backend proxy is involved.

Import results include committed session/message/image counts, skipped sessions, cancellation and up to 100 issue details. Temporary files and unpublished candidates are cleaned up without rolling back committed conversations. Capacitor's download API cannot stop an in-flight native transfer: cancellation stops the import immediately and removes the late download when it finishes.

## Focused verification

`packages/chatbox-core/src/importers/deepseek/import.test.ts` covers content conversion, images, multiple roots, nested branches, partial import, cancellation, repeat imports and failed replies with descendants. Main-process tests cover signed URLs, owner isolation, HTTP failures and cancellation; renderer tests cover ZIP preview and URL submission. Existing transcript/fork/backup tests cover integration with current storage and presentation behavior.

Use the repository desktop and mobile QA skills for ZIP/link import, branch switching, renderer output, persistence after reload and continuation. Use synthetic conversations for UI evidence; never commit actual exports or signed download links.
