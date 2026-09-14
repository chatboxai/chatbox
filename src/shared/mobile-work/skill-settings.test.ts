import { SettingsSchema } from '@chatbox/core/domain/settings/settings-schema'
import { describe, expect, it } from 'vitest'
import { isMobileSkillEnabled, mobileSkillLabels } from './skill-settings'

const schema = SettingsSchema.pick({ mobileSkillPreferences: true })
describe('mobile skill settings persistence', () => {
  it('preserves explicit choices across serialization while applying defaults to absent choices', () => {
    const settings = schema.parse({ mobileSkillPreferences: { spreadsheets: true, documents: false } })
    const restored = schema.parse(JSON.parse(JSON.stringify(settings)))
    expect(isMobileSkillEnabled('spreadsheets', restored.mobileSkillPreferences)).toBe(true)
    expect(isMobileSkillEnabled('documents', restored.mobileSkillPreferences)).toBe(false)
    expect(isMobileSkillEnabled('presentations', restored.mobileSkillPreferences)).toBe(false)
    expect(isMobileSkillEnabled('websites', restored.mobileSkillPreferences)).toBe(true)
    expect(schema.parse({}).mobileSkillPreferences).toBeUndefined()
  })
})

it('shows only content skills and strips device preferences while preserving content choices', () => {
  expect(mobileSkillLabels((key) => key).map((skill) => skill.name)).toEqual([
    'documents',
    'spreadsheets',
    'presentations',
    'websites',
  ])
  expect(
    schema.parse({
      mobileSkillPreferences: {
        spreadsheets: true,
        documents: false,
        photos: false,
        calendar: false,
        reminders: false,
        health: false,
      },
    }).mobileSkillPreferences
  ).toEqual({ spreadsheets: true, documents: false })
})
