import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class VolcEngineCodingPlan extends OpenAICompatible {
  public name = 'VolcEngine Coding Plan'
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.options = options
  }

  public listModels() {
    return Promise.resolve([])
  }
}
