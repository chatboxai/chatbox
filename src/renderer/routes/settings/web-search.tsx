import { Flex, Select, Text, UnstyledButton } from '@mantine/core'
import type { Settings } from '@shared/types'
import { IconCheck, IconX } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { ofetch } from 'ofetch'
import { useTranslation } from 'react-i18next'
import { trackJkClickEvent } from '@/analytics/jk'
import { JK_EVENTS, JK_PAGE_NAMES } from '@/analytics/jk-events'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { CheckedFieldRow } from '@/components/settings/CheckedFieldRow'
import { SettingRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { AppTooltip as Tooltip } from '@/components/ui/tooltip'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import { BochaSearch } from '@/packages/web-search/bocha'
import { WEB_SEARCH_PROVIDERS, type WebSearchProviderValue } from '@/packages/web-search/constants'
import { QUERIT_SEARCH_URL } from '@/packages/web-search/querit'
import { SearxngSearch } from '@/packages/web-search/searxng'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/web-search')({
  component: RouteComponent,
})

type WebSearchSettings = Settings['extension']['webSearch']

const QUERIT_MAX_RESULTS = Array.from({ length: 10 }, (_, index) => String(index + 1))

async function checkTavily(apiKey: string) {
  await ofetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: { query: 'Chatbox', search_depth: 'basic', include_domains: [], exclude_domains: [] },
  })
}

async function checkQuerit(apiKey: string) {
  await ofetch(QUERIT_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: { query: 'Chatbox' },
  })
}

function ProvidedTools({ provider }: { provider: WebSearchProviderValue }) {
  const { t } = useTranslation()
  const tools = [
    { label: t('Web Search'), supported: true },
    { label: t('Read Webpage'), supported: PROVIDERS_WITH_PARSE_LINK.has(provider) },
  ]
  return (
    <Flex gap="sm" wrap="wrap" align="center" mt={2}>
      <Text fz={12} lh="18px" c="chatbox-tertiary">
        {t('Provided tools')}
      </Text>
      {tools.map(({ label, supported }) => (
        <Flex key={label} align="center" gap={4}>
          {supported ? (
            <IconCheck size={14} className="text-chatbox-tint-success" />
          ) : (
            <IconX size={14} className="text-chatbox-tint-tertiary" />
          )}
          <Text fz={12} lh="18px" c={supported ? 'chatbox-secondary' : 'chatbox-tertiary'}>
            {label}
          </Text>
        </Flex>
      ))}
    </Flex>
  )
}

