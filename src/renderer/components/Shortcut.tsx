import { Box, Combobox, Flex, Input, InputBase, Kbd, Select, Table, Text, useCombobox } from '@mantine/core'
import { IconAlertHexagon } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import {
  type Settings,
  type ShortcutName,
  type ShortcutSetting,
  shortcutSendValues,
  shortcutToggleWindowValues,
} from '@/../shared/types'
import { getOS } from '@/packages/navigator'
import { ScalableIcon } from './ScalableIcon'

const os = getOS()

function formatKey(key: string) {
  const COMMON_KEY_MAPS: Record<string, string> = {
    ctrl: 'Ctrl',
    command: 'Ctrl',
    mod: 'Ctrl',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
    enter: '⏎',
    tab: 'Tab',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
  }
  const MAC_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: '⌘',
    mod: '⌘',
    command: '⌘',
    option: '⌥',
    alt: '⌥',
    tab: '⇥',
    // shift: '⇧',
  }
  const WINDOWS_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: 'Win',
    // command: 'Win',
  }
  const LINUX_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: 'Super',
    mod: 'Super',
    command: 'Super',
  }
  if (!key) {
    return ''
  }
  const lowercaseKey = key.toLowerCase()
  const keyLabel = key.length === 1 ? key.toUpperCase() : key
  switch (os) {
    case 'Mac':
      return MAC_KEY_MAPS[lowercaseKey] || keyLabel
    case 'Windows':
      return WINDOWS_KEY_MAPS[lowercaseKey] || keyLabel
    case 'Linux':
      return LINUX_KEY_MAPS[lowercaseKey] || keyLabel
    default:
      return COMMON_KEY_MAPS[lowercaseKey] || keyLabel
  }
}

export function Keys(props: {
  keys: string[]
  size?: 'small'
  opacity?: number
  onEdit?: () => void
  className?: string
}) {
  // const sizeClass = props.size === 'small' ? 'text-[0.55rem]' : 'text-sm'
  const sizeClass = 'text-xs'
  const opacityClass = props.opacity !== undefined ? `opacity-${props.opacity * 100}` : ''
  return (
    <span className={`inline-block px-1 ${opacityClass} ${props.className || ''}`}>
      {props.keys.map((key) => (
        <Kbd key={key} className="mr-3xs">
          {formatKey(key)}
        </Kbd>
        // <Key key={index}>{formatKey(key)}</Key>
      ))}
    </span>
  )
}

type ShortcutDataItem = {
  label: string
  name?: ShortcutName
  keys: ShortcutSetting[ShortcutName]
  options?: string[]
}

export function ShortcutConfig(props: {
  shortcuts: Settings['shortcuts']
  setShortcuts: (shortcuts: Settings['shortcuts']) => void
}) {
  const { shortcuts, setShortcuts } = props
  const { t } = useTranslation()
  const items: ShortcutDataItem[] = [
    {
      label: t('Show/Hide the Application Window'),
      name: 'quickToggle',
      keys: shortcuts.quickToggle,
      options: shortcutToggleWindowValues,
    },
    {
      label: t('Focus on the Input Box'),
      name: 'inputBoxFocus',
      keys: shortcuts.inputBoxFocus,
    },
    {
      label: t('Focus on the Input Box and Enter Web Browsing Mode'),
      name: 'inputBoxWebBrowsingMode',
      keys: shortcuts.inputBoxWebBrowsingMode,
    },
    {
      label: t('Send'),
      name: 'inputBoxSendMessage',
      keys: shortcuts.inputBoxSendMessage,
      options: shortcutSendValues,
    },
    // {
    //     label: t('Insert a New Line into the Input Box'),
    //     // name: 'inputBoxInsertNewLine',
    //     keys: shortcuts.inputBoxInsertNewLine,
    // },
    {
      label: t('Send Without Generating Response'),
      name: 'inputBoxSendMessageWithoutResponse',
      keys: shortcuts.inputBoxSendMessageWithoutResponse,
      options: shortcutSendValues,
    },
    {
      label: t('Create a New Conversation'),
      name: 'newChat',
      keys: shortcuts.newChat,
    },
    {
      label: t('Create a New Image-Creator Conversation'),
      name: 'newPictureChat',
      keys: shortcuts.newPictureChat,
    },
    {
      label: t('Navigate to the Next Conversation'),
      name: 'sessionListNavNext',
      keys: shortcuts.sessionListNavNext,
    },
    {
      label: t('Navigate to the Previous Conversation'),
      name: 'sessionListNavPrev',
      keys: shortcuts.sessionListNavPrev,
    },
    {
      label: t('Navigate to the Specific Conversation'),
      // name: 'sessionListNavTargetIndex',
      keys: 'mod+1-9',
    },
    {
      label: t('Start a New Thread'),
      name: 'messageListRefreshContext',
      keys: shortcuts.messageListRefreshContext,
    },
    {
      label: t('Show/Hide the Search Dialog'),
      name: 'dialogOpenSearch',
      keys: shortcuts.dialogOpenSearch,
    },
    {
      label: t('Navigate to the Previous Option (in search dialog)'),
      // name: 'optionNavUp',
      keys: shortcuts.optionNavUp,
    },
    {
      label: t('Navigate to the Next Option (in search dialog)'),
      // name: 'optionNavDown',
      keys: shortcuts.optionNavDown,
    },
    {
      label: t('Select the Current Option (in search dialog)'),
      // name: 'optionSelect',
      keys: shortcuts.optionSelect,
    },
  ]
  const isConflict = (name: ShortcutName, shortcut: string) => {
    for (const item of items) {
      if (item.name && item.name !== name && item.keys === shortcut) {
        return true
      }
    }
    return false
  }
  return (
    <Box className="border border-solid  py-xs px-md rounded-xs border-chatbox-border-primary">
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('Action')}</Table.Th>
            <Table.Th>{t('Hotkeys')}</Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {items.map(({ name, label, keys, options }) => (
            <Table.Tr key={`${name}`}>
              <Table.Td>{label}</Table.Td>
              <Table.Td>
                {options ? (
                  <ShortcutSelect
                    options={options}
                    value={keys}
                    onSelect={(val) => {
                      if (name && setShortcuts) {
                        setShortcuts({
                          ...shortcuts,
                          [name]: val,
                        })
                      }
                    }}
                    isConflict={name ? isConflict(name, keys) : false}
                  />
                ) : (
                  <ShortcutText shortcut={keys} isConflict={name ? isConflict(name, keys) : false} className="ml-sm" />
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  )
}

function ShortcutText(props: { shortcut: string; isConflict?: boolean; className?: string }) {
  const { shortcut, isConflict, className } = props
  const { t } = useTranslation()
  if (shortcut === '') {
    return <span className={`px-2 py-0.5 text-xs ${className || ''}`}>{t('None')}</span>
  }
  return (
    <Flex align="center" component="span" className={`py-0.5 text-xs ${className || ''}`} c="chatbox-error">
      <Keys keys={shortcut.split('+')} />
      {isConflict && <ScalableIcon icon={IconAlertHexagon} size={16} />}
    </Flex>
  )
}

function ShortcutSelect({
  options,
  value,
  onSelect,
  isConflict,
}: {
  options: string[]
  value: string
  onSelect?(val: string): void
  isConflict?: boolean
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        onSelect?.(val)
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target targetType="button">
        <InputBase
          maw={160}
          component="button"
          type="button"
          pointer
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
        >
          <ShortcutText shortcut={value} isConflict={isConflict} />
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {options.map((o) => (
            <Combobox.Option key={o} value={o}>
              <ShortcutText shortcut={o} />
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
