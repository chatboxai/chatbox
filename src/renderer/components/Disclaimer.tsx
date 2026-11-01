import { Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export function Disclaimer() {
  const { t } = useTranslation()

  return (
    <Text className="disclaimer-safe-area whitespace-nowrap" size="xs" c="dimmed" ta="center">
      {t('AI can be wrong. Verify key facts.')}
    </Text>
  )
}

export default Disclaimer
