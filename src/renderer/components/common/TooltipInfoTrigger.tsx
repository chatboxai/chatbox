import { UnstyledButton } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ScalableIcon } from './ScalableIcon'

type TooltipInfoTriggerProps = { label: string } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>

export const TooltipInfoTrigger = forwardRef<HTMLButtonElement, TooltipInfoTriggerProps>(
  ({ className, label, ...props }, ref) => {
    const { t } = useTranslation()

    return (
      <UnstyledButton
        ref={ref}
        type="button"
        aria-label={t('Help for {{name}}', { name: label })}
        {...props}
        className={cn('-m-1.5 inline-flex p-1.5', className)}
      >
        <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
      </UnstyledButton>
    )
  }
)

TooltipInfoTrigger.displayName = 'TooltipInfoTrigger'
