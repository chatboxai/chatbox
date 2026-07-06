import { Accordion, Alert, Button, Code, Flex, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconFileCode } from '@tabler/icons-react'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { skillsController } from '@/packages/skills/controller'

type ScriptPreview = {
  state: 'loading' | 'loaded' | 'error'
  content?: string
  truncated?: boolean
  error?: string
}

interface ScriptsReviewModalProps {
  opened: boolean
  skillName: string
  scriptNames: string[]
  onConfirm: () => void
  onClose: () => void
}

// FABLE §7.6: shown before enabling an installed (GitHub/marketplace) skill
// that ships executable scripts, so the user sees what could run locally.
export const ScriptsReviewModal: FC<ScriptsReviewModalProps> = ({
  opened,
  skillName,
  scriptNames,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation()
  const [previews, setPreviews] = useState<Record<string, ScriptPreview>>({})

  useEffect(() => {
    if (!opened) {
      setPreviews({})
    }
  }, [opened])

  const loadPreview = (scriptName: string) => {
    if (previews[scriptName]) return
    setPreviews((prev) => ({ ...prev, [scriptName]: { state: 'loading' } }))
    skillsController
      .readScript(skillName, scriptName)
      .then((result) => {
        setPreviews((prev) => ({
          ...prev,
          [scriptName]: result.success
            ? { state: 'loaded', content: result.content, truncated: result.truncated }
            : { state: 'error', error: result.error },
        }))
      })
      .catch((error: unknown) => {
        setPreviews((prev) => ({
          ...prev,
          [scriptName]: { state: 'error', error: error instanceof Error ? error.message : String(error) },
        }))
      })
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('Review scripts in "{{name}}"', { name: skillName })}
      centered
      size="lg"
      overlayProps={{ backgroundOpacity: 0.35, blur: 7 }}
    >
      <Stack gap="sm">
        <Alert
          color="orange"
          variant="light"
          icon={<ScalableIcon icon={IconAlertTriangle} size={16} />}
          title={t('This skill contains executable scripts')}
        >
          <Text size="xs">
            {t(
              'Scripts can run on your computer when the skill is used in a chat. Review them before enabling the skill.'
            )}
          </Text>
        </Alert>

        <Accordion variant="separated" radius="md" onChange={(value) => value && loadPreview(value)}>
          {scriptNames.map((scriptName) => {
            const preview = previews[scriptName]
            return (
              <Accordion.Item key={scriptName} value={scriptName}>
                <Accordion.Control icon={<ScalableIcon icon={IconFileCode} size={14} />}>
                  <Text size="sm" ff="monospace">
                    {scriptName}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {!preview || preview.state === 'loading' ? (
                    <Flex justify="center" py="sm">
                      <Loader size="xs" />
                    </Flex>
                  ) : preview.state === 'error' ? (
                    <Text size="xs" c="workspaice-error">
                      {preview.error ?? t('Failed to load script')}
                    </Text>
                  ) : (
                    <>
                      <ScrollArea.Autosize mah={260}>
                        <Code block>{preview.content}</Code>
                      </ScrollArea.Autosize>
                      {preview.truncated && (
                        <Text size="xs" c="workspaice-tertiary" mt={4}>
                          {t('Preview truncated — open the skills folder to see the full file.')}
                        </Text>
                      )}
                    </>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>

        <Flex justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button color="orange" onClick={onConfirm}>
            {t('Enable Skill')}
          </Button>
        </Flex>
      </Stack>
    </Modal>
  )
}

export default ScriptsReviewModal
