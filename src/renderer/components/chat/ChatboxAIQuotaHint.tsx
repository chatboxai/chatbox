import type { ChatboxAILicenseDetail } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { getLicenseDetailRealtime } from '@/packages/remote'
import { formatNumber } from '@/utils/format'

function getPlanName(detail: ChatboxAILicenseDetail): string {
  const name = detail.name.replace(/^Chatbox AI\s*/i, '')
  return name || detail.plan || 'Lite'
}

export function ChatboxAIQuotaHint({ licenseKey }: { licenseKey: string }) {
  const { i18n } = useTranslation()
  const { data: licenseDetail, isError } = useQuery({
    queryKey: ['chatbox-ai-error-quota', licenseKey],
    queryFn: async () => {
      const response = await getLicenseDetailRealtime({ licenseKey })
      return response.error ? null : response.data
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    placeholderData: () => undefined,
  })
  if (isError || !licenseDetail) return null
  const isCN = i18n.language.toLowerCase().startsWith('zh')

  const planDetail = licenseDetail.unified_token_usage_details?.find((detail) => detail.type === 'plan')
  const now = Date.now()
  const licenseExpired = !!licenseDetail.token_expire_time && new Date(licenseDetail.token_expire_time).getTime() <= now
  const planExpired = !!planDetail?.expires_at && new Date(planDetail.expires_at).getTime() <= now
  const planRemaining =
    planDetail && !licenseExpired && !planExpired
      ? Math.max((planDetail.token_limit || 0) - (planDetail.token_usage || 0), 0)
      : 0
  const expansionRemaining = Math.max(
    (licenseDetail.expansion_pack_limit || 0) - (licenseDetail.expansion_pack_usage || 0),
    0
  )
  if (planRemaining <= 0 && expansionRemaining <= 0) return null

  const values = {
    plan: getPlanName(licenseDetail),
    planPoints: formatNumber(planRemaining, 2, isCN),
    expansionPoints: formatNumber(expansionRemaining, 2, isCN),
  }
  const i18nKey =
    planRemaining > 0 && expansionRemaining > 0
      ? 'You currently have a Chatbox {{plan}} plan, with {{planPoints}} plan points and {{expansionPoints}} expansion pack points. Switch to a model under "Chatbox AI" in the model list to use it immediately.'
      : planRemaining > 0
        ? 'You currently have a Chatbox {{plan}} plan, with {{planPoints}} plan points. Switch to a model under "Chatbox AI" in the model list to use it immediately.'
        : 'You currently have {{expansionPoints}} Chatbox expansion pack points. Switch to a model under "Chatbox AI" in the model list to use it immediately.'

  return (
    <div className="text-sm leading-5 text-[var(--chatbox-tint-secondary)]">
      <Trans i18nKey={i18nKey} values={values} />
    </div>
  )
}
