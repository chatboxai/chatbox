import { Anchor, Box, Button, Container, Divider, Flex, Image, Popover, Stack, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconAlertTriangle,
  IconChevronRight,
  IconClipboard,
  IconFileText,
  IconHome,
  IconMail,
  IconMessage2,
  IconPencil,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import BrandGithub from '@/components/icons/BrandGithub'
import BrandRedNote from '@/components/icons/BrandRedNote'
import BrandWechat from '@/components/icons/BrandWechat'
import Page from '@/components/Page'
import { ScalableIcon } from '@/components/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import iconPNG from '@/static/icon.png'
import IMG_WECHAT_QRCODE from '@/static/wechat_qrcode.png'
import { useLanguage } from '@/stores/settingsStore'

export const Route = createFileRoute('/about')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t, i18n: _i18n } = useTranslation()
  const version = useVersion()
  const language = useLanguage()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page title={t('About')}>
      <Container size="md" p={0}>
        <Stack gap="xxl" px={isSmallScreen ? 'sm' : 'md'} py={isSmallScreen ? 'xl' : 'md'}>
          <Flex gap="xxl" p="md" className="rounded-lg bg-chatbox-background-secondary">
            <Image h={100} w={100} mah={'20vw'} maw={'20vw'} src={iconPNG} />
            <Stack flex={1} gap="xxs">
              <Flex justify="space-between" align="center">
                <Title order={5} lh={1.5}>
                  Chatbox {/\d/.test(version.version) ? `(v${version.version})` : ''}
                </Title>

                {!isSmallScreen && (
                  <Button
                    size="xs"
                    onClick={() => platform.openLink(`https://chatboxai.app/redirect_app/check_update/${language}`)}
                  >
                    {t('Check Update')}
                  </Button>
                )}
              </Flex>
              <Text>{t('about-slogan')}</Text>
              <Text c="chatbox-tertiary">{t('about-introduction')}</Text>

              <Flex gap="sm">
                <Anchor
                  size="sm"
                  href="https://chatboxai.app/privacy"
                  target="_blank"
                  underline="hover"
                  c="chatbox-tertiary"
                >
                  {t('Privacy Policy')}
                </Anchor>
                <Anchor
                  size="sm"
                  href="https://chatboxai.app/terms"
                  target="_blank"
                  underline="hover"
                  c="chatbox-tertiary"
                >
                  {t('User Terms')}
                </Anchor>
              </Flex>
            </Stack>
          </Flex>

          {_i18n.language === 'zh-Hans' ? (
            <Stack gap="xs" p="md" className="rounded-lg bg-chatbox-background-warning-secondary">
              <Flex align="center" gap="xxs" c="chatbox-error">
                <ScalableIcon icon={IconAlertTriangle} size={24} className="!text-inherit" />
                <Title order={5}>正版提示</Title>
              </Flex>
              <Text>
                近期出现了附带 Chatbox 的所谓一键本地部署 DeepSeek 的付费捆绑软件安装包。
                Chatbox客户端本身是开源免费软件，只在官网(chatboxai.app)销售托管AI服务。
                如果发现上当受骗，请尽快在对应支付平台如微信、支付宝申请退款。
              </Text>
            </Stack>
          ) : null}

          <List>
            <ListItem
              icon={<BrandGithub className="w-full h-full" />}
              title={t('Github')}
              link="https://github.com/chatboxai/chatbox"
              value="chatbox"
            />
            {/* <ListItem
              icon={<BrandX className="w-full h-full" />}
              title={t('X(Twitter)')}
              link="https://x.com/ChatboxAI_HQ"
              value="@ChatboxAI_HQ"
            /> */}
            <ListItem
              icon={<BrandRedNote className="w-full h-full" />}
              title={t('RedNote')}
              link="https://www.xiaohongshu.com/user/profile/67b581b6000000000e01d11f"
              value="@63844903136"
            />
            <ListItem icon={<BrandWechat className="w-full h-full" />} title={t('WeChat')} right={<WechatQRCode />} />
          </List>

          <List>
            <ListItem
              icon={<IconHome className="w-full h-full" />}
              title={t('Homepage')}
              link={`https://chatboxai.app/redirect_app/homepage/${language}`}
            />
            <ListItem
              icon={<IconClipboard className="w-full h-full" />}
              title={t('Survey')}
              link={_i18n.language === 'zh-Hans' ? 'https://jsj.top/f/fcMYEa' : 'https://jsj.top/f/RUMbvY'}
            />
            <ListItem
              icon={<IconPencil className="w-full h-full" />}
              title={t('Feedback')}
              link={`https://chatboxai.app/redirect_app/feedback/${language}`}
            />
            <ListItem
              icon={<IconFileText className="w-full h-full" />}
              title={t('Changelog')}
              link={`https://chatboxai.app/${language.split('-')[0] || 'en'}/help-center/changelog`}
            />
            <ListItem
              icon={<IconMail className="w-full h-full" />}
              title={t('E-mail')}
              link={`mailto:hi@chatboxai.com`}
              value="hi@chatboxai.com"
            />
            <ListItem
              icon={<IconMessage2 className="w-full h-full" />}
              title={t('FAQs')}
              link={`https://chatboxai.app/${language.split('-')[0] || 'en'}/help-center/chatbox-ai-service-faqs`}
            />
          </List>
        </Stack>

        {/* 开发环境下显示错误测试面板 */}
        {/* {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 max-w-md">
            <ErrorTestPanel />
          </div>
        )} */}
      </Container>
    </Page>
  )
}

function WechatQRCode() {
  const { t } = useTranslation()
  const [opened, { close, open }] = useDisclosure(false)
  return (
    <Popover position="top" withArrow shadow="md" opened={opened}>
      <Popover.Target>
        <Text onMouseEnter={open} onMouseLeave={close} c="chatbox-brand" className="cursor-pointer">
          {t('QR Code')}
        </Text>
      </Popover.Target>
      <Popover.Dropdown style={{ pointerEvents: 'none' }}>
        <Image src={IMG_WECHAT_QRCODE} alt="wechat qrcode" w={160} h={160} />
      </Popover.Dropdown>
    </Popover>
  )
}

function List(props: { children: ReactElement[] }) {
  return (
    <Stack gap={0} className="rounded-lg bg-chatbox-background-secondary">
      {props.children.map((child, index) => (
        <Fragment key={`child-${index}`}>
          {child}
          {index !== props.children.length - 1 && <Divider />}
        </Fragment>
      ))}
    </Stack>
  )
}

function ListItem({
  icon,
  title,
  link,
  value,
  right,
}: {
  icon: ReactElement
  title: string
  link?: string
  value?: string
  right?: ReactElement
}) {
  return (
    <Flex
      px="md"
      py="sm"
      gap="xs"
      align="center"
      className={link ? 'cursor-pointer' : ''}
      onClick={() => link && platform.openLink(link)}
      c="chatbox-tertiary"
    >
      <Box w={20} h={20} className="flex-shrink-0 " c="chatbox-primary">
        {icon}
      </Box>
      <Text flex={1} size="md">
        {title}
      </Text>

      {right ? (
        right
      ) : (
        <>
          {value && (
            <Text size="md" c="chatbox-tertiary">
              {value}
            </Text>
          )}
          {link && <ScalableIcon icon={IconChevronRight} size={20} className="!text-inherit" />}
        </>
      )}
    </Flex>
  )
}
