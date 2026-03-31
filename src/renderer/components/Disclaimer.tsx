import { Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export function Disclaimer() {
  const { t } = useTranslation()

  return (
    <Text className="disclaimer-safe-area" size="xs" c="dimmed" ta="center">
      {t('AI-generated content may be inaccurate. Please verify important information.')}
    </Text>
  )
}

export default Disclaimer
