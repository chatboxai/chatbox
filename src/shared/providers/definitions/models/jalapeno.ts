import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class Jalapeno extends OpenAICompatible {
  public name = 'Jalapeno Cloud 50% Off'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.options = options
  }
}
