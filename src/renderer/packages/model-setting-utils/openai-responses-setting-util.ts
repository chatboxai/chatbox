import { ModelProviderEnum } from 'src/shared/types'
import CustomOpenAIResponsesSettingUtil from './custom-openai-responses-util'

export default class OpenAIResponsesSettingUtil extends CustomOpenAIResponsesSettingUtil {
  public provider = ModelProviderEnum.OpenAIResponses
}
