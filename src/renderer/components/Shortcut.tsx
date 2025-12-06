import { Box, Button, Combobox, Flex, Input, InputBase, Kbd, Select, Table, Text, useCombobox } from '@mantine/core'
import { IconAlertHexagon } from '@tabler/icons-react'
import { useState } from 'react'
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

// Constants for keyboard shortcut recording
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'OS', 'Command']
const MODIFIER_KEY_NAMES = ['Ctrl', 'Alt', 'Shift', 'Command', 'Control', 'Super']
const FUNCTION_KEY_PATTERN = /^F([1-9]|1[0-9]|2[0-4])$/

// Mapping for special key normalization
const KEY_NORMALIZATION_MAP: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

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
                {name === 'quickToggle' ? (
                  <ShortcutRecorder
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
                    suggestedValues={shortcutToggleWindowValues}
                  />
                ) : options ? (
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

function ShortcutRecorder({
  value,
  onSelect,
  isConflict,
  suggestedValues,
}: {
  value: string
  onSelect?(val: string): void
  isConflict?: boolean
  suggestedValues?: string[]
}) {
  const { t } = useTranslation()
  const [isRecording, setIsRecording] = useState(false)
  const [recordedKeys, setRecordedKeys] = useState<string[]>([])
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording) return

    e.preventDefault()
    e.stopPropagation()

    const keys: string[] = []

    // Capture modifier keys in the correct order
    // For cross-platform compatibility, prefer Command on Mac and Ctrl on other platforms
    // The main.ts normalizer will convert these to proper Electron format
    if (os === 'Mac') {
      // On Mac, prefer Command over Control
      if (e.metaKey) {
        keys.push('Command')
      } else if (e.ctrlKey) {
        keys.push('Ctrl')
      }
    } else {
      // On Windows/Linux, handle Ctrl and Super/Meta separately
      if (e.ctrlKey) {
        keys.push('Ctrl')
      }
      if (e.metaKey) {
        // metaKey is the Super key on Linux and Windows key on Windows
        keys.push('Super')
      }
    }
    if (e.altKey) {
      keys.push('Alt')
    }
    if (e.shiftKey) {
      keys.push('Shift')
    }

    // Capture the main key (not a modifier)
    const pressedKey = e.key
    const isModifier = MODIFIER_KEYS.includes(pressedKey)

    if (!isModifier && pressedKey) {
      // Normalize special keys to match Electron's accelerator format
      let normalizedKey = pressedKey

      // Check if key is in normalization map
      if (KEY_NORMALIZATION_MAP[pressedKey]) {
        normalizedKey = KEY_NORMALIZATION_MAP[pressedKey]
      } else if (pressedKey === '`') {
        // Backtick is kept as-is
        normalizedKey = '`'
      } else if (pressedKey.startsWith('Arrow')) {
        // ArrowUp -> Up, ArrowDown -> Down, etc.
        normalizedKey = pressedKey.replace('Arrow', '')
      } else if (FUNCTION_KEY_PATTERN.test(pressedKey)) {
        // Function keys F1-F24
        normalizedKey = pressedKey
      } else if (pressedKey.length === 1) {
        // Single character keys - keep uppercase for consistency
        normalizedKey = pressedKey.toUpperCase()
      }
      // Other keys - keep as is (default value)

      keys.push(normalizedKey)
    }

    setRecordedKeys(keys)
  }

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!isRecording) return

    e.preventDefault()
    e.stopPropagation()

    // Only finalize if we have a non-modifier key
    if (recordedKeys.length > 0) {
      const lastKey = recordedKeys[recordedKeys.length - 1]
      const isModifier = MODIFIER_KEY_NAMES.includes(lastKey)

      if (!isModifier) {
        const shortcut = recordedKeys.join('+')
        onSelect?.(shortcut)
        setIsRecording(false)
        setRecordedKeys([])
      }
    }
  }

  const handleStartRecording = () => {
    setIsRecording(true)
    setRecordedKeys([])
  }

  const handleCancelRecording = () => {
    setIsRecording(false)
    setRecordedKeys([])
  }

  const handleClearShortcut = () => {
    onSelect?.('')
  }

  const displayValue = isRecording ? (recordedKeys.length > 0 ? recordedKeys.join('+') : t('Press keys...')) : value

  return (
    <Box>
      <Flex gap="xs" align="center">
        <InputBase
          maw={200}
          component="button"
          type="button"
          pointer
          onClick={handleStartRecording}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          style={{
            backgroundColor: isRecording ? 'var(--mantine-color-blue-0)' : undefined,
            border: isRecording ? '2px solid var(--mantine-color-blue-5)' : undefined,
          }}
        >
          <ShortcutText shortcut={displayValue} isConflict={isConflict} />
        </InputBase>
        {isRecording && (
          <Button size="xs" variant="subtle" onClick={handleCancelRecording}>
            {t('Cancel')}
          </Button>
        )}
        {!isRecording && value && (
          <Button size="xs" variant="subtle" onClick={handleClearShortcut}>
            {t('Clear')}
          </Button>
        )}
        {!isRecording && suggestedValues && suggestedValues.length > 0 && (
          <Combobox
            store={combobox}
            onOptionSubmit={(val) => {
              onSelect?.(val)
              combobox.closeDropdown()
            }}
          >
            <Combobox.Target targetType="button">
              <Button size="xs" variant="subtle" onClick={() => combobox.toggleDropdown()}>
                {t('Suggestions')}
              </Button>
            </Combobox.Target>

            <Combobox.Dropdown>
              <Combobox.Options>
                {suggestedValues.map((o) => (
                  <Combobox.Option key={o} value={o}>
                    <ShortcutText shortcut={o} />
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>
        )}
      </Flex>
    </Box>
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
