import { createMessage, type Message, type MessageInfoPart } from '@shared/types'
import {
  type WeatherDashboardHostState,
  WEATHER_DASHBOARD_MODEL_NAME,
  resolveWeatherDashboardTurn,
} from '@shared/weather-dashboard/intent'
import { getMessageText } from '@shared/utils/message'

function createWeatherDashboardInfoPart(text: string, state: WeatherDashboardHostState): MessageInfoPart {
  return {
    type: 'info',
    text,
    values: state,
  }
}

export function interceptWeatherDashboardTurn(messages: Message[], newUserMsg: Message): Message | null {
  if (newUserMsg.files?.length || newUserMsg.links?.length) {
    return null
  }

  const userText = getMessageText(newUserMsg, false, true).trim()
  if (!userText) {
    return null
  }

  const result = resolveWeatherDashboardTurn(messages, userText)
  if (result.kind === 'none') {
    return null
  }

  const assistantMessage = createMessage('assistant')
  assistantMessage.model = WEATHER_DASHBOARD_MODEL_NAME
  assistantMessage.name = WEATHER_DASHBOARD_MODEL_NAME
  assistantMessage.contentParts = [createWeatherDashboardInfoPart(result.message, result.state)]
  return assistantMessage
}
