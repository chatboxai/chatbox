import { BedrockClient, ListInferenceProfilesCommand, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import type { ModelProvider, ProviderModelInfo, ProviderSettings, SessionType } from 'src/shared/types'
import { ModelProviderEnum } from 'src/shared/types'
import BaseConfig from './base-config'
import { ModelSettingUtil } from './interface'

export default class BedrockSettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider = ModelProviderEnum.Bedrock

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings
  ): Promise<string> {
    return `AWS Bedrock (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(providerSettings?: ProviderSettings): Promise<ProviderModelInfo[]> {
    try {
      // v3.0.73 only supports: accessKeyId, secretAccessKey, sessionToken (optional)
      // Create Bedrock client with credentials from settings
      if (!providerSettings?.awsAccessKeyId || !providerSettings?.awsSecretAccessKey) {
        console.warn('Bedrock: AWS Access Key ID and Secret Access Key are required')
        return []
      }

      const clientConfig: any = {
        region: providerSettings.awsRegion || 'us-east-1',
        credentials: {
          accessKeyId: providerSettings.awsAccessKeyId,
          secretAccessKey: providerSettings.awsSecretAccessKey,
        },
      }

      if (providerSettings.awsSessionToken) {
        clientConfig.credentials.sessionToken = providerSettings.awsSessionToken
      }

      const client = new BedrockClient(clientConfig)

      // Step 1: Fetch all foundation models to get capabilities info
      const foundationModelsCommand = new ListFoundationModelsCommand({})
      const foundationModelsResponse = await client.send(foundationModelsCommand)

      // Build a map of foundation model ID to capabilities and limits
      const modelCapabilitiesMap = new Map<
        string,
        {
          hasVision: boolean
          hasToolUse: boolean
          hasReasoning: boolean
          maxOutput: number
          contextWindow: number
        }
      >()

      foundationModelsResponse.modelSummaries?.forEach((model) => {
        // Include models that support streaming and are ACTIVE/LEGACY
        // Note: Claude 4+ models have inferenceTypesSupported: ["INFERENCE_PROFILE"] instead of ["ON_DEMAND"]
        if (
          model.modelId &&
          model.responseStreamingSupported === true &&
          (model.modelLifecycle?.status === 'ACTIVE' || model.modelLifecycle?.status === 'LEGACY')
        ) {
          // Use detailed info from 'converse' field if available
          const hasImageInput =
            model.inputModalities?.includes('IMAGE') ||
            (model as any).converse?.userImageTypesSupported?.length > 0 ||
            false
          const hasTextOutput = model.outputModalities?.includes('TEXT') || false
          const hasToolUse = hasTextOutput // Most text models support tool use
          const hasReasoning =
            (model as any).converse?.reasoningSupported !== undefined ||
            model.modelId.includes('sonnet-4') ||
            model.modelId.includes('opus-4') ||
            model.modelId.includes('claude-3-7')

          // Extract token limits from converse field
          const maxTokens = (model as any).converse?.maxTokensMaximum || 8_192

          // Parse context window from description or use defaults
          let contextWindow = 200_000 // Default
          const maxContextStr = (model as any).description?.maxContextWindow
          if (maxContextStr === '1M') {
            contextWindow = 1_000_000
          } else if (model.modelId.includes('claude-4') || model.modelId.includes('claude-3-7')) {
            contextWindow = 200_000
          } else if (model.modelId.includes('nova')) {
            contextWindow = 300_000
          }

          modelCapabilitiesMap.set(model.modelId, {
            hasVision: hasImageInput && hasTextOutput,
            hasToolUse,
            hasReasoning,
            maxOutput: maxTokens,
            contextWindow,
          })
        }
      })

      // Step 2: Fetch all inference profiles with pagination
      const allProfiles: any[] = []
      let nextToken: string | undefined = undefined

      do {
        const command = new ListInferenceProfilesCommand({
          maxResults: 1000, // Max allowed by AWS API
          nextToken,
        })
        const response = await client.send(command)

        if (response.inferenceProfileSummaries) {
          allProfiles.push(...response.inferenceProfileSummaries)
        }

        nextToken = response.nextToken
      } while (nextToken)

      // Step 3: Convert inference profiles to ProviderModelInfo
      const models: ProviderModelInfo[] = allProfiles
        .filter((profile) => {
          // Only include ACTIVE profiles
          return profile.status === 'ACTIVE'
        })
        .map((profile) => {
          // Extract foundation model ID from the first model ARN
          // ARN format: arn:aws:bedrock:region::foundation-model/model.id
          const firstModelArn = profile.models?.[0]?.modelArn
          let foundationModelId: string | undefined

          if (firstModelArn) {
            const match = firstModelArn.match(/foundation-model\/(.+)$/)
            if (match) {
              foundationModelId = match[1]
            }
          }

          // Get capabilities and limits from foundation model
          const capabilities: ('vision' | 'tool_use' | 'reasoning')[] = []
          let contextWindow = 200_000 // Default
          let maxOutput = 8_192 // Default

          if (foundationModelId && modelCapabilitiesMap.has(foundationModelId)) {
            const caps = modelCapabilitiesMap.get(foundationModelId)!
            if (caps.hasVision) capabilities.push('vision')
            if (caps.hasToolUse) capabilities.push('tool_use')
            if (caps.hasReasoning) capabilities.push('reasoning')
            contextWindow = caps.contextWindow
            maxOutput = caps.maxOutput
          }

          return {
            modelId: profile.inferenceProfileId!,
            nickname: profile.inferenceProfileName || profile.inferenceProfileId,
            type: 'chat' as const,
            capabilities,
            contextWindow,
            maxOutput,
          }
        })

      return models
    } catch (error) {
      console.error('Failed to list Bedrock models:', error)
      // Return empty array on error, let the UI show default models
      return []
    }
  }
}
