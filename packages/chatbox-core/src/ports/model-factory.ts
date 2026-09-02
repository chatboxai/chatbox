import type { ModelInterface } from '../models/types'
import type { SessionSettings } from '../types'

export interface ModelFactoryPort {
  createModel(settings: SessionSettings): Promise<ModelInterface>
}
