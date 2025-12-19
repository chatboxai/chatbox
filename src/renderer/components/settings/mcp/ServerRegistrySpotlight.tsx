import { Avatar } from '@mantine/core'
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight'
import { IconJson, IconSearch, IconSquareRoundedPlusFilled } from '@tabler/icons-react'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/ScalableIcon'
import { MCP_ENTRIES_COMMUNITY, MCP_ENTRIES_OFFICIAL, type MCPRegistryEntry } from './registries'

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
              <ScalableIcon icon={IconSquareRoundedPlusFilled} size={24} className="text-chatbox-tint-brand" />
            ),
          },
          {
            id: 'import-json',
            label: t('Import from JSON in clipboard')!,
            description: t('Import MCP servers from JSON in your clipboard')!,
            onClick: () => props.triggerImportJson(),
            leftSection: <ScalableIcon icon={IconJson} size={24} className="text-chatbox-tint-brand" />,
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
        leftSection: <ScalableIcon icon={IconSearch} size={20} stroke={1.5} />,
        placeholder: t('Search...')!,
      }}
    />
  )
}

export default ServerRegistrySpotlight
