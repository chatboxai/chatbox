import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { AwsClient } from 'aws4fetch'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey?: string
  accessKey?: string
  secretKey?: string
  sessionToken?: string
  region: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
}

interface FoundationModelSummary {
  modelId: string
  modelName?: string
  responseStreamingSupported?: boolean
  inputModalities?: string[]
  outputModalities?: string[]
  modelLifecycle?: { status: string }
}

interface InferenceProfileSummary {
  inferenceProfileId: string
  inferenceProfileName?: string
  status?: string
  models?: { modelArn?: string }[]
}

export default class Bedrock extends AbstractAISDKModel {
  public name = 'AWS Bedrock'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getProvider() {
    if (this.options.apiKey) {
      return createAmazonBedrock({
        region: this.options.region,
        apiKey: this.options.apiKey,
      })
    }

    const config: {
      region: string
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    } = {
      region: this.options.region,
      accessKeyId: this.options.accessKey || '',
      secretAccessKey: this.options.secretKey || '',
    }

    if (this.options.sessionToken) {
      config.sessionToken = this.options.sessionToken
    }

    return createAmazonBedrock(config)
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  private createFetcher(): (url: string) => Promise<Response> {
    const region = this.options.region || 'us-east-1'
    if (this.options.apiKey) {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      }
      return (url: string) => fetch(url, { headers })
    }

    const awsClient = new AwsClient({
      accessKeyId: this.options.accessKey || '',
      secretAccessKey: this.options.secretKey || '',
      sessionToken: this.options.sessionToken,
      region,
      service: 'bedrock',
    })
    return (url: string) => awsClient.fetch(url)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    if (!this.options.apiKey && !this.options.accessKey) {
      return []
    }

    const region = this.options.region || 'us-east-1'
    const baseUrl = `https://bedrock.${region}.amazonaws.com`
    const fetcher = this.createFetcher()

    const [foundationModels, inferenceProfiles] = await Promise.all([
      this.fetchFoundationModels(baseUrl, fetcher),
      this.fetchInferenceProfiles(baseUrl, fetcher),
    ])

    const capabilitiesMap = this.buildCapabilitiesMap(foundationModels)

    return inferenceProfiles
      .filter((p) => p.status === 'ACTIVE')
      .map((profile) => {
        const foundationModelId = this.extractFoundationModelId(profile)
        const caps = foundationModelId ? capabilitiesMap.get(foundationModelId) : undefined

        const capabilities: ProviderModelInfo['capabilities'] = []
        if (caps?.hasVision) capabilities.push('vision')
        if (caps?.hasToolUse) capabilities.push('tool_use')

        return {
          modelId: profile.inferenceProfileId,
          nickname: profile.inferenceProfileName || profile.inferenceProfileId,
          type: 'chat' as const,
          capabilities,
          contextWindow: caps?.contextWindow ?? 200_000,
          maxOutput: caps?.maxOutput ?? 8_192,
        }
      })
  }

  private async fetchFoundationModels(
    baseUrl: string,
    fetcher: (url: string) => Promise<Response>
  ): Promise<FoundationModelSummary[]> {
    const response = await fetcher(`${baseUrl}/foundation-models`)
    if (!response.ok) {
      throw new Error(`Failed to list foundation models: ${response.status}`)
    }
    const data = (await response.json()) as { modelSummaries?: FoundationModelSummary[] }
    return data.modelSummaries ?? []
  }

  private async fetchInferenceProfiles(
    baseUrl: string,
    fetcher: (url: string) => Promise<Response>
  ): Promise<InferenceProfileSummary[]> {
    const profiles: InferenceProfileSummary[] = []
    let nextToken: string | undefined

    do {
      const url = nextToken
        ? `${baseUrl}/inference-profiles?maxResults=1000&nextToken=${encodeURIComponent(nextToken)}`
        : `${baseUrl}/inference-profiles?maxResults=1000`

      const response = await fetcher(url)
      if (!response.ok) {
        throw new Error(`Failed to list inference profiles: ${response.status}`)
      }
      const data = (await response.json()) as {
        inferenceProfileSummaries?: InferenceProfileSummary[]
        nextToken?: string
      }
      if (data.inferenceProfileSummaries) {
        profiles.push(...data.inferenceProfileSummaries)
      }
      nextToken = data.nextToken
    } while (nextToken)

    return profiles
  }

  private buildCapabilitiesMap(models: FoundationModelSummary[]) {
    const map = new Map<
      string,
      { hasVision: boolean; hasToolUse: boolean; contextWindow: number; maxOutput: number }
    >()

    for (const model of models) {
      if (!model.modelId || !model.responseStreamingSupported) continue
      if (model.modelLifecycle?.status !== 'ACTIVE' && model.modelLifecycle?.status !== 'LEGACY') continue

      const hasVision =
        (model.inputModalities?.includes('IMAGE') && model.outputModalities?.includes('TEXT')) || false
      const hasToolUse = model.outputModalities?.includes('TEXT') || false

      let contextWindow = 200_000
      if (model.modelId.includes('nova')) {
        contextWindow = 300_000
      }

      map.set(model.modelId, {
        hasVision,
        hasToolUse,
        contextWindow,
        maxOutput: 8_192,
      })
    }

    return map
  }

  private extractFoundationModelId(profile: InferenceProfileSummary): string | undefined {
    const arn = profile.models?.[0]?.modelArn
    if (!arn) return undefined
    const match = arn.match(/foundation-model\/(.+)$/)
    return match?.[1]
  }
}
