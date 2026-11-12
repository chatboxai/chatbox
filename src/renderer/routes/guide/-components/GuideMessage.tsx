/**
 * GuideMessage - Message component for the Guide Session
 * Matches the styling of the main chat session Message component
 */

import { Box, Flex, Loader, Stack } from '@mantine/core'
import { Grid } from '@mui/material'
import { AssistantAvatar, UserAvatar } from '@/components/common/Avatar'
import Loading from '@/components/icons/Loading'
import Markdown from '@/components/Markdown'
import { cn } from '@/lib/utils'
import type { UserLicense } from '@/packages/remote'
import type { GuideToolPart, GuideUIMessage, UserType } from '../-hooks/useGuideSession'
import {
  AutoNewChatLoading,
  FreeTrialLink,
  LoginButton,
  NewChatButton,
  NewChatTip,
  ProviderSettingsButton,
  ViewLicenseButton,
} from './ActionButton'
import { ClaimWaitingCard } from './ClaimWaitingCard'
import { SuggestedQuestions } from './SuggestedQuestions'
import { UserTypeCards } from './UserTypeCards'

interface GuideMessageProps {
  message: GuideUIMessage
  onSelectUserType?: (type: UserType) => void
  onLoginSuccess?: () => void
  onQuestionClick?: (question: string) => void
  onClaimStart?: () => void
  onClaimDetected?: (license: UserLicense, email: string) => void
  isLastMessage?: boolean
}

/**
 * Render a tool part as the appropriate UI component
 */
function ToolPartRenderer({
  part,
  onSelectUserType,
  onLoginSuccess,
  onQuestionClick,
  onClaimStart,
  onClaimDetected,
  disabled,
}: {
  part: GuideToolPart
  onSelectUserType?: (type: UserType) => void
  onLoginSuccess?: () => void
  onQuestionClick?: (question: string) => void
  onClaimStart?: () => void
  onClaimDetected?: (license: UserLicense, email: string) => void
  disabled?: boolean
}) {
  switch (part.toolName) {
    case 'show_user_type_cards':
      if (!onSelectUserType) return null
      return <UserTypeCards onSelect={onSelectUserType} disabled={disabled} />

    case 'show_login_button':
      if (!onLoginSuccess) return null
      return <LoginButton onLoginSuccess={onLoginSuccess} />

    case 'show_provider_settings_button':
      return <ProviderSettingsButton />

    case 'show_new_chat_button': {
      const label = typeof part.result?.label === 'string' ? part.result.label : undefined
      return <NewChatButton label={label} />
    }

    case 'show_auto_new_chat_loading': {
      return (
        <AutoNewChatLoading
          waitForWindowFocusBeforeAutoNavigate={part.result?.waitForWindowFocusBeforeAutoNavigate === true}
        />
      )
    }

    case 'show_new_chat_tip':
      return <NewChatTip />

    case 'show_view_license_button':
      return <ViewLicenseButton />

    case 'show_suggested_questions':
      if (!onQuestionClick) return null
      return <SuggestedQuestions onQuestionClick={onQuestionClick} disabled={disabled} />

    case 'show_free_trial_link':
      return <FreeTrialLink onAfterClick={onClaimStart} />

    case 'show_claim_waiting':
      if (!onClaimDetected) return null
      return <ClaimWaitingCard onClaimDetected={onClaimDetected} />

    case 'mark_completed':
    case 'activate_license':
      // These are side effect tools, no UI to render
      return null

    default:
      return null
  }
}

export function GuideMessage({
  message,
  onSelectUserType,
  onLoginSuccess,
  onQuestionClick,
  onClaimStart,
  onClaimDetected,
  isLastMessage,
}: GuideMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isStreaming = message.isStreaming

  // Check if message has text content
  const hasTextContent = message.parts.some((p) => p.type === 'text' && p.text)

  return (
    <Box
      className={cn(
        'msg-block w-full px-4 py-3',
        isStreaming ? 'rendering' : 'render-done',
        isUser ? 'user-msg' : 'assistant-msg'
      )}
    >
      <Grid container wrap="nowrap" spacing={1.5}>
        {/* Avatar Column */}
        <Grid item>
          <Box className={cn('relative', !isAssistant ? 'mt-1' : 'mt-2')}>
            {isAssistant ? <AssistantAvatar sessionType="guide" /> : <UserAvatar />}
            {/* Loading overlay on avatar - matches chat behavior */}
            {isAssistant && isStreaming && (
              <Flex className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <Loader size={32} classNames={{ root: "after:content-[''] after:border-[2px]" }} />
              </Flex>
            )}
          </Box>
        </Grid>

        {/* Content Column */}
        <Grid item xs sm container sx={{ width: '0px', paddingRight: '15px' }}>
          <Grid item xs>
            <div
              className={cn(
                'max-w-full inline-block',
                isUser ? 'bg-chatbox-background-secondary px-4 rounded-lg' : 'w-full'
              )}
            >
              <Box className="msg-content">
                {/* Render text parts */}
                {message.parts.map((part, index) => {
                  if (part.type === 'text' && part.text) {
                    const key = `${message.id}-text-${index}`
                    return isUser ? (
                      <p key={key} className="whitespace-pre-wrap break-words">
                        {part.text}
                      </p>
                    ) : (
                      <Markdown key={key} uniqueId={key} generating={isStreaming}>
                        {part.text}
                      </Markdown>
                    )
                  }
                  return null
                })}

                {/* Loading indicator when streaming with no content yet */}
                {isStreaming && !hasTextContent && <Loading />}
              </Box>
            </div>

            {/* Tool parts - rendered outside the text container */}
            <Stack gap="xs" mt={hasTextContent ? 'xs' : 0}>
              {message.parts.map((part) => {
                if (part.type.startsWith('tool-')) {
                  const toolPart = part as GuideToolPart
                  // Always render certain tools regardless of message position:
                  // - show_user_type_cards: selection state persists
                  // - show_login_button: maintains its own success state
                  // - show_suggested_questions: users can continue clicking questions
                  // Only hide other tools for non-last messages
                  if (
                    !isLastMessage &&
                    toolPart.toolName !== 'show_user_type_cards' &&
                    toolPart.toolName !== 'show_login_button' &&
                    toolPart.toolName !== 'show_suggested_questions'
                  ) {
                    return null
                  }
                  // Suggested questions should always be clickable (not disabled)
                  const shouldDisable = !isLastMessage && toolPart.toolName !== 'show_suggested_questions'
                  return (
                    <ToolPartRenderer
                      key={toolPart.toolCallId}
                      part={toolPart}
                      onSelectUserType={onSelectUserType}
                      onLoginSuccess={onLoginSuccess}
                      onQuestionClick={onQuestionClick}
                      onClaimStart={onClaimStart}
                      onClaimDetected={onClaimDetected}
                      disabled={shouldDisable}
                    />
                  )
                }
                return null
              })}
            </Stack>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  )
}
