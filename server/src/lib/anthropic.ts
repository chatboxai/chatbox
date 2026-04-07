import Anthropic from '@anthropic-ai/sdk'

// Reads ANTHROPIC_API_KEY from process.env automatically
export const anthropic = new Anthropic()
