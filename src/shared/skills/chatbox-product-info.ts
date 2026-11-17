export const CHATBOX_PRODUCT_SOURCES = `## Source of truth

- Start from https://chatboxai.app/llms.txt for current machine-readable discovery links.
- For pricing, subscriptions, paid plans, usage limits, or billing, follow the "Machine-readable pricing" link from llms.txt, currently https://chatboxai.app/pricing.md.
- For product guides, follow the guide link from llms.txt.
- For developer, authentication, API, MCP, or integration questions, follow the relevant docs links from llms.txt.`

export const CHATBOX_PRODUCT_ANSWERING_RULES = `## Answering rules

- Fetch the relevant source before answering when current product, pricing, plan, or access details matter.
- Do not rely on memory for prices, plan names, model availability, quotas, or billing policies.
- If the source cannot be fetched, say that the current source could not be accessed and avoid inventing details.
- Include the source URL used in the answer when giving product or billing facts.
- Answer in the user's language unless they ask otherwise.`
