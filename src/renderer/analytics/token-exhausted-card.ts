import type { ChatboxAIPlanType } from '@shared/types'
import { buildChatJkTrackingOptions, type ChatTrackingContext } from './chat'
import { trackJkAutoEvent, trackJkClickEvent } from './jk'
import { JK_EVENTS } from './jk-events'

export type TokenExhaustedCardAction = 'upgrade-plan' | 'buy-expansion-pack'
export type TokenExhaustedCardEvent = 'exposure' | 'click'

export type TokenExhaustedCardTrackingContext = ChatTrackingContext & {
  action: TokenExhaustedCardAction
  plan?: ChatboxAIPlanType
}

function buildTokenExhaustedCardTrackingOptions(
  context: ChatTrackingContext,
  card: Pick<TokenExhaustedCardTrackingContext, 'action' | 'plan'>
) {
  const baseOptions = buildChatJkTrackingOptions(context)
  return {
    ...baseOptions,
    content: card.plan ?? null,
    contentType: context.model,
    props: {
      ...baseOptions.props,
      agent_info: {
        content: card.action === 'buy-expansion-pack' ? 'buy_token' : 'upgrade',
        ...baseOptions.props.agent_info,
      },
      content_add_info: {
        content: context.provider ?? null,
      },
    },
  }
}

export function trackTokenExhaustedCard(
  event: TokenExhaustedCardEvent,
  context: TokenExhaustedCardTrackingContext
): void {
  const options = buildTokenExhaustedCardTrackingOptions(context, context)
  if (event === 'exposure') {
    trackJkAutoEvent(JK_EVENTS.TOKEN_EXHAUSTED_CARD, options)
  } else {
    trackJkClickEvent(JK_EVENTS.TOKEN_EXHAUSTED_CARD_CLICK, options)
  }
}
