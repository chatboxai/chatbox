import { useTranslation } from 'react-i18next'
import type { SessionSettings } from '../../shared/types'
import { AdaptiveSelect } from './AdaptiveSelect'

export interface Props {
  value: SessionSettings['dalleStyle']
  onChange(value: SessionSettings['dalleStyle']): void
  className?: string
}

export default function ImageStyleSelect(props: Props) {
  const { t } = useTranslation()

  return (
    <AdaptiveSelect
      label={t('Image Style')}
      data={[
        {
          label: t('Vivid'),
          value: 'vivid',
        },
        {
          label: t('Natural'),
          value: 'natural',
        },
      ]}
      value={props.value}
      onChange={(e) => e && props.onChange && props.onChange(e as SessionSettings['dalleStyle'])}
    />
  )
}
