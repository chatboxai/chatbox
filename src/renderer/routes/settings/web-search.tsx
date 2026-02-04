import { Button, Flex, PasswordInput, Select, Stack, Text, Title, Tooltip } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { ofetch } from 'ofetch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/web-search')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const extension = useSettingsStore((state) => state.extension)

  const [checkingTavily, setCheckingTavily] = useState(false)
  const [tavilyAvaliable, setTavilyAvaliable] = useState<boolean>()
  const checkTavily = async () => {
    if (extension.webSearch.tavilyApiKey) {
      setCheckingTavily(true)
      setTavilyAvaliable(undefined)
      try {
        await ofetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${extension.webSearch.tavilyApiKey}`,
          },
          body: {
            query: 'Chatbox',
            search_depth: 'basic',
            include_domains: [],
            exclude_domains: [],
          },
        })
        setTavilyAvaliable(true)
      } catch (e) {
        setTavilyAvaliable(false)
      } finally {
        setCheckingTavily(false)
      }
    }
  }

  return (
    <Stack p="md" gap="xxl">
      <Title order={5}>{t('Web Search')}</Title>

      <Select
        comboboxProps={{ withinPortal: true, withArrow: true }}
        data={[
          { value: 'build-in', label: 'Chatbox Search (Pro)' },
          { value: 'bing', label: 'Bing Search (Free)' },
          { value: 'tavily', label: 'Tavily' },
        ]}
        value={extension.webSearch.provider}
        onChange={(e) =>
          e &&
          setSettings({
            extension: {
              ...extension,
              webSearch: {
                ...extension.webSearch,
                provider: e as any,
              },
            },
          })
        }
        label={t('Search Provider')}
        maw={320}
      />
      {extension.webSearch.provider === 'build-in' && (
        <Text size="xs" c="chatbox-gray">
          {t('Chatbox Search is a paid feature with advanced capabilities and better performance.')}
        </Text>
      )}
      {extension.webSearch.provider === 'bing' && (
        <Text size="xs" c="chatbox-gray">
          {t(
            'Bing Search is provided for free use, but it may have limitations and is subject to change by Microsoft.'
          )}
        </Text>
      )}
      {/* Tavily API Key */}
      {extension.webSearch.provider === 'tavily' && (
        <Stack gap="xs">
          <Text fw="600">{t('Tavily API Key')}</Text>
          <Flex align="center" gap="xs">
            <PasswordInput
              flex={1}
              maw={320}
              value={extension.webSearch.tavilyApiKey}
              onChange={(e) => {
                setTavilyAvaliable(undefined)
                setSettings({
                  extension: {
                    ...extension,
                    webSearch: {
                      ...extension.webSearch,
                      tavilyApiKey: e.currentTarget.value,
                    },
                  },
                })
              }}
              error={tavilyAvaliable === false}
            />
            <Button color="chatbox-gray" variant="light" onClick={checkTavily} loading={checkingTavily}>
              {t('Check')}
            </Button>
          </Flex>
          
          {typeof tavilyAvaliable === 'boolean' ? (
            tavilyAvaliable ? (
              <Text size="xs" c="chatbox-success">
                {t('Connection successful!')}
              </Text>
            ) : (
              <Text size="xs" c="chatbox-error">
                {t('API key invalid!')}
              </Text>
            )
          ) : null}
          
          <Button
            variant="transparent"
            size="compact-xs"
            px={0}
            className="self-start"
            onClick={() => platform.openLink('https://app.tavily.com?utm_source=chatbox')}
          >
            {t('Get API Key')}
          </Button>

          {/* Tavily Configuration Options */}
          <Stack mt="md" gap="sm">
            <Title order={6}>{t('Tavily Search Options')}</Title>

            {/* Search Depth */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Search Depth')}</Text>
                <Tooltip label={t('The depth of the search. advanced search is tailored to retrieve the most relevant sources and content snippets for your query, while basic search provides generic content snippets from each source. Using "advanced" costs 2 credits per query.')}>
                  <Text size="sm" c="gray">ⓘ</Text>
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: 'basic', label: 'Basic' },
                  { value: 'advanced', label: 'Advanced' },
                ]}
                value={extension.webSearch.tavilySearchDepth || 'basic'}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        tavilySearchDepth: e,
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>

            {/* Max Results */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Max Results')}</Text>
                <Tooltip label={t('Maximum number of results to return.')}>
                  <Text size="sm" c="gray">ⓘ</Text>
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                  { value: '4', label: '4' },
                  { value: '5', label: '5' },
                  { value: '6', label: '6' },
                  { value: '7', label: '7' },
                  { value: '8', label: '8' },
                  { value: '9', label: '9' },
                  { value: '10', label: '10' },
                ]}
                value={String(extension.webSearch.tavilyMaxResults || 5)}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        tavilyMaxResults: parseInt(e),
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>

            {/* Time Range */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Time Range')}</Text>
                <Tooltip label={t('Time range of the search. For example, the last month.')}>
                  <Text size="sm" c="gray">ⓘ</Text>
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'day', label: 'Day' },
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                  { value: 'year', label: 'Year' },
                ]}
                value={extension.webSearch.tavilyTimeRange || 'none'}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        tavilyTimeRange: e,
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>

            {/* Include Raw Content */}
            <Stack gap="xs">
              <Flex align="center" gap="xs">
                <Text size="sm">{t('Include Raw Content')}</Text>
                <Tooltip label={t('Include the raw content of each search result.')}>
                  <Text size="sm" c="gray">ⓘ</Text>
                </Tooltip>
              </Flex>
              <Select
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'text', label: 'Text' },
                  { value: 'markdown', label: 'Markdown' },
                ]}
                value={extension.webSearch.tavilyIncludeRawContent || 'none'}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        tavilyIncludeRawContent: e,
                      },
                    },
                  })
                }
                maw={320}
              />
            </Stack>
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}
