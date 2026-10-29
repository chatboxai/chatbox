export const MOBILE_SKILL_IDS = [
  'chatbox-product-info',
  'documents',
  'spreadsheets',
  'presentations',
  'websites',
] as const
export type MobileSkillId = (typeof MOBILE_SKILL_IDS)[number]
export type MobileSkillPreferences = Partial<Record<MobileSkillId, boolean>>

export function isMobileSkillEnabled(name: MobileSkillId, preferences?: MobileSkillPreferences): boolean {
  return preferences?.[name] ?? (name !== 'spreadsheets' && name !== 'presentations')
}

export function mobileSkillLabels(t: (key: string) => string) {
  return [
    {
      name: 'chatbox-product-info',
      title: t('Chatbox Product Info'),
      description: t('Get Chatbox product help and query account quota, settings, and chat history.'),
    },
    {
      name: 'documents',
      title: t('Documents'),
      description: t('Read Word document text and create text or HTML reports.'),
    },
    {
      name: 'spreadsheets',
      title: t('Spreadsheets'),
      description: t('Analyze Excel data and create spreadsheets or HTML reports.'),
    },
    {
      name: 'presentations',
      title: t('Presentations'),
      description: t('Create PowerPoint slides with text, images, tables, and shapes.'),
    },
    { name: 'websites', title: t('Websites'), description: t('Create static websites with an offline HTML preview.') },
  ] satisfies { name: MobileSkillId; title: string; description: string }[]
}
