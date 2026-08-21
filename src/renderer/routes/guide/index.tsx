/**
 * Guide Session Page
 * A conversational onboarding experience for new users
 */

import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
  UnstyledButton,
} from '@mantine/core'
import type { Language } from '@shared/types'
import {
  IconArrowUp,
  IconBug,
  IconCheck,
  IconChevronRight,
  IconLanguage,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
  IconPlayerSkipForward,
  IconPlayerStopFilled,
  IconRefresh,
  IconUserCheck,
} from '@tabler/icons-react'
import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Disclaimer from '@/components/Disclaimer'
import ProviderImageIcon from '@/components/icons/ProviderImageIcon'
import WindowControls from '@/components/layout/WindowControls'
import { getShowGuideDevButtonsFlag } from '@/dev/devToolsFlags'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { languageNameMap, languages } from '@/i18n/locales'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { GuideMessage } from './-components/GuideMessage'
import { useGuideSession } from './-hooks/useGuideSession'

export const Route = createFileRoute('/guide/')({
  component: GuidePage,
})

function GuidePage() {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [pendingLanguage, setPendingLanguage] = useState<Language | null>(null)

  const {
    messages,
    isLoading,
    error,
    onboardingStep,
    sendMessage,
    stopGeneration,
    selectUserType,
    markGuideCompleted,
    onClaimStart,
    onClaimDetected,
    handleConfigComplete,
    clearSession,
    debugResetGuide,
    debugSkipToLoginSuccess,
    debugTriggerRoundLimit,
    canSendMessage,
    hasValidConfig,
    isGuideInProgress,
  } = useGuideSession()

  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()
  const isSmallScreen = useIsSmallScreen()
  const showDebug = getShowGuideDevButtonsFlag()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)

  // Language switcher state
  const { i18n } = useTranslation()
  const currentLanguage = useSettingsStore((s) => s.language)
  const setSettings = useSettingsStore((s) => s.setSettings)

  // Check if any message is currently streaming
  const isStreaming = messages.some((m) => m.isStreaming)
  const canSwitchLanguage = !isStreaming

  const applyLanguageChange = useCallback(
    async (newLanguage: Language) => {
      setSettings({ language: newLanguage })
      // Wait for i18n to update before clearing session
      await i18n.changeLanguage(newLanguage)
      // Small delay to ensure React re-renders with new translations
      setTimeout(() => {
        clearSession()
      }, 50)
    },
    [setSettings, i18n, clearSession]
  )

  // Handle language change
  const handleLanguageChange = useCallback(
    async (newLanguage: Language) => {
      if (newLanguage === currentLanguage || !canSwitchLanguage) return
      // If guide already has user interaction/progress, require confirmation before reset.
      if (isGuideInProgress) {
        setPendingLanguage(newLanguage)
        return
      }

      await applyLanguageChange(newLanguage)
    },
    [currentLanguage, canSwitchLanguage, isGuideInProgress, applyLanguageChange]
  )

  const confirmLanguageChange = useCallback(async () => {
    if (!pendingLanguage) return
    const languageToApply = pendingLanguage
    setPendingLanguage(null)
    await applyLanguageChange(languageToApply)
  }, [pendingLanguage, applyLanguageChange])

  // Auto-scroll to bottom when messages change or during streaming
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages.length triggers scroll on new messages
  useEffect(() => {
    const scrollToBottom = () => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight
      }
    }

    // Always scroll when messages change
    scrollToBottom()

    // During streaming, continuously scroll using animation frame
    if (isStreaming) {
      let animationFrameId: number
      const keepScrolling = () => {
        scrollToBottom()
        animationFrameId = requestAnimationFrame(keepScrolling)
      }
      animationFrameId = requestAnimationFrame(keepScrolling)
      return () => cancelAnimationFrame(animationFrameId)
    }
  }, [messages.length, isStreaming])

  // Check config when returning from settings
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleConfigComplete()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [handleConfigComplete])

  // Block navigation if guide is in progress, user hasn't completed config, and guide not completed
  const { proceed, reset, status } = useBlocker({
    condition: isGuideInProgress && !hasValidConfig && onboardingStep !== 'completed',
  })
  const showInputArea = onboardingStep === 'completed' && canSendMessage

  // Handle send message
  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading || !canSendMessage) return
    setInputValue('')
    sendMessage(trimmed)
  }, [inputValue, isLoading, canSendMessage, sendMessage])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const languageSwitcher = (
    <Menu
      position="bottom-end"
      shadow="md"
      transitionProps={{ transition: 'fade-up', duration: 200 }}
      disabled={!canSwitchLanguage}
    >
      <Menu.Target>
        <UnstyledButton
          className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
            canSwitchLanguage ? 'hover:bg-[var(--chatbox-background-tertiary)]' : 'cursor-not-allowed opacity-50'
          }`}
          disabled={!canSwitchLanguage}
          aria-label={`${t('Switch language')}: ${languageNameMap[currentLanguage]}`}
          title={isSmallScreen ? `${t('Switch language')}: ${languageNameMap[currentLanguage]}` : undefined}
        >
          <ScalableIcon icon={IconLanguage} size={16} className="text-chatbox-tint-secondary" />
          {!isSmallScreen && (
            <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
              {languageNameMap[currentLanguage]}
            </Text>
          )}
          <ScalableIcon
            icon={IconChevronRight}
            size={14}
            className="text-chatbox-tint-tertiary rotate-90 flex-shrink-0"
          />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t('Select Language')}</Menu.Label>
        {languages.map((lang) => (
          <Menu.Item
            key={lang}
            onClick={() => handleLanguageChange(lang)}
            rightSection={
              lang === currentLanguage ? (
                <ScalableIcon icon={IconCheck} size={14} className="text-chatbox-tint-brand" />
              ) : null
            }
          >
            {languageNameMap[lang]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )

  return (
    <Stack h="100%" gap={0} className="bg-chatbox-background-primary">
      {/* Header */}
      <Flex h={48} align="center" px="md" className="flex-none title-bar">
        <Flex align="center" className={!showSidebar && needRoomForMacWindowControls ? 'pl-20' : ''}>
          <ActionIcon
            className="controls"
            aria-label={showSidebar && !isSmallScreen ? t('Collapse') : t('Expand')}
            variant="subtle"
            size={isSmallScreen ? 24 : 20}
            color={isSmallScreen ? 'chatbox-secondary' : 'chatbox-tertiary'}
            mr="xs"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {isSmallScreen ? (
              <IconMenu2 />
            ) : showSidebar ? (
              <IconLayoutSidebarLeftCollapse />
            ) : (
              <IconLayoutSidebarLeftExpand />
            )}
          </ActionIcon>
        </Flex>

        <Flex align="center" gap="xxs" flex={1} {...(isSmallScreen ? { justify: 'center', pl: 28, pr: 8 } : {})}>
          <Title order={4} fz={!isSmallScreen ? 18 : undefined} lh="24px" fw={600} lineClamp={1}>
            {t('Getting Started')}
          </Title>
        </Flex>

        <Flex align="center" gap="xs" className="controls">
          {languageSwitcher}
          {showDebug && (
            <Text size="xs" c="chatbox-tertiary">
              debug info: {onboardingStep}
            </Text>
          )}
          {showDebug && (
            <Menu position="bottom-end" shadow="md">
              <Menu.Target>
                <ActionIcon variant="subtle" size="sm" aria-label="Guide debug actions">
                  <ScalableIcon icon={IconBug} size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Debug Actions</Menu.Label>
                <Menu.Item
                  leftSection={<ScalableIcon icon={IconUserCheck} size={14} />}
                  onClick={debugSkipToLoginSuccess}
                >
                  Skip to Login Success
                </Menu.Item>
                <Menu.Item
                  leftSection={<ScalableIcon icon={IconPlayerSkipForward} size={14} />}
                  onClick={debugTriggerRoundLimit}
                >
                  Trigger Round Limit
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<ScalableIcon icon={IconRefresh} size={14} />} onClick={debugResetGuide}>
                  Reset Guide
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Flex>

        <WindowControls className="-mr-3 ml-2" />
      </Flex>
      <Divider />

      {/* Messages */}
      <ScrollArea viewportRef={viewportRef} className="flex-1" type="scroll">
        <Stack gap={0} pt="md" pb="md" mb={showInputArea ? 0 : 120} maw={800} mx="auto">
          {messages.map((message, index) => (
            <GuideMessage
              key={message.id}
              message={message}
              onSelectUserType={selectUserType}
              onLoginSuccess={markGuideCompleted}
              onQuestionClick={sendMessage}
              onClaimStart={onClaimStart}
              onClaimDetected={onClaimDetected}
              isLastMessage={index === messages.length - 1}
            />
          ))}

          {/* Error display */}
          {error && (
            <Box px="md" py="sm">
              <Text c="chatbox-error" size="sm">
                {error}
              </Text>
            </Box>
          )}
        </Stack>
      </ScrollArea>

      {showInputArea && (
        <Box px="sm" pb="md" pt="sm" className="flex-shrink-0">
          <Stack gap="xs" maw="56rem" mx="auto">
            <Stack
              className="bg-chatbox-background-secondary rounded-lg p-3"
              style={{ border: '1px solid var(--chatbox-border-primary)' }}
              gap="xs"
            >
              {/* Input Row */}
              <Flex align="flex-end" gap={4}>
                <Textarea
                  ref={textareaRef}
                  unstyled={true}
                  classNames={{
                    root: 'flex-1',
                    wrapper: 'flex-1',
                    input:
                      'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-chatbox-tint-primary',
                  }}
                  size="sm"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('Type your Chatbox AI-related question here') || ''}
                  disabled={!canSendMessage || isLoading}
                  autosize
                  minRows={2}
                  maxRows={6}
                  autoFocus={!isSmallScreen}
                />

                {/* Send Button */}
                <ActionIcon
                  disabled={(!inputValue.trim() || !canSendMessage) && !isLoading}
                  size={32}
                  variant="filled"
                  color={isLoading ? 'dark' : 'chatbox-brand'}
                  radius="lg"
                  onClick={isLoading ? stopGeneration : handleSend}
                  className={`shrink-0 mb-1 ${(!inputValue.trim() || !canSendMessage) && !isLoading ? 'disabled:!opacity-100 !text-white' : ''}`}
                  style={
                    (!inputValue.trim() || !canSendMessage) && !isLoading
                      ? { backgroundColor: 'rgba(222, 226, 230, 1)' }
                      : undefined
                  }
                >
                  {isLoading ? (
                    <ScalableIcon icon={IconPlayerStopFilled} size={16} />
                  ) : (
                    <ScalableIcon icon={IconArrowUp} size={16} />
                  )}
                </ActionIcon>
              </Flex>

              {/* Bottom toolbar */}
              <Flex justify="flex-end" align="center">
                {/* Model Selector */}
                <Menu position="top-end" shadow="md" transitionProps={{ transition: 'fade-up', duration: 200 }}>
                  <Menu.Target>
                    <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                      <ProviderImageIcon provider="chatbox-ai" size={18} />
                      <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
                        Chatbox Guide
                      </Text>
                      <ScalableIcon
                        icon={IconChevronRight}
                        size={14}
                        className="text-chatbox-tint-tertiary rotate-90 flex-shrink-0"
                      />
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<ProviderImageIcon provider="chatbox-ai" size={16} />}
                      rightSection={<ScalableIcon icon={IconCheck} size={14} className="text-chatbox-tint-brand" />}
                    >
                      Chatbox Guide
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Flex>
            </Stack>

            <Disclaimer />
          </Stack>
        </Box>
      )}

      {/* Leave Confirmation Dialog */}
      {status === 'blocked' && (
        <Box className="fixed inset-0 bg-black/50 flex items-center justify-center z-[3000]" onClick={() => reset()}>
          <Box
            className="bg-chatbox-background-primary rounded-lg p-6 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Stack gap="md">
              <Title order={4}>{t('Leave Guide?')}</Title>
              <Text size="sm" c="chatbox-secondary">
                {t("You haven't completed the setup yet. Your progress will be cleared if you leave now.")}
              </Text>
              <Flex gap="sm" justify="flex-end">
                <Button variant="subtle" onClick={() => reset()}>
                  {t('Stay')}
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    clearSession()
                    proceed()
                  }}
                >
                  {t('Leave')}
                </Button>
              </Flex>
            </Stack>
          </Box>
        </Box>
      )}

      {/* Language Change Confirmation Dialog */}
      {pendingLanguage && (
        <Box
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[3000]"
          onClick={() => setPendingLanguage(null)}
        >
          <Box
            className="bg-chatbox-background-primary rounded-lg p-6 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Stack gap="md">
              <Title order={4}>Switch Language?</Title>
              <Text size="sm" c="chatbox-secondary">
                Switching language will restart the guide and clear your current progress.
              </Text>
              <Flex gap="sm" justify="flex-end">
                <Button variant="subtle" onClick={() => setPendingLanguage(null)}>
                  Cancel
                </Button>
                <Button color="red" onClick={confirmLanguageChange}>
                  Switch to {languageNameMap[pendingLanguage]}
                </Button>
              </Flex>
            </Stack>
          </Box>
        </Box>
      )}
    </Stack>
  )
}
