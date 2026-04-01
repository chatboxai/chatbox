import { ActionIcon, Flex, TextInput, Transition } from '@mantine/core'
import { IconSearch, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export interface ExpandableSearchProps {
  onSearch: (term: string) => void
}

export function ExpandableSearch({ onSearch }: ExpandableSearchProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
    }
  }, [isOpen])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.currentTarget.value)
  }

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleBlur = () => {
    if (!value.trim()) {
      setIsOpen(false)
    }
  }

  const handleSearch = () => {
    onSearch(value.trim())
  }

  const handleClear = () => {
    setValue('')
    onSearch('')
    inputRef.current?.blur()
    setIsOpen(false)
  }

  return (
    <Flex align="center" gap="xs">
      <Transition mounted={isOpen} transition="fade-left" duration={200} enterDelay={100}>
        {(styles) => (
          <div style={styles}>
            <TextInput
              ref={inputRef}
              autoFocus
              placeholder={t('Search copilots...') ?? ''}
              value={value}
              onChange={handleChange}
              onKeyUp={handleKeyUp}
              onBlur={handleBlur}
              size="xs"
              w={isSmallScreen ? 160 : 200}
              rightSection={
                value ? (
                  <Flex gap={2}>
                    <ActionIcon
                      variant="subtle"
                      color="chatbox-tertiary"
                      size="sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleClear}
                    >
                      <ScalableIcon icon={IconX} size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="chatbox-tertiary"
                      size="sm"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSearch}
                    >
                      <ScalableIcon icon={IconSearch} size={16} />
                    </ActionIcon>
                  </Flex>
                ) : (
                  <ActionIcon
                    variant="subtle"
                    color="chatbox-tertiary"
                    size="sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleSearch}
                  >
                    <ScalableIcon icon={IconSearch} size={16} />
                  </ActionIcon>
                )
              }
              rightSectionWidth={value ? 52 : 28}
            />
          </div>
        )}
      </Transition>

      <Transition mounted={!isOpen} transition="fade" duration={100} enterDelay={200}>
        {(styles) => (
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size="lg"
            onClick={() => setIsOpen(true)}
            style={styles}
          >
            <ScalableIcon icon={IconSearch} size={20} />
          </ActionIcon>
        )}
      </Transition>
    </Flex>
  )
}

export default ExpandableSearch
