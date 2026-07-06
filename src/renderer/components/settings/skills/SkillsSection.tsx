import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Paper,
  SimpleGrid,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import type { SkillInfo } from '@shared/types/skills'
import {
  IconBrandGithub,
  IconDots,
  IconFolderOpen,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWand,
} from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ActionMenu, { type ActionMenuItemProps } from '@/components/ActionMenu'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useSkillTranslation } from '@/hooks/useSkillTranslation'
import { skillsController } from '@/packages/skills/controller'
import { toastError } from '@/packages/toast'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import CreateSkillModal from './CreateSkillModal'
import GitHubInstallModal, { type DetectedSkill } from './GitHubInstallModal'
import ScriptsReviewModal from './ScriptsReviewModal'
import SkillsSpotlight, { skillsSpotlight } from './SkillsSpotlight'

// FABLE §7.6: skills pulled from GitHub/marketplace that ship executable
// scripts need an explicit script review before they can be enabled.
export function requiresScriptReview(skill: SkillInfo): boolean {
  return !!skill.scriptNames?.length && (skill.source?.type === 'github' || skill.source?.type === 'marketplace')
}

const SkillCard: FC<{
  skill: SkillInfo
  translatedName?: string
  enabled: boolean
  onToggle: (name: string, enabled: boolean) => void
  actionItems?: ActionMenuItemProps[]
}> = ({ skill, translatedName, enabled, onToggle, actionItems }) => {
  const [menuOpened, setMenuOpened] = useState(false)

  return (
    <Paper
      shadow="xs"
      radius="md"
      withBorder
      p="sm"
      className="transition-all duration-150 hover:shadow-md"
      style={{ opacity: enabled ? 1 : 0.72 }}
    >
      <Flex justify="space-between" align="flex-start" gap={8}>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} lineClamp={1}>
            {skill.name}
          </Text>
          {translatedName && (
            <Text size="xs" c="workspaice-tertiary" lineClamp={1} mt={2}>
              {translatedName}
            </Text>
          )}
        </Box>

        <Flex align="center" gap={4} style={{ flexShrink: 0 }}>
          {actionItems && actionItems.length > 0 && (
            <ActionMenu
              type="desktop"
              items={actionItems}
              position="bottom-start"
              opened={menuOpened}
              onChange={(opened) => setMenuOpened(opened)}
            >
              <ActionIcon
                variant="transparent"
                size="sm"
                color="workspaice-tertiary"
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                }}
              >
                <ScalableIcon icon={IconDots} size={14} />
              </ActionIcon>
            </ActionMenu>
          )}
          <Switch size="xs" checked={enabled} onChange={(e) => onToggle(skill.name, e.currentTarget.checked)} />
        </Flex>
      </Flex>

      <Tooltip
        label={skill.description}
        multiline
        withArrow
        w={420}
        openDelay={400}
        events={{ hover: true, focus: true, touch: true }}
      >
        <Text size="xs" mt={8} c="workspaice-tertiary" lineClamp={2} className="cursor-help leading-relaxed">
          {skill.description}
        </Text>
      </Tooltip>

      {(skill.bodyTokenEstimate != null || skill.source?.repo) && (
        <Flex mt={8} gap={6} wrap="wrap">
          {skill.bodyTokenEstimate != null && (
            <Badge size="xs" variant="light" color="workspaice-brand" radius="sm">
              ~{skill.bodyTokenEstimate.toLocaleString()} tokens
            </Badge>
          )}
          {skill.source?.repo && (
            <Badge size="xs" variant="light" color="gray" radius="sm">
              {skill.source.repo}
            </Badge>
          )}
        </Flex>
      )}
    </Paper>
  )
}

const SectionHeader: FC<{
  title: string
  count?: number
  right?: React.ReactNode
  className?: string
}> = ({ title, count, right, className }) => (
  <Flex justify="space-between" align="center" className={className}>
    <Flex align="center" gap={8}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      {count != null && (
        <Badge size="xs" variant="light" color="gray" radius="sm">
          {count}
        </Badge>
      )}
    </Flex>
    {right && (
      <Flex align="center" gap="xs">
        {right}
      </Flex>
    )}
  </Flex>
)

const EmptyState: FC<{ onAddClick: () => void; onOpenFolder: () => void }> = ({ onAddClick, onOpenFolder }) => {
  const { t } = useTranslation()

  return (
    <Paper radius="md" p="xl" className="border border-dashed border-workspaice-border-primary">
      <Flex direction="column" align="center" gap={12} py="md">
        <Box className="rounded-full p-3 bg-workspaice-background-gray-secondary">
          <ScalableIcon icon={IconWand} size={24} className="text-workspaice-tint-tertiary" />
        </Box>
        <Box className="text-center">
          <Text size="sm" fw={500}>
            {t('No custom skills yet')}
          </Text>
          <Text size="xs" c="workspaice-tertiary" mt={4}>
            {t('Add skills from the marketplace or install from a GitHub repository.')}
          </Text>
        </Box>
        <Flex gap="xs" mt={4}>
          <Button
            variant="light"
            size="xs"
            leftSection={<ScalableIcon icon={IconSearch} size={14} />}
            onClick={onAddClick}
          >
            {t('Browse Skills')}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<ScalableIcon icon={IconFolderOpen} size={14} />}
            onClick={onOpenFolder}
          >
            {t('Open Skills Folder')}
          </Button>
        </Flex>
      </Flex>
    </Paper>
  )
}

