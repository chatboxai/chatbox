import type { ComponentProps } from 'react'
import { SegmentedControl as MantineSegmentedControl } from '@mantine/core'

type SegmentedControlProps = Omit<ComponentProps<typeof MantineSegmentedControl>, 'value' | 'onChange' | 'data'> & {
  value: string
  onChange: (value: string) => void
  data: { label: string; value: string }[]
}

export default function SegmentedControl({ value, onChange, data, ...props }: SegmentedControlProps) {
  return (
    <MantineSegmentedControl
      value={value}
      onChange={onChange}
      data={data}
      fullWidth
      transitionDuration={200}
      transitionTimingFunction="ease"
      color="chatbox-brand"
      {...props}
      styles={{
        root: {
          padding: 0,
        },
        indicator: {
          borderRadius: 0,
        },
      }}
    />
  )
}
