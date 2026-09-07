import type { GenerationModelContext, GenerationModelFactoryPort } from '../generation'
import type { ModelInterface } from '../models/types'
import type { SessionSettings } from '../types'

type ContextFactory<TContext> = TContext | ((settings: SessionSettings) => TContext)

export class MockModelFactory<TContext> implements GenerationModelFactoryPort<TContext> {
  readonly requestedSettings: SessionSettings[] = []

  constructor(
    readonly model: ModelInterface,
    private readonly context: ContextFactory<TContext>
  ) {}

  createModel(settings: SessionSettings): Promise<ModelInterface> {
    this.requestedSettings.push(settings)
    return Promise.resolve(this.model)
  }

  async createContext(settings: SessionSettings): Promise<GenerationModelContext<TContext>> {
    const model = await this.createModel(settings)
    return {
      model,
      context:
        typeof this.context === 'function'
          ? (this.context as (value: SessionSettings) => TContext)(settings)
          : this.context,
    }
  }

  createWithContext(settings: SessionSettings, _context: TContext): Promise<ModelInterface> {
    return this.createModel(settings)
  }
}
