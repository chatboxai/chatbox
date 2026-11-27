/**
 * Open build switches.
 *
 * This build ships the open-source client only: the hosted Chatbox AI catalog (paid models),
 * the license/upgrade upsells and the paid MCP proxy are not part of the product. Everything
 * that only makes sense together with a Chatbox AI subscription is gated on these flags so the
 * app works end to end with your own provider API keys.
 */

/** Chatbox AI provider, hosted model catalog, licenses, trials and upgrade prompts. */
export const CHATBOX_AI_ENABLED = false

/** Builtin MCP servers that are proxied by Chatbox AI and need a license key. */
export const CHATBOX_AI_MCP_PROXY_ENABLED = false
