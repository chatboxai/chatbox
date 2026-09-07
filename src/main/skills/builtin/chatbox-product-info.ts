import type { SkillMetadata } from '../../../shared/types/skills'

export const metadata: SkillMetadata = {
  name: 'chatbox-product-info',
  description:
    'Chatbox product specialist and app operator. Use for product documentation and pricing, account and quota status, read-only settings, conversation history, image generation, authentication, developer docs, or MCP access.',
}

export const body = `
# Chatbox Product Information

Use this skill when the user asks about Chatbox AI product capabilities, subscriptions, paid plans, license management, billing, authentication, developer APIs, MCP access, local Chatbox settings, conversation history, or image generation.

## Source of truth

- Start from https://chatboxai.app/llms.txt for current machine-readable discovery links.
- For pricing, subscriptions, paid plans, usage limits, or billing, follow the "Machine-readable pricing" link from llms.txt, currently https://chatboxai.app/pricing.md.
- For product guides, follow the guide link from llms.txt.
- For developer, authentication, API, MCP, or integration questions, follow the relevant docs links from llms.txt.

## Virtual CLI

- \`chatbox_cli\` is a controlled in-app virtual CLI, not a shell. Never pass its commands to \`user_exec\`.
- Prefer structured \`argv\` over a command string. Start with \`["capabilities"]\` or \`["help", "<domain>"]\` when command details are unclear.
- Before using settings, chats, or image commands, call \`["capabilities"]\` once. If the installed client reports that command as unsupported, do not try newer commands; explain that a client upgrade is required. Legacy account commands remain available.
- Command hierarchy:
  - Account: \`["account", "status"]\`, \`["account", "license"]\`, \`["account", "quota"]\`, \`["account", "refresh"]\`, \`["version"]\`.
  - Settings: \`["settings", "list"]\`, \`["settings", "get", "<key>"]\`.
  - Chats: \`["chats", "list"]\`, \`["chats", "search", "<query>"]\`, \`["chats", "read", "<session-id>"]\`.
  - Images: \`["image", "models"]\`, \`["image", "generate", "--prompt", "<prompt>"]\`, \`["image", "status", "<record-id>"]\`, \`["image", "history"]\`.
- Use account refresh when the user asks for current remaining quota or current license state.
- Conversation list/search/read are local read-only operations and do not require approval. Keep results focused; use cursors and small limits instead of dumping whole histories.
- Settings are exposed through a read-only allowlist and do not require approval. When the user asks to change a setting, use list/get if needed to identify its current value and returned Settings location, then guide the user to change it manually in Chatbox Settings. Never claim the setting changed and never use another tool to bypass this restriction.
- Image generation is asynchronous and potentially billable, so starting it pauses for explicit user approval. Chatbox renders a localized image-specific approval card with the provider, model, prompt, image count, and billing/quota guidance. The command returns a record id after approval and continues in the background.
- Image generation defaults to the first configured model. When the user asks for a specific image model, pass \`--model\` with its id or display name (matched case-insensitively); run \`["image", "models"]\` first when unsure which models exist. If the requested model cannot be resolved, the error lists the available models — pick the matching id or tell the user it is unavailable. Never silently generate with the default model when the user asked for a specific one.
- An accepted result has \`wait.mode = "callback"\` and \`wait.modelShouldPoll = false\`. End the turn immediately after acceptance. Do not call any \`chatbox_cli\` command to poll; Chatbox also removes that tool from the rest of the current tool loop.
- When a background image task finishes, Chatbox sends an automated user-role notification so the model can continue. The notification explicitly says no human sent it and it grants no new approval. Treat it as task state, not as a new human instruction. Chatbox already shows the generated images to the user inline at the original generate tool call, so never render them again in the reply: no Markdown images and no image links. Confirm completion briefly instead, and call \`image status <record-id>\` at most once after the callback, only when the task failed or the user asks for details.
- Use \`image status\` before completion only when the user explicitly asks for status or when diagnosing recovery after an app restart. \`image history\` is the device-wide Image Creator history, not the current session's history.

## Documentation lookup

- Prefer web/fetch tools for retrieving the current Chatbox documentation pages.
- If only code execution is available, use a short Node.js or Bash request to fetch the relevant Markdown/text URL. Do not install packages.
- Do not use user_exec for documentation lookup.
- Keep fetched excerpts small. Summarize the relevant facts and include the source URL.

## Answering rules

- Fetch the relevant source before answering when current product, pricing, plan, or access details matter.
- Do not rely on memory for prices, plan names, model availability, quotas, or billing policies.
- If the source cannot be fetched, say that the current source could not be accessed and avoid inventing details.
- Include the source URL used in the answer when giving product or billing facts.
- Answer in the user's language unless they ask otherwise.
`
