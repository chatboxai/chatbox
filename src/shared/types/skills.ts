import { z } from 'zod'

export const SkillSettingsSchema = z.object({
  enabledSkillNames: z.array(z.string()).catch([]),
  translationEnabled: z.boolean().catch(true),
})

export type SkillSettings = z.infer<typeof SkillSettingsSchema>
