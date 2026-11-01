import { ActionIcon, Badge, Box, Button, Flex, Loader, Switch, Text, TextInput } from '@mantine/core'
import { DEFAULT_ENABLED_BUILTIN_SKILL_NAMES, type SkillInfo } from '@shared/types/skills'
import {
  IconBrandGithub,
  IconDots,
  IconFolderOpen,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWand,
  IconX,
} from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ActionMenu, { type ActionMenuItemProps } from '@/components/ActionMenu'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingRow, SettingsListItem, SettingsSection } from '@/components/settings/SettingsLayout'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { useSkillTranslation } from '@/hooks/useSkillTranslation'
import { notifySkillsChanged, skillsController } from '@/packages/skills/controller'
import { toastError } from '@/packages/toast'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import GitHubInstallModal, { type DetectedSkill } from './GitHubInstallModal'
import SkillsSpotlight, { skillsSpotlight } from './SkillsSpotlight'

const SkillRow: FC<{
  skill: SkillInfo
  translatedName?: string
  enabled: boolean
  onToggle: (name: string, enabled: boolean) => void
  actionItems?: ActionMenuItemProps[]
}> = ({ skill, translatedName, enabled, onToggle, actionItems }) => {
  const { t } = useTranslation()
  const [menuOpened, setMenuOpened] = useState(false)
  const source =
    skill.source?.repo ?? (skill.source?.type && skill.source.type !== 'local' ? skill.source.type : undefined)

  return (
    <SettingRow
      label={<span className="block truncate">{skill.name}</span>}
      description={
        <Tooltip label={skill.description} multiline withArrow w={420} openDelay={400}>
          <span className="line-clamp-2 cursor-help">{skill.description}</span>
        </Tooltip>
      }
      status={
        (translatedName || source) && (
          <Flex align="center" gap={6} wrap="wrap" mt={2}>
            {translatedName && (
              <Text fz={12} lh="18px" c="chatbox-secondary" truncate>
                {translatedName}
              </Text>
            )}
            {source && (
              <Badge size="xs" variant="light" color="gray" radius="lg">
                {source}
              </Badge>
            )}
          </Flex>
        )
      }
      control={(fieldId) => (
        <Flex align="center" gap={4}>
          {actionItems && actionItems.length > 0 && (
            <ActionMenu
              type="desktop"
              items={actionItems}
              position="bottom-end"
              opened={menuOpened}
              onChange={(opened) => setMenuOpened(opened)}
            >
              <ActionIcon
                variant="subtle"
                size="md"
                color="chatbox-tertiary"
                aria-label={t('More')}
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                }}
              >
                <ScalableIcon icon={IconDots} size={16} />
              </ActionIcon>
            </ActionMenu>
          )}
          <Switch
            id={fieldId}
            size="md"
            aria-label={skill.name}
            checked={enabled}
            onChange={(e) => onToggle(skill.name, e.currentTarget.checked)}
          />
        </Flex>
      )}
    />
  )
}

const CountBadge: FC<{ count: number }> = ({ count }) => (
  <Badge size="sm" variant="light" color="chatbox-secondary">
    {count}
  </Badge>
)

