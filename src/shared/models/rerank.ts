import type { QueryResult } from '@mastra/core/vector'
import type { RerankerFunctionOptions, RerankResult } from '@mastra/rag'
import type { CohereClient } from 'cohere-ai'

// Takes in a list of results from a vector store and reranks them based on Cohere's rerank API
export async function rerank(
  results: QueryResult[],
  query: string,
  model: {
    client: CohereClient
    modelId: string
  },
  options: RerankerFunctionOptions
): Promise<RerankResult[]> {
  const { topK = 5 } = options

  // Extract text content from results for reranking
  const documents = results.map((result) => result?.metadata?.text || '').filter((text) => text.length > 0)

  if (documents.length === 0) {
    return []
  }

  // Call Cohere rerank API with all documents at once
  const response = await model.client.rerank({
    query,
    documents,
    model: model.modelId,
    topN: Math.min(topK, documents.length),
  })

  // Map rerank results back to original QueryResult format
  const rerankResults: RerankResult[] = response.results.map((rerankItem) => {
    const originalResult = results[rerankItem.index]

    return {
      result: originalResult,
      score: rerankItem.relevanceScore,
      details: {
        semantic: rerankItem.relevanceScore,
        vector: originalResult.score,
        position: rerankItem.index,
        rerankIndex: rerankItem.index,
      },
    }
  })

  return rerankResults
}
