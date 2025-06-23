// import { ModelProvider, SessionSettings } from '../../shared/types'
// import { openaiModelConfigs } from '../packages/models/openai'
// import * as defaults from '../../shared/defaults'

/**
 * 根据模型提供方、模型版本的设置，重置模型的 maxTokens、maxContextTokens
 */
// export function resetTokenConfig(settings: SessionSettings): SessionSettings {
//     switch (settings.aiProvider) {
//         case ModelProviderEnum.OpenAI:
//             const model = getTokenLimits(settings)
//             settings.openaiMaxTokens = model.maxTokens // 默认最小值
//             settings.openaiMaxContextTokens = model.maxContextTokens // 默认最大值
//             if (settings.model.startsWith('gpt-4')) {
//                 settings.openaiMaxContextMessageCount = 6
//             } else {
//                 settings.openaiMaxContextMessageCount = 999
//             }
//             break
//         case ModelProviderEnum.Azure:
//             settings.openaiMaxTokens = defaults.settings().openaiMaxTokens
//             settings.openaiMaxContextTokens = defaults.settings().openaiMaxContextTokens
//             settings.openaiMaxContextMessageCount = 8
//             break
//         case ModelProviderEnum.ChatboxAI:
//             settings.openaiMaxTokens = 0
//             settings.openaiMaxContextTokens = 128_000
//             settings.openaiMaxContextMessageCount = 8
//             break
//         case ModelProviderEnum.ChatGLM6B:
//             settings.openaiMaxTokens = 0
//             settings.openaiMaxContextTokens = 2000
//             settings.openaiMaxContextMessageCount = 4
//             break
//         case ModelProviderEnum.Claude:
//             settings.openaiMaxContextMessageCount = 10
//             break
//         default:
//             break
//     }
//     return settings
// }

/**
 * 根据设置获取模型的 maxTokens、maxContextTokens 的取值范围
 * @param settings
 * @returns
 */
// export function getTokenLimits(settings: SessionSettings) {
//     if (settings.aiProvider === ModelProviderEnum.OpenAI && settings.model !== 'custom-model') {
//         return openaiModelConfigs[settings.model]
//     }
//     return {
//         maxTokens: 4_096,
//         maxContextTokens: 128_000,
//     }
// }
