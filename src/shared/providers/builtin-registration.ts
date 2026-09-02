/**
 * Ordered side-effect entrypoint for the built-in provider registry.
 *
 * Keep ChatboxAI first and preserve this import order: the registry's Map order
 * is also the default provider display order. Hosts that need model creation
 * import this module explicitly through their model-runtime entrypoint.
 */
import './definitions/chatboxai'
import './definitions/openai'
import './definitions/openai-responses'
import './definitions/gemini'
import './definitions/claude'
import './definitions/deepseek'
import './definitions/qwen'
import './definitions/qwen-portal'
import './definitions/minimax'
import './definitions/moonshot'
import './definitions/siliconflow'
import './definitions/openrouter'
import './definitions/ollama'
import './definitions/lmstudio'
import './definitions/azure'
import './definitions/groq'
import './definitions/xai'
import './definitions/mistral-ai'
import './definitions/perplexity'
import './definitions/volcengine'
import './definitions/chatglm'
import './definitions/github-copilot'
import './definitions/opencode-go'
import './definitions/opencode-zen'
import './definitions/bedrock'
import './definitions/vercel-ai-gateway'
import './definitions/tencent-hunyuan'
import './definitions/xiaomi-mimo'
import './definitions/longcat'
import './definitions/zhipu-glm-coding-plan'
