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
      const foundationModelsCommand = new ListFoundationModelsCommand({
        byInferenceType: 'ON_DEMAND', // Only models that support on-demand throughput
      })
      const foundationModelsResponse = await client.send(foundationModelsCommand)

      // Build a map of foundation model ID to capabilities
      const modelCapabilitiesMap = new Map<
        string,
        {
          hasVision: boolean
          hasToolUse: boolean
          hasReasoning: boolean
        }
      >()

      foundationModelsResponse.modelSummaries?.forEach((model) => {
        // Include models that support ON_DEMAND inference and streaming
        // LEGACY models are still usable (just means there's a newer version)
        if (
          model.modelId &&
          model.responseStreamingSupported === true &&
          (model.modelLifecycle?.status === 'ACTIVE' || model.modelLifecycle?.status === 'LEGACY')
        ) {
          const hasImageInput = model.inputModalities?.includes('IMAGE') || false
          const hasTextOutput = model.outputModalities?.includes('TEXT') || false
          const hasToolUse = hasTextOutput // Most text models support tool use
          const hasReasoning =
            model.modelId.includes('sonnet-4') ||
            model.modelId.includes('opus-4') ||
            model.modelId.includes('claude-3-7')

          modelCapabilitiesMap.set(model.modelId, {
            hasVision: hasImageInput && hasTextOutput,
            hasToolUse,
            hasReasoning,
          })
        }
      })

      // Step 2: Fetch all inference profiles with pagination
      const allProfiles: any[] = []
      let nextToken: string | undefined = undefined

      do {
        const command = new ListInferenceProfilesCommand({
          maxResults: 100,
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

          // Get capabilities from foundation model
          const capabilities: ('vision' | 'tool_use' | 'reasoning')[] = []
          if (foundationModelId && modelCapabilitiesMap.has(foundationModelId)) {
            const caps = modelCapabilitiesMap.get(foundationModelId)!
            if (caps.hasVision) capabilities.push('vision')
            if (caps.hasToolUse) capabilities.push('tool_use')
            if (caps.hasReasoning) capabilities.push('reasoning')
          }

          return {
            modelId: profile.inferenceProfileId!,
            nickname: profile.inferenceProfileName || profile.inferenceProfileId,
            capabilities,
            // AWS doesn't provide token limits in the list API, use defaults
            contextWindow: 200_000,
            maxOutput: 8_192,
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
