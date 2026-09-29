import type { SelectProps as MantineSelectProps } from '@mantine/core'
import { Button, Select, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export interface AdaptiveSelectProps extends Omit<MantineSelectProps, 'onChange'> {
  onChange?: (value: string | null) => void
}

export function AdaptiveSelect(props: AdaptiveSelectProps) {
  const isSmallScreen = useIsSmallScreen()
  const [drawerOpened, setDrawerOpened] = useState(false)
  // A select labelled by the row around it names its drawer with its accessible name.
  const title = props.label ?? props['aria-label']

  return isSmallScreen ? (
    <Drawer.NestedRoot open={drawerOpened} onOpenChange={(open) => setDrawerOpened(open)} noBodyStyles>
      <Drawer.Trigger asChild>
        <Select {...props} dropdownOpened={false} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />

        <Drawer.Content className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none bg-chatbox-background-primary rounded-t-lg max-h-[80vh] overflow-hidden select-none">
          <Drawer.Handle />
          {title && (
            <Text c="chatbox-tertiary" size="xs" className="text-center my-xxs">
              {title}
            </Text>
          )}
          <Stack gap="xs" p="sm" pb={0} className="overflow-y-auto">
            {props.data?.map((item) => {
              let label: string = ''
              let value: string = ''

              if (typeof item === 'string') {
                value = item
                label = item
              } else if (typeof item === 'object' && 'value' in item && 'label' in item) {
                value = item.value
                label = item.label
              }

              if (!value || !label) return null

              return (
                <Drawer.Close key={value} asChild>
                  <Button
                    variant="transparent"
                    color="chatbox-primary"
                    className="flex-none"
                    onClick={() => props.onChange?.(value)}
                  >
                    {label}
                  </Button>
                </Drawer.Close>
              )
            })}

            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </Stack>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.NestedRoot>
  ) : (
    <Select {...props} />
  )
}
