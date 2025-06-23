import { Image } from '@mantine/core'
import { ModelProvider } from 'src/shared/types'
import CustomProviderIcon from '../CustomProviderIcon'

const iconContext = (require as any).context('../../static/icons/providers', false, /\.png$/)
const icons: { name: string; src: string }[] = iconContext.keys().map((key: string) => ({
  name: key.replace('./', '').replace('.png', ''), // 获取图片名称
  src: iconContext(key), // 获取图片路径
}))

export default function ProviderImageIcon(props: {
  className?: string
  size?: number
  provider: ModelProvider | string
  providerName?: string
}) {
  const { className, size = 24, provider, providerName } = props

  const iconSrc = icons.find((icon) => icon.name === provider)?.src

  return iconSrc ? (
    <Image w={size} h={size} src={iconSrc} className={className} alt={`${providerName || provider} image icon`} />
  ) : providerName ? (
    <CustomProviderIcon providerId={provider} providerName={providerName} size={size} />
  ) : null
}
