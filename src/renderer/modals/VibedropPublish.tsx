import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Button, CopyButton, Flex, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { IconCheck, IconCopy, IconExternalLink, IconWorldUpload } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { navigateToSettings } from '@/modals/settings-navigation'
import { issueVibedropKey } from '@/packages/remote'
import {
  clearCachedVibedropKey,
  getCachedVibedropKey,
  getSessionVibedropPublications,
  getStoredSlug,
  publishToVibedrop,
  recordSessionVibedropPublication,
  setCachedVibedropKey,
  setStoredSlug,
  VIBEDROP_MANAGE_URL,
  VibedropAuthError,
  VibedropEmailRequiredError,
  type VibedropSite,
  VibedropSlugNotOwnedError,
  type VibedropVisibility,
} from '@/packages/vibedrop'
import { useAuthInfoStore } from '@/stores/authInfoStore'

export interface VibedropPublishProps {
  html: string
  // Stable code-block id; used to reuse the published slug on re-publish.
  uniqueId?: string
  sessionId?: string
}

type Stage = 'login_required' | 'form' | 'publishing' | 'email_required' | 'success' | 'error'
type PublishMode = 'new' | 'update'

const ManageSitesHint = () => (
  <Text size="xs" c="dimmed">
    <Trans
      i18nKey="Manage your published pages at <ManageLink>app.vibedrop.cc</ManageLink> — sign in with your Chatbox email."
      components={{
        ManageLink: (
          <a
            href={VIBEDROP_MANAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-600 transition-colors"
          />
        ),
      }}
    />
  </Text>
)

const VibedropPublish = NiceModal.create(({ html, uniqueId, sessionId }: VibedropPublishProps) => {
  const isSmallScreen = useIsSmallScreen()
  const modal = useModal()
  const { t } = useTranslation()

  const isLoggedIn = useAuthInfoStore((state) => Boolean(state.accessToken && state.refreshToken))
  const publicationTargets = useMemo(() => {
    const storedSlug = getStoredSlug(uniqueId)
    const publications = getSessionVibedropPublications(sessionId)
    if (!storedSlug || publications.some((publication) => publication.slug === storedSlug)) {
      return publications
    }
    return [
      {
        slug: storedSlug,
        url: '',
        visibility: 'unlisted' as const,
        uniqueId,
        updatedAt: 0,
      },
      ...publications,
    ]
  }, [sessionId, uniqueId])
  const storedSlug = getStoredSlug(uniqueId)
  const initialTargetSlug = storedSlug || publicationTargets[0]?.slug || ''
  const initialTarget = publicationTargets.find((publication) => publication.slug === initialTargetSlug)
  const [stage, setStage] = useState<Stage>(isLoggedIn ? 'form' : 'login_required')
  const [publishMode, setPublishMode] = useState<PublishMode>(storedSlug ? 'update' : 'new')
  const [selectedSlug, setSelectedSlug] = useState(initialTargetSlug)
  const [visibility, setVisibility] = useState<VibedropVisibility>(
    storedSlug ? initialTarget?.visibility || 'unlisted' : 'unlisted'
  )
  const [url, setUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const getPublishErrorMessage = useCallback(
    (error: unknown): string => {
      const message = (error as Error)?.message
      if (message === 'HTML content is empty, nothing to publish.') {
        return t('HTML content is empty, nothing to publish.')
      }
      if (message === 'VibeDrop authorization failed') {
        return t('VibeDrop authorization failed')
      }
      if (error instanceof VibedropSlugNotOwnedError) {
        return t('This page can no longer be updated. Publish it as a new page instead.')
      }
      if (message?.startsWith('Failed to publish to VibeDrop (status ')) {
        return t('Failed to publish to VibeDrop. Please try again later.')
      }
      return message || t('Publish failed') || 'Publish failed'
    },
    [t]
  )

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const onExitTransitionEnd = () => {
    modal.resolveHide()
    if (!modal.keepMounted) {
      modal.remove()
    }
  }

  const goLogin = () => {
    navigateToSettings('/provider/chatbox-ai')
    onClose()
  }

  useEffect(() => {
    if (isLoggedIn && stage === 'login_required') {
      setStage('form')
    }
  }, [isLoggedIn, stage])

  const changePublishMode = (value: string) => {
    const nextMode = value as PublishMode
    setPublishMode(nextMode)
    if (nextMode === 'new') {
      setVisibility('unlisted')
      return
    }
    const target = publicationTargets.find((publication) => publication.slug === selectedSlug)
    if (target) {
      setVisibility(target.visibility)
    }
  }

  const changePublicationTarget = (value: string | null) => {
    const slug = value || ''
    setSelectedSlug(slug)
    const target = publicationTargets.find((publication) => publication.slug === slug)
    if (target) {
      setVisibility(target.visibility)
    }
  }

  // Obtain a publish key: cached first, otherwise issue one via chatbox-backend.
  const obtainKey = useCallback(async (forceReissue = false): Promise<string> => {
    if (!forceReissue) {
      const cached = getCachedVibedropKey()
      if (cached) return cached
    }
    const { vdKey } = await issueVibedropKey()
    setCachedVibedropKey(vdKey)
    return vdKey
  }, [])

  const publishWithRetry = useCallback(async (): Promise<VibedropSite> => {
    let vdKey = await obtainKey()
    const slug = publishMode === 'update' ? selectedSlug || null : null
    try {
      return await publishToVibedrop({ html, vdKey, visibility, slug })
    } catch (e) {
      if (e instanceof VibedropAuthError) {
        // Key revoked/invalid — clear cache, re-issue, retry once.
        clearCachedVibedropKey()
        vdKey = await obtainKey(true)
        return await publishToVibedrop({ html, vdKey, visibility, slug })
      }
      throw e
    }
  }, [html, publishMode, selectedSlug, visibility, obtainKey])

  const publish = useCallback(async () => {
    setStage('publishing')
    try {
      const site = await publishWithRetry()
      setStoredSlug(uniqueId, site.slug)
      recordSessionVibedropPublication(sessionId, uniqueId, site)
      setUrl(site.url)
      setStage('success')
    } catch (e) {
      if (e instanceof VibedropEmailRequiredError) {
        setStage('email_required')
        return
      }
      if (e instanceof VibedropSlugNotOwnedError) {
        setPublishMode('new')
        setVisibility('unlisted')
      }
      setErrorMessage(getPublishErrorMessage(e))
      setStage('error')
    }
  }, [sessionId, uniqueId, publishWithRetry, getPublishErrorMessage])

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={onClose}
      onExitTransitionEnd={onExitTransitionEnd}
      centered
      title={t('Publish to VibeDrop')}
    >
      <Stack>
        {stage === 'login_required' && (
          <>
            <Text size="sm" c="dimmed">
              {t('Sign in to your Chatbox account to publish and manage your pages.')}
            </Text>
            <AdaptiveModal.Actions>
              <Button variant="default" onClick={onClose}>
                {t('Close')}
              </Button>
              <Button onClick={goLogin} c="white">
                {t('Sign in')}
              </Button>
            </AdaptiveModal.Actions>
          </>
        )}

        {(stage === 'form' || stage === 'publishing') && (
          <>
            <Text size="sm" c="dimmed">
              {t('Your HTML page will be published to VibeDrop. Choose who can access it.')}
            </Text>
            {publicationTargets.length > 0 && (
              <Stack gap="xs">
                <SegmentedControl
                  fullWidth
                  value={publishMode}
                  onChange={changePublishMode}
                  disabled={stage === 'publishing'}
                  data={[
                    { label: t('New page'), value: 'new' },
                    { label: t('Update page'), value: 'update' },
                  ]}
                />
                {publishMode === 'update' && (
                  <>
                    <AdaptiveSelect
                      label={t('Page to update')}
                      value={selectedSlug}
                      onChange={changePublicationTarget}
                      disabled={stage === 'publishing'}
                      data={publicationTargets.map((publication) => ({
                        label: publication.url || publication.slug,
                        value: publication.slug,
                      }))}
                    />
                    <Text size="xs" c="dimmed">
                      {t('The selected page keeps the same URL and its content will be replaced.')}
                    </Text>
                  </>
                )}
              </Stack>
            )}
            <SegmentedControl
              fullWidth
              value={visibility}
              onChange={(v) => setVisibility(v as VibedropVisibility)}
              disabled={stage === 'publishing'}
              data={[
                { label: t('Link only'), value: 'unlisted' },
                { label: t('Public'), value: 'public' },
              ]}
            />
            <Text size="xs" c="dimmed">
              {visibility === 'public'
                ? t('Anyone can find this page in the VibeDrop explore gallery.')
                : t('Only people with the link can open this page.')}
            </Text>
            <ManageSitesHint />
            <AdaptiveModal.Actions>
              <Button variant="default" onClick={onClose} disabled={stage === 'publishing'}>
                {t('Close')}
              </Button>
              <Button
                onClick={publish}
                loading={stage === 'publishing'}
                disabled={publishMode === 'update' && !selectedSlug}
                leftSection={<ScalableIcon icon={IconWorldUpload} size={16} />}
                c="white"
              >
                {t('Publish')}
              </Button>
            </AdaptiveModal.Actions>
          </>
        )}

        {stage === 'email_required' && (
          <>
            <Text size="sm" c="dimmed">
              {t('Publishing requires an email on your Chatbox account. Please add one and try again.')}
            </Text>
            <AdaptiveModal.Actions>
              <Button variant="default" onClick={onClose}>
                {t('Close')}
              </Button>
            </AdaptiveModal.Actions>
          </>
        )}

        {stage === 'error' && (
          <>
            <Text size="sm" c="red">
              {errorMessage}
            </Text>
            <AdaptiveModal.Actions>
              <Button variant="default" onClick={onClose}>
                {t('Close')}
              </Button>
              <Button onClick={() => setStage('form')} c="white">
                {t('Try Again')}
              </Button>
            </AdaptiveModal.Actions>
          </>
        )}

        {stage === 'success' && (
          <>
            <Text size="sm" c="dimmed">
              {t('Your page is published. You can access it via the link below.')}
            </Text>
            <Flex gap="xs" className={isSmallScreen ? 'flex-col' : ''}>
              <TextInput
                value={url}
                readOnly
                className="flex-1"
                rightSection={
                  <CopyButton value={url} timeout={2000}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? t('Copied') : t('Copy')} withArrow position="right">
                        <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </CopyButton>
                }
              />
              <Button
                component="a"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                leftSection={<ScalableIcon icon={IconExternalLink} size={16} />}
                c="white"
              >
                {t('Open')}
              </Button>
            </Flex>
            <ManageSitesHint />
            {!isSmallScreen && (
              <AdaptiveModal.Actions>
                <Button variant="default" onClick={onClose}>
                  {t('Close')}
                </Button>
              </AdaptiveModal.Actions>
            )}
          </>
        )}
      </Stack>
    </AdaptiveModal>
  )
})

export default VibedropPublish