export const SkillsSection: FC = () => {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [detectedSkills, setDetectedSkills] = useState<DetectedSkill[]>([])
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [repoInfo, setRepoInfo] = useState({ owner: '', repo: '' })
  const [showGithubInput, setShowGithubInput] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [scriptsReview, setScriptsReview] = useState<{ skillName: string; scriptNames: string[] } | null>(null)
  const skillSettings = useSettingsStore((state) => state.skills)
  const { translatedSkills, getTranslatedName, isTranslating, translationEnabled, toggleTranslation } =
    useSkillTranslation(skills)

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const discovered = await skillsController.discoverSkills()
      setSkills(discovered)
    } catch (err) {
      console.error('Failed to discover skills:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSkills()
  }, [fetchSkills])

  const originalUserSkillByPath = useMemo(() => {
    return new Map(skills.filter((skill) => !skill.isBuiltin).map((skill) => [skill.path, skill]))
  }, [skills])

  const userSkills = translatedSkills.filter((skill) => !skill.isBuiltin)

  const getOriginalUserSkill = useCallback(
    (skill: SkillInfo) => {
      return originalUserSkillByPath.get(skill.path) ?? skill
    },
    [originalUserSkillByPath]
  )

  const setSkillEnabled = useCallback((name: string, enabled: boolean) => {
    settingsStore.setState((state) => {
      const current = state.skills.enabledSkillNames
      if (enabled) {
        if (current.includes(name)) return state
        return { skills: { ...state.skills, enabledSkillNames: [...current, name] } }
      }
      return { skills: { ...state.skills, enabledSkillNames: current.filter((n) => n !== name) } }
    })
  }, [])

  const handleUserToggle = useCallback(
    (skill: SkillInfo, enabled: boolean) => {
      if (enabled && requiresScriptReview(skill)) {
        setScriptsReview({ skillName: skill.name, scriptNames: skill.scriptNames ?? [] })
        return
      }
      setSkillEnabled(skill.name, enabled)
    },
    [setSkillEnabled]
  )

  const handleSkillCreated = useCallback(
    (createdName: string) => {
      settingsStore.setState((state) => {
        const current = state.skills.enabledSkillNames
        if (current.includes(createdName)) return state
        return { skills: { ...state.skills, enabledSkillNames: [...current, createdName] } }
      })
      void fetchSkills()
    },
    [fetchSkills]
  )

  const handleOpenFolder = useCallback(async () => {
    try {
      await skillsController.openSkillsDirectory()
    } catch (err) {
      console.error('Failed to open skills directory:', err)
    }
  }, [])

  const parseGitHubRepo = useCallback((url: string): { owner: string; repo: string } | null => {
    const trimmed = url.trim()
    const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/i)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }, [])

  const handleScanRepo = useCallback(async () => {
    const parsed = parseGitHubRepo(githubUrl)
    if (!parsed) {
      toastError(t('Please enter a valid GitHub repository URL'))
      return
    }

    setScanning(true)
    try {
      const discovered = await skillsController.scanRepo(parsed.owner, parsed.repo)
      setDetectedSkills(discovered)
      setRepoInfo(parsed)

      if (!discovered.length) {
        toastError(t('No skills found in this repository'))
        return
      }

      setInstallModalOpen(true)
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('Failed to scan repository'))
    } finally {
      setScanning(false)
    }
  }, [githubUrl, parseGitHubRepo, t])

  const handleDeleteSkill = useCallback(
    async (name: string) => {
      try {
        const result = await skillsController.deleteSkill(name)
        if (!result.success) {
          toastError(result.error ?? t('Failed to delete skill'))
          return
        }

        settingsStore.setState((state) => ({
          skills: {
            ...state.skills,
            enabledSkillNames: state.skills.enabledSkillNames.filter((skillName) => skillName !== name),
          },
        }))

        toast.success(t('Skill deleted'))
        await fetchSkills()
      } catch (error) {
        toastError(error instanceof Error ? error.message : t('Failed to delete skill'))
      }
    },
    [fetchSkills, t]
  )

  const handleCheckUpdate = useCallback(
    async (name: string) => {
      try {
        const result = await skillsController.checkForUpdate(name)
        if (result.error) {
          toastError(result.error)
          return
        }

        if (result.hasUpdate) {
          toast.success(t('Update available for {{name}}', { name }))
          return
        }

        toast.info(t('No updates for {{name}}', { name }))
      } catch (error) {
        toastError(error instanceof Error ? error.message : t('Failed to check for updates'))
      }
    },
    [t]
  )

  return (
    <>
      <Flex justify="space-between" align="center" mb="lg" wrap="wrap" gap="xs">
        <Flex align="center" gap="xs">
          <Button
            variant="light"
            size="xs"
            leftSection={<ScalableIcon icon={IconWand} size={14} />}
            data-testid="new-skill-button"
            onClick={() => setCreateModalOpen(true)}
          >
            {t('New Skill')}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            leftSection={<ScalableIcon icon={IconPlus} size={14} />}
            onClick={skillsSpotlight.open}
          >
            {t('Add Skills')}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            leftSection={<ScalableIcon icon={IconBrandGithub} size={14} />}
            onClick={() => setShowGithubInput((v) => !v)}
          >
            {t('Install from GitHub')}
          </Button>
        </Flex>

        <Flex align="center" gap="xs">
          {isTranslating && <Loader size="xs" />}
          <Switch size="xs" label={t('Translate')} checked={translationEnabled} onChange={() => toggleTranslation()} />
        </Flex>
      </Flex>

      {showGithubInput && (
        <Paper radius="md" withBorder p="sm" mb="lg" className="bg-workspaice-background-gray-secondary/30">
          <Flex align="center" gap={8} mb={8}>
            <ScalableIcon icon={IconBrandGithub} size={16} className="text-workspaice-tint-tertiary" />
            <Text size="xs" fw={500}>
              {t('Install from GitHub Repository')}
            </Text>
          </Flex>
          <Flex gap="xs">
            <TextInput
              size="xs"
              value={githubUrl}
              placeholder="https://github.com/owner/repo"
              onChange={(event) => setGithubUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleScanRepo()
                }
              }}
              flex={1}
            />
            <Button size="xs" loading={scanning} onClick={() => void handleScanRepo()}>
              {t('Scan')}
            </Button>
          </Flex>
        </Paper>
      )}

      <SectionHeader
        title={t('User Skills')}
        count={userSkills.length}
        className="mb-3"
        right={
          <>
            <Tooltip label={t('Open Skills Folder')} withArrow openDelay={300}>
              <ActionIcon variant="subtle" size="sm" color="gray" onClick={() => void handleOpenFolder()}>
                <ScalableIcon icon={IconFolderOpen} size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
              loading={loading}
              onClick={fetchSkills}
            >
              {t('Refresh')}
            </Button>
          </>
        }
      />

      {userSkills.length === 0 ? (
        <EmptyState onAddClick={skillsSpotlight.open} onOpenFolder={() => void handleOpenFolder()} />
      ) : (
        <SimpleGrid type="container" cols={{ base: 1, '450px': 2, '800px': 3, '1200px': 4 }}>
          {userSkills.map((skill) => {
            const originalSkill = getOriginalUserSkill(skill)
            const actionItems: ActionMenuItemProps[] = [
              {
                text: t('Check Update'),
                icon: IconRefresh,
                onClick: () => {
                  void handleCheckUpdate(originalSkill.name)
                },
              },
              {
                text: t('Delete'),
                icon: IconTrash,
                color: 'red',
                doubleCheck: {
                  text: String(t('Confirm Delete?')),
                  color: 'red',
                },
                onClick: () => {
                  void handleDeleteSkill(originalSkill.name)
                },
              },
            ]

            return (
              <SkillCard
                key={originalSkill.path}
                skill={skill}
                translatedName={getTranslatedName(skill)}
                enabled={skillSettings.enabledSkillNames.includes(originalSkill.name)}
                onToggle={(_name, enabled) => handleUserToggle(originalSkill, enabled)}
                actionItems={actionItems}
              />
            )
          })}
        </SimpleGrid>
      )}

      <CreateSkillModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleSkillCreated}
      />

      <GitHubInstallModal
        opened={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        skills={detectedSkills}
        repoOwner={repoInfo.owner}
        repoName={repoInfo.repo}
        onInstallComplete={() => {
          void fetchSkills()
        }}
      />

      <SkillsSpotlight
        installedSkillNames={skills.filter((s) => !s.isBuiltin).map((s) => s.name)}
        onInstallComplete={fetchSkills}
      />

      <ScriptsReviewModal
        opened={scriptsReview !== null}
        skillName={scriptsReview?.skillName ?? ''}
        scriptNames={scriptsReview?.scriptNames ?? []}
        onConfirm={() => {
          if (scriptsReview) {
            setSkillEnabled(scriptsReview.skillName, true)
          }
          setScriptsReview(null)
        }}
        onClose={() => setScriptsReview(null)}
      />
    </>
  )
}
