import { useMantineTheme } from '@mantine/core'
import type { IconProps, TablerIcon } from '@tabler/icons-react'
import { type ForwardedRef, forwardRef } from 'react'

type Props = Omit<IconProps, 'size'> & {
  size?: number
  icon: TablerIcon
}

function ScalableIconInner({ icon: IconComponent, size = 16, ...others }: Props, ref: ForwardedRef<SVGSVGElement>) {
  const theme = useMantineTheme()
  const scale = theme.scale ?? 1
  return <IconComponent ref={ref} size={size * scale} {...others} />
}

export const ScalableIcon = forwardRef(ScalableIconInner)
