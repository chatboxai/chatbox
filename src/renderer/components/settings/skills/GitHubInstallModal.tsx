import { Badge, Button, Checkbox, Flex, Modal, Paper, Stack, Text } from '@mantine/core'
import { IconCheck, IconX } from '@tabler/icons-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { skillsController } from '@/packages/skills/controller'
import { settingsStore } from '@/stores/settingsStore'

export interface DetectedSkill {
  name: string
  path: string
  description?: string
}

interface GitHubInstallModalProps {
  opened: boolean
  onClose: () => void
  skills: DetectedSkill[]
  repoOwner: string
  repoName: string
  onInstallComplete: () => void
}

type InstallStatus = {
  state: 'idle' | 'loading' | 'success' | 'error'
  error?: string
}

export const GitHubInstallModal: FC<GitHubInstallModalProps> = ({
  opened,
  onClose,
  skills,
  repoOwner,
  repoName,
  onInstallComplete,
}) => {
  const { t } = useTranslation()
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [installStatuses, setInstallStatuses] = useState<Record<string, InstallStatus>>({})
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!opened) {
      setSelectedPaths([])
      setInstallStatuses({})
      setInstalling(false)
      return
    }

    setSelectedPaths(skills.map((skill) => skill.path))
    setInstallStatuses(
      skills.reduce<Record<string, InstallStatus>>((acc, skill) => {
        acc[skill.path] = { state: 'idle' }
        return acc
      }, {})
    )
  }, [opened, skills])

  const selectedSkills = useMemo(() => {
    return skills.filter((skill) => selectedPaths.includes(skill.path))
  }, [selectedPaths, skills])

  const handleInstallSelected = async () => {
    if (!selectedSkills.length) return

    setInstalling(true)
    const installFailedText = String(t('Install failed'))
    let anyFailed = false

    for (const skill of selectedSkills) {
      setInstallStatuses((prev) => ({
        ...prev,
        [skill.path]: { state: 'loading' },
      }))

      try {
        const result = await skillsController.installSkill(repoOwner, repoName, skill.path)

        if (result.success) {
          // §7.6: script-bearing skills stay disabled until the user reviews
          // their scripts (the enable toggle opens the review modal).
          if (result.scriptNames?.length) {
            toast.info(
              t('"{{name}}" contains scripts — review them when enabling the skill', { name: result.skillName })
            )
          } else {
            settingsStore.setState((state) => {
              if (state.skills.enabledSkillNames.includes(result.skillName)) {
                return state
              }
              return {
                skills: {
                  ...state.skills,
                  enabledSkillNames: [...state.skills.enabledSkillNames, result.skillName],
                },
              }
            })
          }
        }

        setInstallStatuses((prev) => ({
          ...prev,
          [skill.path]: result.success
            ? { state: 'success' }
            : { state: 'error', error: result.error ?? installFailedText },
        }))
        if (!result.success) {
          anyFailed = true
        }
      } catch (error) {
        anyFailed = true
        setInstallStatuses((prev) => ({
          ...prev,
          [skill.path]: {
            state: 'error',
            error: error instanceof Error ? error.message : installFailedText,
          },
        }))
      }
    }

    setInstalling(false)
    onInstallComplete()
    if (!anyFailed) {
      onClose()
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('Install Skills from {{owner}}/{{repo}}', { owner: repoOwner, repo: repoName })}
      centered
      size="lg"
      overlayProps={{ backgroundOpacity: 0.35, blur: 7 }}
    >
      <Stack gap="sm">
        {skills.map((skill) => {
          const status = installStatuses[skill.path]?.state ?? 'idle'
          const statusError = installStatuses[skill.path]?.error

          return (
            <Paper key={skill.path} withBorder radius="md" p="sm">
              <Flex align="flex-start" justify="space-between" gap="sm">
                <Checkbox
                  checked={selectedPaths.includes(skill.path)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setSelectedPaths((prev) =>
                      checked ? [...prev, skill.path] : prev.filter((path) => path !== skill.path)
                    )
                  }}
                  label={
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {skill.name}
                      </Text>
                      {skill.description && (
                        <Text size="xs" c="workspaice-tertiary">
                          {skill.description}
                        </Text>
                      )}
                    </Stack>
                  }
                />
                {status === 'loading' && <Badge size="xs">{t('Installing')}</Badge>}
                {status === 'success' && (
                  <Badge size="xs" color="green" leftSection={<ScalableIcon icon={IconCheck} size={12} />}>
                    {t('Installed')}
                  </Badge>
                )}
                {status === 'error' && (
                  <Badge size="xs" color="red" leftSection={<ScalableIcon icon={IconX} size={12} />}>
                    {t('Failed')}
                  </Badge>
                )}
              </Flex>
              {statusError && (
                <Text size="xs" mt="xs" c="workspaice-error">
                  {statusError}
                </Text>
              )}
            </Paper>
          )
        })}

        <Flex justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose} disabled={installing}>
            {t('Cancel')}
          </Button>
          <Button loading={installing} onClick={handleInstallSelected} disabled={!selectedPaths.length}>
            {t('Install Selected')}
          </Button>
        </Flex>
      </Stack>
    </Modal>
  )
}

export default GitHubInstallModal