const EmptyState: FC<{ onAddClick: () => void; onOpenFolder: () => void }> = ({ onAddClick, onOpenFolder }) => {
  const { t } = useTranslation()

  return (
    <SettingsListItem className="!flex-col !items-center !py-6 text-center">
      <Box className="rounded-full p-3 bg-chatbox-background-gray-secondary">
        <ScalableIcon icon={IconWand} size={24} className="text-chatbox-tint-tertiary" />
      </Box>
      <Box>
        <Text size="sm" fw={500}>
          {t('No custom skills yet')}
        </Text>
        <Text size="xs" c="chatbox-tertiary" mt={4}>
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
    </SettingsListItem>
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
  const [searchQuery, setSearchQuery] = useState('')
  const skillSettings = useSettingsStore((state) => state.skills)
  const { translatedSkills, getTranslatedName, isTranslating, translationEnabled, toggleTranslation } =
    useSkillTranslation(skills)

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const discovered = await skillsController.discoverSkills()
      const defaultEnabledBuiltinSkillNames = discovered
        .filter(
          (skill) =>
            skill.isBuiltin &&
            DEFAULT_ENABLED_BUILTIN_SKILL_NAMES.includes(
              skill.name as (typeof DEFAULT_ENABLED_BUILTIN_SKILL_NAMES)[number]
            )
        )
        .map((skill) => skill.name)
      const discoveredNames = new Set(discovered.map((skill) => skill.name))
      const currentSkillSettings = settingsStore.getState().skills
      const appliedDefaultBuiltinSkillNames =
        currentSkillSettings.appliedDefaultBuiltinSkillNames ??
        (currentSkillSettings.builtinDefaultsInitialized ? ['chatbox-product-info'] : [])
      const newlyAddedDefaultSkillNames = defaultEnabledBuiltinSkillNames.filter(
        (name) => !appliedDefaultBuiltinSkillNames.includes(name)
      )
      const enabledSkillNames = [
        ...new Set([
          ...currentSkillSettings.enabledSkillNames,
          ...(currentSkillSettings.builtinDefaultsInitialized
            ? newlyAddedDefaultSkillNames
            : defaultEnabledBuiltinSkillNames),
        ]),
      ]
      const enabledNameSet = new Set(enabledSkillNames)
      const originalIndexByName = new Map(discovered.map((skill, index) => [skill.name, index]))
      const sortedDiscovered = [...discovered].sort((a, b) => {
        const aEnabled = enabledNameSet.has(a.name)
        const bEnabled = enabledNameSet.has(b.name)
        if (aEnabled !== bEnabled) {
          return aEnabled ? -1 : 1
        }
        return (originalIndexByName.get(a.name) ?? 0) - (originalIndexByName.get(b.name) ?? 0)
      })
      setSkills(sortedDiscovered)
      settingsStore.setState((state) => {
        const appliedDefaultBuiltinSkillNames =
          state.skills.appliedDefaultBuiltinSkillNames ??
          (state.skills.builtinDefaultsInitialized ? ['chatbox-product-info'] : [])
        const newlyAddedDefaultSkillNames = defaultEnabledBuiltinSkillNames.filter(
          (name) => !appliedDefaultBuiltinSkillNames.includes(name)
        )
        const enabledSkillNames = (
          state.skills.builtinDefaultsInitialized
            ? [...new Set([...state.skills.enabledSkillNames, ...newlyAddedDefaultSkillNames])]
            : [...new Set([...state.skills.enabledSkillNames, ...defaultEnabledBuiltinSkillNames])]
        ).filter((name) => discoveredNames.has(name))
        const nextAppliedDefaultBuiltinSkillNames = [
          ...new Set([...appliedDefaultBuiltinSkillNames, ...defaultEnabledBuiltinSkillNames]),
        ]
        if (
          state.skills.builtinDefaultsInitialized &&
          enabledSkillNames.length === state.skills.enabledSkillNames.length &&
          enabledSkillNames.every((name, index) => name === state.skills.enabledSkillNames[index]) &&
          nextAppliedDefaultBuiltinSkillNames.length === appliedDefaultBuiltinSkillNames.length &&
          nextAppliedDefaultBuiltinSkillNames.every((name, index) => name === appliedDefaultBuiltinSkillNames[index])
        ) {
          return state
        }
        return {
          skills: {
            ...state.skills,
            enabledSkillNames,
            builtinDefaultsInitialized: true,
            appliedDefaultBuiltinSkillNames: nextAppliedDefaultBuiltinSkillNames,
          },
        }
      })
      notifySkillsChanged()
    } catch (err) {
      console.error('Failed to discover skills:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const originalSkillByPath = useMemo(() => {
    return new Map(skills.filter((skill) => !skill.isBuiltin).map((skill) => [skill.path, skill]))
  }, [skills])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const matchesQuery = useCallback(
    (skill: SkillInfo) => {
      if (!normalizedQuery) return true
      return [skill.name, skill.description, getTranslatedName(skill), skill.source?.repo]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(normalizedQuery))
    },
    [normalizedQuery, getTranslatedName]
  )

  const filteredSkills = useMemo(() => translatedSkills.filter(matchesQuery), [translatedSkills, matchesQuery])

  const builtinSkills = filteredSkills.filter((skill) => skill.isBuiltin)
  const userSkills = filteredSkills.filter(
    (skill) => !skill.isBuiltin && skill.source?.type !== 'claude-code' && skill.source?.type !== 'agents'
  )
  const claudeCodeSkills = filteredSkills.filter((skill) => skill.source?.type === 'claude-code')
  const agentSkills = filteredSkills.filter((skill) => skill.source?.type === 'agents')

  const getOriginalUserSkill = useCallback(
    (skill: SkillInfo) => {
      return originalSkillByPath.get(skill.path) ?? skill
    },
    [originalSkillByPath]
  )

  const handleUserToggle = useCallback((name: string, enabled: boolean) => {
    settingsStore.setState((state) => {
      const current = state.skills.enabledSkillNames
      if (enabled) {
        if (current.includes(name)) return state
        return { skills: { ...state.skills, enabledSkillNames: [...current, name] } }
      }
      return { skills: { ...state.skills, enabledSkillNames: current.filter((n) => n !== name) } }
    })
  }, [])

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

  const renderLocalSkills = (list: SkillInfo[]) =>
    list.map((skill) => {
      const originalSkill = getOriginalUserSkill(skill)
      return (
        <SkillRow
          key={originalSkill.path}
          skill={skill}
          translatedName={getTranslatedName(skill)}
          enabled={skillSettings.enabledSkillNames.includes(originalSkill.name)}
          onToggle={(name, enabled) => handleUserToggle(originalSkill.name || name, enabled)}
        />
      )
    })

  return (
    <>
      <Flex justify="space-between" align="center" wrap="wrap" gap="xs">
        <Flex align="center" gap="xs">
          <Button
            variant="light"
            size="xs"
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
        <SettingsSection>
          <SettingRow
            label={t('Install from GitHub Repository')}
            controlLayout="block"
            control={(fieldId) => (
              <Flex gap="xs">
                <TextInput
                  id={fieldId}
                  size="sm"
                  value={githubUrl}
                  aria-label={t('Install from GitHub Repository') ?? undefined}
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
                <Button size="sm" loading={scanning} onClick={() => void handleScanRepo()}>
                  {t('Scan')}
                </Button>
              </Flex>
            )}
          />
        </SettingsSection>
      )}

      {skills.length > 0 && (
        <TextInput
          size="sm"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={String(t('Search skills...'))}
          leftSection={<ScalableIcon icon={IconSearch} size={14} />}
          rightSection={
            searchQuery ? (
              <ActionIcon variant="subtle" size="sm" color="gray" onClick={() => setSearchQuery('')}>
                <ScalableIcon icon={IconX} size={14} />
              </ActionIcon>
            ) : null
          }
        />
      )}

      {builtinSkills.length > 0 && (
        <SettingsSection title={t('Built-in Skills')} action={<CountBadge count={builtinSkills.length} />}>
          {builtinSkills.map((skill) => (
            <SkillRow
              key={skill.path}
              skill={skill}
              translatedName={getTranslatedName(skill)}
              enabled={skillSettings.enabledSkillNames.includes(skill.name)}
              onToggle={handleUserToggle}
            />
          ))}
        </SettingsSection>
      )}

      <SettingsSection
        title={t('Installed Skills')}
        action={
          <Flex align="center" gap="xs">
            <CountBadge count={userSkills.length} />
            <Tooltip label={t('Open Skills Folder')} withArrow openDelay={300}>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                aria-label={t('Open Skills Folder') ?? undefined}
                onClick={() => void handleOpenFolder()}
              >
                <ScalableIcon icon={IconFolderOpen} size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="subtle"
              color="chatbox-gray"
              size="compact-sm"
              leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
              loading={loading}
              onClick={fetchSkills}
            >
              {t('Refresh')}
            </Button>
          </Flex>
        }
      >
        {userSkills.length === 0 ? (
          normalizedQuery ? (
            <SettingsListItem>
              <Text fz={14} c="chatbox-tertiary">
                {t('No skills match "{{query}}"', { query: searchQuery.trim() })}
              </Text>
            </SettingsListItem>
          ) : (
            <EmptyState onAddClick={skillsSpotlight.open} onOpenFolder={() => void handleOpenFolder()} />
          )
        ) : (
          userSkills.map((skill) => {
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
              <SkillRow
                key={originalSkill.path}
                skill={skill}
                translatedName={getTranslatedName(skill)}
                enabled={skillSettings.enabledSkillNames.includes(originalSkill.name)}
                onToggle={(name, enabled) => handleUserToggle(originalSkill.name || name, enabled)}
                actionItems={actionItems}
              />
            )
          })
        )}
      </SettingsSection>

      {claudeCodeSkills.length > 0 && (
        <SettingsSection
          title={t('Claude Code Skills')}
          description={<span className="font-mono">~/.claude/skills</span>}
          action={<CountBadge count={claudeCodeSkills.length} />}
        >
          {renderLocalSkills(claudeCodeSkills)}
        </SettingsSection>
      )}

      {agentSkills.length > 0 && (
        <SettingsSection
          title={t('Local Agent Skills')}
          description={<span className="font-mono">~/.agents/skills</span>}
          action={<CountBadge count={agentSkills.length} />}
        >
          {renderLocalSkills(agentSkills)}
        </SettingsSection>
      )}

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

      <SkillsSpotlight installedSkills={skills.filter((s) => !s.isBuiltin)} onInstallComplete={fetchSkills} />
    </>
  )
}
