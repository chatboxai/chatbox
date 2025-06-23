import { Avatar } from '@mantine/core'
import { Spotlight, SpotlightActionData, SpotlightActionGroupData } from '@mantine/spotlight'
import { IconJson, IconSearch, IconSquareRoundedPlusFilled } from '@tabler/icons-react'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MCP_ENTRIES_COMMUNITY, MCP_ENTRIES_OFFICIAL, MCPRegistryEntry } from './registries'

const ServerRegistrySpotlight: FC<{
  triggerAddServer: (entry?: MCPRegistryEntry) => void
  triggerImportJson: () => void
}> = (props) => {
  const { t } = useTranslation()
  const actions: (SpotlightActionGroupData | SpotlightActionData)[] = useMemo(() => {
    return [
      {
        group: t('Add or Import')!,
        actions: [
          {
            id: 'custom',
            label: t('Add Custom Server')!,
            description: t('Configure MCP server manually')!,
            onClick: () => props.triggerAddServer(),
            leftSection: (
              <IconSquareRoundedPlusFilled size={24} className="text-[var(--mantine-color-chatbox-brand-text)]" />
            ),
          },
          {
            id: 'import-json',
            label: t('Import from JSON in clipboard')!,
            description: t('Import MCP servers from JSON in your clipboard')!,
            onClick: () => props.triggerImportJson(),
            leftSection: <IconJson size={24} className="text-[var(--mantine-color-chatbox-brand-text)]" />,
          },
        ],
      },
      {
        group: t('Explore (official)')!,
        actions: MCP_ENTRIES_OFFICIAL.map((entry) => ({
          id: entry.name,
          label: entry.title,
          description: entry.description,
          onClick: () => props.triggerAddServer(entry),
          leftSection: <Avatar src={entry.icon} name={entry.name} color="initials" size={20} />,
        })),
      },
      {
        group: t('Explore (community)')!,
        actions: MCP_ENTRIES_COMMUNITY.map((entry) => ({
          id: entry.name,
          label: entry.title,
          description: entry.description,
          onClick: () => props.triggerAddServer(entry),
          leftSection: <Avatar src={entry.icon} name={entry.name} color="initials" size={20} />,
        })),
      },
    ]
  }, [props.triggerAddServer])
  return (
    <Spotlight
      actions={actions}
      nothingFound={t('Nothing found...')!}
      scrollable
      maxHeight={600}
      shortcut={null}
      searchProps={{
        leftSection: <IconSearch size={20} stroke={1.5} />,
        placeholder: t('Search...')!,
      }}
    />
  )
}

export default ServerRegistrySpotlight