export function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const extension = useSettingsStore((state) => state.extension)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const webSearch = extension.webSearch
  const provider = webSearch.provider

  const updateWebSearch = (patch: Partial<WebSearchSettings>) =>
    setSettings({ extension: { ...extension, webSearch: { ...webSearch, ...patch } } })

  const providerNote =
    provider === 'build-in'
      ? t('Chatbox Search is a paid feature with advanced capabilities and better performance.')
      : provider === 'bing'
        ? t('Bing Search is provided for free use, but it may have limitations and is subject to change by Microsoft.')
        : undefined

  return (
    <SettingsPage title={t('Web Search')} description={t('The search service used when a model searches the web.')}>
      <SettingsSection title={t('Search Provider')}>
        <SettingRow
          id="search-provider"
          label={t('Search Provider')}
          description={providerNote}
          status={<ProvidedTools provider={provider} />}
          controlLayout="block"
          control={(fieldId) => (
            <AdaptiveSelect
              id={fieldId}
              comboboxProps={{ withinPortal: true, withArrow: true }}
              aria-label={t('Search Provider') ?? undefined}
              data={WEB_SEARCH_PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
              value={provider}
              onChange={(value) => value && updateWebSearch({ provider: value as WebSearchProviderValue })}
            />
          )}
        />
        {provider === 'searxng' && (
          <CheckedFieldRow
            key="searxng"
            id="searxng-url"
            label={t('SearXNG Instance URL')}
            description={t('The SearXNG instance must enable JSON output format in search settings.')}
            value={webSearch.searxngBaseUrl}
            onChange={(searxngBaseUrl) => updateWebSearch({ searxngBaseUrl })}
            placeholder="https://searx.example.com"
            check={async (url) => {
              await new SearxngSearch(url).search('Chatbox')
            }}
            failureMessage={t('Connection failed!')}
          />
        )}
        {provider === 'tavily' && (
          <CheckedFieldRow
            key="tavily"
            id="tavily-api-key"
            label={t('Tavily API Key')}
            secret
            value={webSearch.tavilyApiKey}
            onChange={(tavilyApiKey) => updateWebSearch({ tavilyApiKey })}
            check={checkTavily}
            failureMessage={t('API key invalid!')}
            getKeyUrl="https://app.tavily.com?utm_source=chatbox"
          />
        )}
        {provider === 'bocha' && (
          <CheckedFieldRow
            key="bocha"
            id="bocha-api-key"
            label={t('BoCha API Key')}
            secret
            value={webSearch.bochaApiKey}
            onChange={(bochaApiKey) => updateWebSearch({ bochaApiKey })}
            check={async (apiKey) => {
              await new BochaSearch(apiKey).search('Chatbox')
            }}
            failureMessage={t('API key invalid!')}
            getKeyUrl="https://open.bochaai.com"
          />
        )}
        {provider === 'querit' && (
          <CheckedFieldRow
            key="querit"
            id="querit-api-key"
            label={t('Querit API Key')}
            secret
            value={webSearch.queritApiKey}
            onChange={(queritApiKey) => updateWebSearch({ queritApiKey })}
            placeholder={t('Enter your Querit API Key') ?? undefined}
            check={checkQuerit}
            failureMessage={t('API key invalid!')}
            getKeyUrl="https://www.querit.ai"
          />
        )}
      </SettingsSection>

      {provider === 'querit' && (
        <SettingsSection title={t('Querit Search Options')}>
          <SettingRow
            id="querit-max-results"
            label={t('Max Results')}
            description={t('Maximum number of results to return.')}
            control={(fieldId) => (
              <Select
                id={fieldId}
                w={120}
                comboboxProps={{ withinPortal: true, withArrow: true }}
                aria-label={t('Max Results') ?? undefined}
                data={QUERIT_MAX_RESULTS}
                value={String(webSearch.queritMaxResults || 5)}
                onChange={(value) => value && updateWebSearch({ queritMaxResults: Number.parseInt(value, 10) })}
              />
            )}
          />
          <SettingRow
            id="querit-time-range"
            label={t('Time Range')}
            description={t('Time range of the search. For example, the last month.')}
            control={(fieldId) => (
              <Select
                id={fieldId}
                w={120}
                comboboxProps={{ withinPortal: true, withArrow: true }}
                aria-label={t('Time Range') ?? undefined}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'd1', label: 'Day' },
                  { value: 'w1', label: 'Week' },
                  { value: 'm1', label: 'Month' },
                  { value: 'y1', label: 'Year' },
                ]}
                value={webSearch.queritTimeRange || 'none'}
                onChange={(value) => value && updateWebSearch({ queritTimeRange: value })}
              />
            )}
          />
        </SettingsSection>
      )}

      {provider !== 'build-in' && !licenseKey && (
        <Tooltip
          label={t(
            'Note: If you have never had a license before, you can claim it after logging in on the official website. Quota refreshed daily.'
          )}
          withArrow
          multiline
          maw={280}
          position="bottom-start"
        >
          <UnstyledButton
            className="self-start px-1 text-xs text-chatbox-tint-tertiary"
            onClick={() => {
              trackJkClickEvent(JK_EVENTS.FREE_LICENSE_CLAIM_CLICK, {
                pageName: JK_PAGE_NAMES.SETTING_PAGE,
                content: 'settings_websearch',
              })
              platform.openLink('https://chatboxai.app/login')
            }}
          >
            {t('You can ')}
            <span className="text-chatbox-tint-brand underline decoration-dotted">{t('try Chatbox AI')}</span>
            {t(' for free now!')}
          </UnstyledButton>
        </Tooltip>
      )}
    </SettingsPage>
  )
}
